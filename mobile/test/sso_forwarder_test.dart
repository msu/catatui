import 'dart:io';

import 'package:catai/auth.dart';
import 'package:catai/config.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

Future<HttpClientResponse> _get(String url) async {
  final client = HttpClient();
  final req = await client.getUrl(Uri.parse(url));
  req.followRedirects = false;
  final res = await req.close();
  client.close();
  return res;
}

void main() {
  test('the forwarder sends the App Connect redirect on to catai://callback with the same query', () async {
    final request = SsoRequest();
    final forwarder = await LoopbackForwarder.start();
    addTearDown(forwarder.close);
    final res = await _get('$redirectUri?code=abc123&state=${request.state}');
    expect(res.statusCode, HttpStatus.found);
    final location = Uri.parse(res.headers.value(HttpHeaders.locationHeader)!);
    expect(location.scheme, appCallbackScheme);
    expect(location.host, 'callback');
    // The sign-in screen reads the code from the catai:// address the sheet returns.
    expect(request.codeFrom(location), 'abc123');
  });

  test('an error from App Connect reaches the app', () async {
    final request = SsoRequest();
    final forwarder = await LoopbackForwarder.start();
    addTearDown(forwarder.close);
    final res = await _get('$redirectUri?error=access_denied&state=${request.state}');
    final location = Uri.parse(res.headers.value(HttpHeaders.locationHeader)!);
    expect(() => request.codeFrom(location), throwsA(isA<SignInError>()));
  });

  test('the forwarder answers only the redirect path', () async {
    final forwarder = await LoopbackForwarder.start();
    addTearDown(forwarder.close);
    final res = await _get('http://127.0.0.1:${Uri.parse(redirectUri).port}/other');
    expect(res.statusCode, HttpStatus.notFound);
  });

  test('a port in use gives a sign-in error, not a crash', () async {
    final first = await LoopbackForwarder.start();
    addTearDown(first.close);
    expect(LoopbackForwarder.start(), throwsA(isA<SignInError>()));
  });

  test('after iOS takes back the socket, ensureListening listens again and the redirect works', () async {
    final request = SsoRequest();
    final forwarder = await LoopbackForwarder.start();
    addTearDown(forwarder.close);
    await forwarder.dropListenerForTest();
    await expectLater(_get('$redirectUri?code=x&state=${request.state}'), throwsA(isA<SocketException>()));
    await forwarder.ensureListening();
    final res = await _get('$redirectUri?code=abc123&state=${request.state}');
    expect(res.statusCode, HttpStatus.found);
    expect(request.codeFrom(Uri.parse(res.headers.value(HttpHeaders.locationHeader)!)), 'abc123');
  });

  test('ensureListening keeps a listener that still works', () async {
    final request = SsoRequest();
    final forwarder = await LoopbackForwarder.start();
    addTearDown(forwarder.close);
    await forwarder.ensureListening();
    await forwarder.ensureListening();
    final res = await _get('$redirectUri?code=abc123&state=${request.state}');
    expect(res.statusCode, HttpStatus.found);
  });

  test('ensureListening after close does not listen again', () async {
    final forwarder = await LoopbackForwarder.start();
    await forwarder.close();
    await forwarder.ensureListening();
    final next = await LoopbackForwarder.start();
    await next.close();
  });

  test('after close, the port is free for the next sign-in', () async {
    final first = await LoopbackForwarder.start();
    await first.close();
    final second = await LoopbackForwarder.start();
    await second.close();
  });

  test('the sign-in page check passes when catchat access answers', () async {
    final client = MockClient((_) async => http.Response('ok', 200));
    expect(await signInPageProblem(client), isNull);
  });

  test('the sign-in page check explains when the phone cannot reach catchat access', () async {
    final client = MockClient((_) async => throw const SocketException('Connection refused'));
    expect(await signInPageProblem(client), contains('cannot reach the MSU sign-in page'));
  });
}
