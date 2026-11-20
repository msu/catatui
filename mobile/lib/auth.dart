// CatChat sign-in: MSU SSO (CatChat App Connect) or a pasted key.
// See src/md/features/mobile.md and src/md/features/sign-in.md.

import 'dart:convert';
import 'dart:io';
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

  // The page that the sign-in sheet opens.
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

// The system sign-in sheet (ASWebAuthenticationSession on iOS, a Custom Tab on Android) can only stop at an app
// address, but App Connect sends the code to the http redirectUri. While the sheet is open the app listens there
// and forwards the redirect to appCallbackUri, which closes the sheet. App Connect needs no change.

// The MSU sign-in pages answer only on the MSU network. The system sheet shows only Safari's own error page, so
// the app checks first. Gives null if the page answers, else the error for the student. It cannot see Safari's
// iCloud Private Relay: the app's own connection does not use it.
Future<String?> signInPageProblem(http.Client client) async {
  try {
    await client.get(Uri.parse('$catchatAccess/')).timeout(const Duration(seconds: 8));
    return null;
  } catch (e) {
    return 'This phone cannot reach the MSU sign-in page ($e).';
  }
}

const appCallbackScheme = 'catai';
final appCallbackUri = Uri(scheme: appCallbackScheme, host: 'callback');

class LoopbackForwarder {
  LoopbackForwarder._(this._server, this._redirect);
  HttpServer _server;
  final Uri _redirect;
  bool _closed = false;

  static Future<LoopbackForwarder> start() async {
    final redirect = Uri.parse(redirectUri);
    final HttpServer server;
    try {
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, redirect.port);
    } on SocketException catch (e) {
      throw SignInError('The sign-in could not start (port ${redirect.port}: ${e.message}). Close other apps, then try again.');
    }
    final forwarder = LoopbackForwarder._(server, redirect).._listen();
    return forwarder;
  }

  void _listen() => _server.listen(
    (req) => _handle(req, _redirect.path),
    // The socket can fail when iOS takes it back; ensureListening listens again.
    onError: (Object _) {},
  );

  // iOS can take back a listening socket while the app is in the background (Apple TN2277), for example while the
  // student approves the sign-in in the Authenticator app. Then the redirect fails with "cannot connect". Call this
  // each time the app is active again: it listens again if the socket is gone.
  Future<void> ensureListening() async {
    if (_closed) return;
    try {
      final probe = await Socket.connect(InternetAddress.loopbackIPv4, _redirect.port, timeout: const Duration(milliseconds: 500));
      probe.destroy();
      return;
    } catch (_) {}
    try {
      await _server.close(force: true);
    } catch (_) {}
    if (_closed) return;
    try {
      _server = await HttpServer.bind(InternetAddress.loopbackIPv4, _redirect.port, shared: true);
      _listen();
    } on SocketException {
      // The redirect then fails, and the student can try again.
    }
  }

  // Tests: what iOS does to a suspended app's listening socket.
  Future<void> dropListenerForTest() => _server.close(force: true);

  void _handle(HttpRequest req, String path) {
    final res = req.response;
    if (req.uri.path != path) {
      res.statusCode = HttpStatus.notFound;
      res.close();
      return;
    }
    final target = appCallbackUri.replace(query: req.uri.query.isEmpty ? null : req.uri.query).toString();
    // The link is for a sheet that does not follow the redirect by itself.
    res
      ..statusCode = HttpStatus.found
      ..headers.set(HttpHeaders.locationHeader, target)
      ..headers.set(HttpHeaders.cacheControlHeader, 'no-store')
      ..headers.contentType = ContentType.html
      ..write(
        '<!doctype html><meta name="viewport" content="width=device-width"><p>Signed in. <a href="${const HtmlEscape().convert(target)}">Return to catai</a></p>',
      );
    res.close();
  }

  Future<void> close() {
    _closed = true;
    return _server.close(force: true);
  }
}
