import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:catai/app_state.dart';
import 'package:catai/auth.dart';
import 'package:catai/chats.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class MemorySecrets implements Secrets {
  final values = <String, String>{};
  @override
  Future<String?> read(String name) async => values[name];
  @override
  Future<void> write(String name, String value) async => values[name] = value;
  @override
  Future<void> delete(String name) async => values.remove(name);
}

String delta(String text) =>
    'data: ${jsonEncode({
      'choices': [
        {
          'delta': {'content': text},
        },
      ],
    })}\n';

void main() {
  late Directory dir;
  late MemorySecrets secrets;
  // The test sets the chat reply: the status and the stream of the body.
  late int chatStatus;
  late Stream<List<int>> chatBody;
  late List<Map<String, dynamic>> chatRequests;

  AppState newApp() => AppState(
    secrets: secrets,
    store: ChatStore(dir),
    client: MockClient.streaming((req, body) async {
      if (req.url.path == '/v1/models') {
        return http.StreamedResponse(
          Stream.value(
            utf8.encode(
              jsonEncode({
                'data': [
                  {'id': 'llama3.1:8b'},
                  {'id': 'Qwen3.8-27B'},
                  {'id': 'opus'},
                ],
              }),
            ),
          ),
          200,
        );
      }
      chatRequests.add(jsonDecode(await body.bytesToString()) as Map<String, dynamic>);
      return http.StreamedResponse(chatBody, chatStatus);
    }),
  );

  Future<void> idle(AppState app) async {
    while (app.busy) {
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }

  setUp(() {
    dir = Directory.systemTemp.createTempSync('catai-test');
    secrets = MemorySecrets();
    chatStatus = 200;
    chatBody = Stream.fromIterable([utf8.encode(delta('Hel')), utf8.encode('${delta('lo')}data: [DONE]\n')]);
    chatRequests = [];
  });
  tearDown(() {
    if (dir.existsSync()) dir.deleteSync(recursive: true);
  });

  Future<AppState> signedIn() async {
    final app = newApp();
    await app.load();
    await app.signIn(Credential(key: 'sk-a', expires: DateTime.now().add(const Duration(days: 100))));
    return app;
  }

  test('with no key, the app is not signed in', () async {
    final app = newApp();
    await app.load();
    expect(app.loaded, isTrue);
    expect(app.credential, isNull);
  });

  test('sign-in saves the key and selects the preferred model', () async {
    final app = await signedIn();
    expect(app.models, ['llama3.1:8b', 'Qwen3.8-27B']);
    expect(app.model, 'Qwen3.8-27B');
    expect(Credential.decode(secrets.values['catchat'])!.key, 'sk-a');

    await app.selectModel('llama3.1:8b');
    final again = newApp();
    await again.load();
    expect(again.credential!.key, 'sk-a');
    expect(again.model, 'llama3.1:8b');
  });

  test('send adds the answer and saves the chat', () async {
    final app = await signedIn();
    app.send('  Hi there  ');
    expect(app.busy, isTrue);
    await idle(app);
    expect(app.chat.messages.map((m) => '${m.role}:${m.text}'), ['user:Hi there', 'assistant:Hello']);
    expect(app.error, isNull);
    final sent = chatRequests.single;
    expect(sent['model'], 'Qwen3.8-27B');
    expect((sent['messages'] as List).map((m) => m['role']), ['system', 'user']);
    expect((await ChatStore(dir).list()).single.title, 'Hi there');

    // The second message sends the full chat.
    chatBody = Stream.value(utf8.encode(delta('Fine')));
    app.send('And you?');
    await idle(app);
    expect((chatRequests.last['messages'] as List).map((m) => m['content']).skip(1), ['Hi there', 'Hello', 'And you?']);
    expect(app.chats.length, 1);
  });

  test('stop keeps the part of the answer that came', () async {
    final app = await signedIn();
    final body = StreamController<List<int>>();
    chatBody = body.stream;
    app.send('Hi');
    body.add(utf8.encode(delta('Par')));
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(app.chat.messages.last.text, 'Par');
    app.stop();
    await idle(app);
    expect(app.busy, isFalse);
    expect(app.chat.messages.last.text, 'Par');
    expect((await ChatStore(dir).list()).single.messages.length, 2);
    expect(body.hasListener, isFalse);
  });

  test('HTTP 401 removes the key, so the sign-in screen shows', () async {
    final app = await signedIn();
    chatStatus = 401;
    app.send('Hi');
    await idle(app);
    expect(app.credential, isNull);
    expect(secrets.values.containsKey('catchat'), isFalse);
    expect(app.chat.messages.map((m) => m.role), ['user']);
  });

  test('an error shows, and the empty answer goes away', () async {
    final app = await signedIn();
    chatStatus = 500;
    chatBody = Stream.value(utf8.encode('{"error":{"message":"Model is down"}}'));
    app.send('Hi');
    await idle(app);
    expect(app.error, 'CatChat error (HTTP 500): Model is down');
    expect(app.chat.messages.map((m) => m.role), ['user']);
    expect(app.credential, isNotNull);
  });

  test('new chat, open chat, and delete chat', () async {
    final app = await signedIn();
    app.send('First');
    await idle(app);
    final first = app.chat;
    app.newChat();
    expect(app.chat.messages, isEmpty);
    expect(app.chats, [first]);
    app.openChat(first);
    expect(app.chat, first);
    await app.deleteChat(first);
    expect(app.chats, isEmpty);
    expect(app.chat.messages, isEmpty);
    expect(await ChatStore(dir).list(), isEmpty);
  });

  test('sign-out removes the key, the model, and the chats', () async {
    final app = await signedIn();
    app.send('First');
    await idle(app);
    await app.signOut();
    expect(app.credential, isNull);
    expect(secrets.values, isEmpty);
    expect(app.chats, isEmpty);
    expect(await ChatStore(dir).list(), isEmpty);
  });

  test('a long first message gives a short chat name', () {
    final chat = Chat.create()..messages.add(Message('user', 'word ' * 30));
    expect(chat.title.length, 53);
    expect(Chat.create().title, 'New Chat');
    final copy = Chat.decode(chat.encode());
    expect([copy.id, copy.messages.single.text], [chat.id, chat.messages.single.text]);
  });
}
