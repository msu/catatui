import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:catai/app_state.dart';
import 'package:catai/auth.dart';
import 'package:catai/chats.dart';
import 'package:catai/demo_tools.dart';
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

  group('demo mode', () {
    // The replies of CatChat, one for each request. The test reads the requests from chatRequests.
    late List<String> replies;

    AppState demoApp({bool demo = true}) => AppState(
      secrets: secrets,
      store: ChatStore(dir),
      demo: demo,
      assets: (path) => File(path).readAsString(),
      client: MockClient.streaming((req, body) async {
        if (req.url.path == '/v1/models') {
          return http.StreamedResponse(
            Stream.value(
              utf8.encode(
                jsonEncode({
                  'data': [
                    {'id': 'Qwen3.8-27B'},
                  ],
                }),
              ),
            ),
            200,
          );
        }
        chatRequests.add(jsonDecode(await body.bytesToString()) as Map<String, dynamic>);
        return http.StreamedResponse(Stream.value(utf8.encode(replies.removeAt(0))), 200);
      }),
    );

    String toolCall(String name, Map<String, dynamic> args) =>
        'data: ${jsonEncode({
          'choices': [
            {
              'delta': {
                'tool_calls': [
                  {
                    'index': 0,
                    'id': 'call_1',
                    'function': {'name': name, 'arguments': jsonEncode(args)},
                  },
                ],
              },
            },
          ],
        })}\ndata: [DONE]\n';

    Future<AppState> start({bool demo = true}) async {
      final app = demoApp(demo: demo);
      await app.load();
      await app.signIn(Credential(key: 'sk-a', expires: DateTime.now().add(const Duration(days: 100))));
      return app;
    }

    test('the model calls a mock tool, the app runs it, and the answer comes', () async {
      replies = [
        toolCall('catalog_search', {'term': 'Spring 2027', 'subject': 'CSCI'}),
        '${delta('Six classes.')}data: [DONE]\n',
      ];
      final app = await start();
      app.send('What classes in computer science are offered next spring?');
      await idle(app);

      final answer = app.chat.messages.last;
      expect(answer.text, 'Six classes.');
      expect(answer.lookups, ['class catalog (Spring 2027, CSCI)']);
      expect(app.error, isNull);

      // The first request has the tools and the demo prompt.
      expect((chatRequests.first['tools'] as List).length, DemoTools.specs.length);
      expect(chatRequests.first['messages'][0]['content'], contains('DEMO MODE'));
      // The second request has the tool call and the tool result with the mock data.
      final second = chatRequests[1]['messages'] as List;
      expect([for (final m in second) m['role']], ['system', 'user', 'assistant', 'tool']);
      expect(second[2]['tool_calls'][0]['function']['name'], 'catalog_search');
      expect(second[3]['tool_call_id'], 'call_1');
      expect(second[3]['content'], startsWith('MOCK DATA'));
      expect(second[3]['content'], contains('CSCI 468'));

      // The lookup rows are saved with the chat. The tool results are not.
      final saved = (await ChatStore(dir).list()).single;
      expect(saved.messages.last.lookups, ['class catalog (Spring 2027, CSCI)']);
      expect(saved.messages.length, 2);
    });

    test('empty lines before a tool call and at the start of the answer go away', () async {
      replies = ['${delta('\n\n')}${toolCall('campus_activities', {})}', '${delta('\n')}${delta('  \nWednesday: trivia.')}data: [DONE]\n'];
      final app = await start();
      app.send('Activities?');
      await idle(app);
      expect(app.chat.messages.last.text, 'Wednesday: trivia.');
    });

    test('text before a tool call stays, and two rounds of tools work', () async {
      replies = [
        '${delta('Let me check.')}${toolCall('campus_activities', {'category': 'Arts'})}',
        toolCall('formal_verification_paths', {}),
        '${delta('Here it is.')}data: [DONE]\n',
      ];
      final app = await start();
      app.send('Activities and verification?');
      await idle(app);
      expect(app.chat.messages.last.text, 'Let me check.\n\nHere it is.');
      expect(app.chat.messages.last.lookups, ['campus activities (Arts)', 'formal verification classes and labs']);
      expect(chatRequests.length, 3);
      expect(chatRequests[1]['messages'][2]['content'], 'Let me check.');
    });

    test('the app stops after too many rounds of tool calls', () async {
      replies = List.filled(10, toolCall('campus_activities', {}), growable: true);
      final app = await start();
      app.send('Activities?');
      await idle(app);
      expect(chatRequests.length, AppState.maxToolRounds);
      expect(app.error, contains('too many times'));
      expect(app.busy, isFalse);
    });

    test('a normal build sends no tools and does not run tool calls', () async {
      replies = ['${delta('Hello')}${toolCall('campus_activities', {})}'];
      final app = await start(demo: false);
      app.send('Hi');
      await idle(app);
      expect(chatRequests.single.containsKey('tools'), isFalse);
      expect(chatRequests.single['messages'][0]['content'], isNot(contains('DEMO')));
      expect(app.chat.messages.last.lookups, isEmpty);
      expect(app.demoTools, isNull);
    });

    final planCall = {
      'terms': [
        {
          'term': 'Spring 2027',
          'courses': ['CSCI 460', 'CSCI 468'],
        },
      ],
    };

    Future<void> untilWaiting(AppState app) async {
      for (var i = 0; i < 200 && !app.waitingForPlan; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
    }

    test('submit_plan waits for the student, then sends the plan', () async {
      replies = [toolCall('submit_plan', planCall), '${delta('The plan is with your advisor.')}data: [DONE]\n'];
      final app = await start();
      app.send('Send it.');
      await untilWaiting(app);
      expect(app.waitingForPlan, isTrue);
      expect(app.busy, isTrue);
      expect(app.chat.messages.last.plan!['status'], 'pending');
      expect(chatRequests.length, 1);

      app.answerPlan(true);
      await idle(app);
      final answer = app.chat.messages.last;
      expect(answer.plan!['status'], 'sent');
      expect(answer.text, 'The plan is with your advisor.');
      expect(answer.lookups, ['plan for the advisor (sent)']);
      final tool = (chatRequests[1]['messages'] as List).last;
      expect(tool['content'], contains('"submitted": true'));
      // The card is saved with the chat.
      final saved = (await ChatStore(dir).list()).single.messages.last.plan!;
      expect([saved['status'], saved['confirmation']], ['sent', answer.plan!['confirmation']]);
    });

    test('"Not now" on the plan card tells the model that the plan was not sent', () async {
      replies = [toolCall('submit_plan', planCall), '${delta('What do you want to change?')}data: [DONE]\n'];
      final app = await start();
      app.send('Send it.');
      await untilWaiting(app);
      app.answerPlan(false);
      await idle(app);
      expect(app.chat.messages.last.plan!['status'], 'declined');
      expect((chatRequests[1]['messages'] as List).last['content'], contains('chose not to send the plan yet'));
    });

    test('Stop while the plan card waits gives "Not sent", and the card stays', () async {
      replies = [toolCall('submit_plan', planCall)];
      final app = await start();
      app.send('Send it.');
      await untilWaiting(app);
      app.stop();
      await idle(app);
      expect(app.waitingForPlan, isFalse);
      expect(app.busy, isFalse);
      expect(app.chat.messages.last.plan!['status'], 'declined');
      expect(chatRequests.length, 1);
      expect(app.error, isNull);
    });
  });
}
