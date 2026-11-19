// CatChat sign-in: MSU SSO (CatChat App Connect) or a pasted key.
// See src/md/features/mobile.md and src/md/features/sign-in.md.

import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

import 'config.dart';

class Credential {
  Credential({required this.key, required this.expires, this.user});

  final String key;
  final DateTime expires;
  final String? user;

  bool get expiresSoon => expires.difference(DateTime.now()) <= expiryWarning;
  int get daysLeft => max(0, expires.difference(DateTime.now()).inDays);

  String encode() => jsonEncode({'key': key, 'expires': expires.toIso8601String(), 'user': user});

  static Credential? decode(String? text) {
    if (text == null || text.isEmpty) return null;
    try {
      final j = jsonDecode(text) as Map<String, dynamic>;
      return Credential(key: j['key'] as String, expires: DateTime.parse(j['expires'] as String), user: j['user'] as String?);
    } catch (_) {
      return null;
    }
  }
}

// A sign-in problem. The message is for the student.
class SignInError implements Exception {
  SignInError(this.message);
  final String message;
  @override
  String toString() => message;
}

SignInError noConnection(Object e) =>
    SignInError('Cannot connect to CatChat ($e). Check your network connection, then try again. If the problem continues, connect to the MSU VPN.');

// Text copied from a PDF or a web page often has smart quotes, spaces, or zero-width characters.
String cleanKey(String raw) => raw
    .replaceAll(RegExp('[​-‍⁠﻿]'), '')
    .replaceFirst(RegExp(r'^\s*(export\s+)?[A-Z_]*API_KEY\s*=\s*', caseSensitive: false), '')
    .replaceFirst(RegExp(r'^\s*bearer\s+', caseSensitive: false), '')
    .replaceAll(RegExp('["\'`‘-‟«»]'), '')
    .replaceAll(RegExp(r'\s+'), '');

Future<bool> keyWorks(http.Client client, String key) async {
  try {
    final res = await client.get(Uri.parse('$catchatApi/v1/models'), headers: {'Authorization': 'Bearer $key'}).timeout(const Duration(seconds: 15));
    return res.statusCode == 200;
  } catch (e) {
    throw noConnection(e);
  }
}

// Clean a pasted key, test it with CatChat, and return the credential.
Future<Credential> pastedKey(http.Client client, String raw) async {
  final key = cleanKey(raw);
  if (key.isEmpty) throw SignInError('The key is empty. Copy your key from catchat access, then paste it again.');
  if (!await keyWorks(client, key)) {
    throw SignInError('CatChat did not accept the key. Make a new key at catchat access, then try again.');
  }
  return Credential(key: key, expires: DateTime.now().add(keyLifetime));
}

// ---- MSU SSO: CatChat App Connect, with PKCE S256 (RFC 7636) ----

String _b64url(List<int> bytes) => base64Url.encode(bytes).replaceAll('=', '');

String challengeFor(String verifier) => _b64url(sha256.convert(ascii.encode(verifier)).bytes);

class SsoRequest {
  SsoRequest._(this.state, this.verifier);

  factory SsoRequest([Random? random]) {
    final r = random ?? Random.secure();
    List<int> bytes(int n) => List.generate(n, (_) => r.nextInt(256));
    return SsoRequest._(_b64url(bytes(32)), _b64url(bytes(64)));
  }

  final String state;
  final String verifier;

  // The page that the web view opens.
  Uri get url => Uri.parse('$catchatAccess/connect').replace(
    queryParameters: {
      'name': clientName,
      'redirect_uri': redirectUri,
      'state': state,
      'code_challenge': challengeFor(verifier),
      'code_challenge_method': 'S256',
    },
  );

  bool isRedirect(Uri url) => url.toString().startsWith(redirectUri);

  // The code from the redirect address.
  String codeFrom(Uri url) {
    final q = url.queryParameters;
    if (q['state'] != state) throw SignInError('This response is from a different sign-in. Try again.');
    final error = q['error'];
    if (error != null) throw SignInError('The key was not approved: ${q['error_description'] ?? error}. Try again.');
    final code = q['code'];
    if (code == null || code.isEmpty) throw SignInError('The response has no code. Try again.');
    return code;
  }

  Future<Credential> exchange(http.Client client, String code) async {
    final http.Response res;
    try {
      res = await client
          .post(
            Uri.parse('$catchatAccess/connect/token'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'code': code, 'code_verifier': verifier, 'redirect_uri': redirectUri}),
          )
          .timeout(const Duration(seconds: 30));
    } catch (e) {
      throw noConnection(e);
    }
    if (res.statusCode != 200) {
      final text = res.body.length > 200 ? res.body.substring(0, 200) : res.body;
      throw SignInError('CatChat did not give a key (HTTP ${res.statusCode}): $text. Try again.');
    }
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    return Credential(
      key: j['key'] as String,
      expires: DateTime.tryParse('${j['expires_at']}') ?? DateTime.now().add(keyLifetime),
      user: j['key_alias'] as String?,
    );
  }
}
