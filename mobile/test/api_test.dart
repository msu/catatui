import 'dart:convert';

import 'package:catai/api.dart';
import 'package:catai/config.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

http.StreamedResponse sse(List<String> lines, [int status = 200]) => http.StreamedResponse(Stream.value(utf8.encode(lines.join('\n'))), status);

String delta(Map<String, dynamic> d) =>
    'data: ${jsonEncode({
      'choices': [
        {'delta': d},
      ],
    })}';

void main() {
  test('visibleModels hides the alias names and the embedding models', () {
    expect(visibleModels(['Qwen3.8-27B', 'opus', 'claude-sonnet', 'nomic-embed-text', 'gpt-oss:120b']), ['Qwen3.8-27B', 'gpt-oss:120b']);
  });

  test('pickModel: the saved model, then the preferred models, then the first', () {
    const ids = ['llama3.1:8b', 'gpt-oss:120b', 'Qwen3.9-27B'];
    expect(pickModel(ids, 'llama3.1:8b'), 'llama3.1:8b');
    expect(pickModel(ids, 'gone'), 'Qwen3.9-27B');
    expect(pickModel(['llama3.1:8b', 'gpt-oss:120b'], null), 'gpt-oss:120b');
    expect(pickModel(['llama3.1:8b'], null), 'llama3.1:8b');
    expect(pickModel([], null), isNull);
  });

  test('deltaFrom reads one line of the stream', () {
    expect(deltaFrom(delta({'content': 'Hi'})), 'Hi');
    expect(deltaFrom(delta({'role': 'assistant'})), isNull);
    expect(deltaFrom(delta({'reasoning_content': 'hmm'})), isNull);
    expect(deltaFrom('data: [DONE]'), '');
    expect(deltaFrom(''), isNull);
    expect(deltaFrom(': keep-alive'), isNull);
    expect(deltaFrom('data: {broken'), isNull);
    expect(() => deltaFrom('data: {"error":{"message":"overloaded"}}'), throwsA(isA<ApiError>()));
  });

  test('models sends the key and hides models', () async {
    final api = CatChat(
      MockClient((req) async {
        expect(req.headers['Authorization'], 'Bearer sk-a');
        return http.Response(
          jsonEncode({
            'data': [
              {'id': 'Qwen3.8-27B'},
              {'id': 'haiku'},
            ],
          }),
          200,
        );
      }),
    );
    expect(await api.models('sk-a'), ['Qwen3.8-27B']);
  });

  test('models: 401 is Unauthorized', () {
    final api = CatChat(MockClient((_) async => http.Response('', 401)));
    expect(() => api.models('sk-a'), throwsA(isA<Unauthorized>()));
  });

  test('chat sends the request and gives the answer parts', () async {
    late Map<String, dynamic> sent;
    final api = CatChat(
      MockClient.streaming((req, body) async {
        expect(req.url.toString(), '$catchatApi/v1/chat/completions');
        expect(req.headers['Authorization'], 'Bearer sk-a');
        sent = jsonDecode(await body.bytesToString()) as Map<String, dynamic>;
        return sse([
          delta({'role': 'assistant'}),
          '',
          delta({'reasoning_content': 'think'}),
          delta({'content': 'Hel'}),
          delta({'content': 'lo'}),
          'data: [DONE]',
          delta({'content': 'late'}),
        ]);
      }),
    );
    final parts = await api
        .chat(
          key: 'sk-a',
          model: 'm',
          messages: [
            {'role': 'user', 'content': 'Hi'},
          ],
        )
        .toList();
    expect(parts, ['Hel', 'lo']);
    expect(sent, {
      'model': 'm',
      'messages': [
        {'role': 'user', 'content': 'Hi'},
      ],
      'stream': true,
    });
  });

  test('chat: 401 is Unauthorized, and other errors give the LiteLLM message', () {
    final denied = CatChat(MockClient.streaming((_, _) async => sse([], 401)));
    expect(denied.chat(key: 'k', model: 'm', messages: []).toList(), throwsA(isA<Unauthorized>()));
    final failed = CatChat(MockClient.streaming((_, _) async => sse(['{"error":{"message":"Budget exceeded"}}'], 429)));
    expect(
      failed.chat(key: 'k', model: 'm', messages: []).toList(),
      throwsA(isA<ApiError>().having((e) => e.message, 'message', 'CatChat error (HTTP 429): Budget exceeded')),
    );
  });
}
