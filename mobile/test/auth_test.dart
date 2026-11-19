import 'dart:convert';

import 'package:catai/auth.dart';
import 'package:catai/config.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('cleanKey removes the text that a copy adds', () {
    expect(cleanKey('  sk-abc123 \n'), 'sk-abc123');
    expect(cleanKey('“sk-abc”'), 'sk-abc');
    expect(cleanKey('export CATCHAT_API_KEY="sk-abc"'), 'sk-abc');
    expect(cleanKey('Bearer sk-abc'), 'sk-abc');
    expect(cleanKey('sk-​abc﻿'), 'sk-abc');
    expect(cleanKey('sk- a b c'), 'sk-abc');
    expect(cleanKey('   '), '');
  });

  test('challengeFor agrees with the RFC 7636 example', () {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  test('the SSO page address has the PKCE values', () {
    final r = SsoRequest();
    final q = r.url.queryParameters;
    expect(r.url.toString(), startsWith('$catchatAccess/connect?'));
    expect(q['name'], clientName);
    expect(q['redirect_uri'], redirectUri);
    expect(q['state'], r.state);
    expect(q['code_challenge'], challengeFor(r.verifier));
    expect(q['code_challenge_method'], 'S256');
    expect(r.verifier.length, greaterThanOrEqualTo(43));
    expect(SsoRequest().state, isNot(r.state));
  });

  test('codeFrom reads the code and refuses a different sign-in', () {
    final r = SsoRequest();
    Uri back(String query) => Uri.parse('$redirectUri?$query');
    expect(r.isRedirect(back('code=abc&state=${r.state}')), isTrue);
    expect(r.isRedirect(Uri.parse('$catchatAccess/connect')), isFalse);
    expect(r.codeFrom(back('code=abc&state=${r.state}')), 'abc');
    expect(() => r.codeFrom(back('code=abc&state=other')), throwsA(isA<SignInError>()));
    expect(() => r.codeFrom(back('state=${r.state}')), throwsA(isA<SignInError>()));
    expect(
      () => r.codeFrom(back('error=access_denied&error_description=No&state=${r.state}')),
      throwsA(isA<SignInError>().having((e) => e.message, 'message', contains('No'))),
    );
  });

  test('exchange sends the code and the verifier, and returns the key', () async {
    final r = SsoRequest();
    late Map<String, dynamic> sent;
    final client = MockClient((req) async {
      expect(req.url.toString(), '$catchatAccess/connect/token');
      sent = jsonDecode(req.body) as Map<String, dynamic>;
      return http.Response(jsonEncode({'key': 'sk-new', 'key_alias': 'jane_catai-mobile', 'expires_at': '2027-05-16T00:00:00Z'}), 200);
    });
    final c = await r.exchange(client, 'abc');
    expect(sent, {'code': 'abc', 'code_verifier': r.verifier, 'redirect_uri': redirectUri});
    expect(c.key, 'sk-new');
    expect(c.user, 'jane_catai-mobile');
    expect(c.expires.toUtc(), DateTime.utc(2027, 5, 16));
  });

  test('exchange gives a SignInError when CatChat refuses the code', () async {
    final client = MockClient((_) async => http.Response('bad code', 400));
    expect(() => SsoRequest().exchange(client, 'abc'), throwsA(isA<SignInError>().having((e) => e.message, 'message', contains('HTTP 400'))));
  });

  test('pastedKey tests the key with CatChat', () async {
    final client = MockClient((req) async {
      expect(req.url.toString(), '$catchatApi/v1/models');
      return http.Response('{}', req.headers['Authorization'] == 'Bearer sk-good' ? 200 : 401);
    });
    expect((await pastedKey(client, ' "sk-good" ')).key, 'sk-good');
    expect(() => pastedKey(client, 'sk-bad'), throwsA(isA<SignInError>()));
    expect(() => pastedKey(client, '  '), throwsA(isA<SignInError>()));
  });

  test('a network failure gives the VPN message', () async {
    final client = MockClient((_) async => throw http.ClientException('no route'));
    expect(() => pastedKey(client, 'sk-x'), throwsA(isA<SignInError>().having((e) => e.message, 'message', contains('MSU VPN'))));
  });

  test('the credential survives encode and decode', () {
    final c = Credential(key: 'sk-a', expires: DateTime.utc(2027, 1, 2), user: 'jane');
    final d = Credential.decode(c.encode())!;
    expect([d.key, d.expires, d.user], ['sk-a', DateTime.utc(2027, 1, 2), 'jane']);
    expect(Credential.decode(null), isNull);
    expect(Credential.decode('not json'), isNull);
    expect(Credential(key: 'k', expires: DateTime.now().add(const Duration(days: 3))).expiresSoon, isTrue);
    expect(Credential(key: 'k', expires: DateTime.now().add(const Duration(days: 100))).expiresSoon, isFalse);
  });
}
