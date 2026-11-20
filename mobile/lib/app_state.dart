// The state of the app: the sign-in, the models, the chats, and the answer that comes.

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:http/http.dart' as http;

import 'api.dart';
import 'auth.dart';
import 'chats.dart';
import 'config.dart';
import 'demo_tools.dart';

// Secret values on the phone (Keychain on iOS, Keystore on Android). The tests use a map.
abstract class Secrets {
  Future<String?> read(String name);
  Future<void> write(String name, String value);
  Future<void> delete(String name);
}

String systemPrompt(DateTime now) =>
    'You are CatChat, an AI assistant for Montana State University students. '
    'Give clear and correct answers. Use markdown. '
    'The date is ${now.toIso8601String().substring(0, 10)}.';

class AppState extends ChangeNotifier {
  AppState({required this.secrets, required this.store, required this.client, this.demo = demoBuild, AssetLoader? assets})
    : api = CatChat(client),
      demoTools = demo ? DemoTools(assets ?? rootBundle.loadString) : null;

  // The model can ask for tools this number of times for one question.
  static const maxToolRounds = 5;

  // The mock tools of demo mode. Null in a normal build.
  final DemoTools? demoTools;

  // Demo mode: the app shows mock data, with a "DEMO" badge. The tests set it.
  final bool demo;

  final Secrets secrets;
  final ChatStore store;
  final http.Client client;
  final CatChat api;

  bool loaded = false;
  Credential? credential;
  List<String> models = [];
  String? model;
  List<Chat> chats = [];
  Chat chat = Chat.create();
  bool busy = false;
  String? error;

  StreamSubscription<ChatEvent>? _answer;
  // The student's answer on the plan card (Send to advisor: true). Not null while the card waits.
  Completer<bool>? _planAnswer;

  bool get waitingForPlan => _planAnswer != null;

  // The tap on the plan card.
  void answerPlan(bool send) {
    final waiting = _planAnswer;
    _planAnswer = null;
    if (waiting != null && !waiting.isCompleted) waiting.complete(send);
  }

  Message? _answerMessage;

  Future<void> load() async {
    credential = Credential.decode(await secrets.read('catchat'));
    model = await secrets.read('model');
    chats = await store.list();
    loaded = true;
    notifyListeners();
    if (credential != null) await refreshModels();
  }

  Future<void> signIn(Credential c) async {
    credential = c;
    error = null;
    await secrets.write('catchat', c.encode());
    notifyListeners();
    await refreshModels();
  }

  // Sign out removes the key, the saved model, and the chats, so the next student starts clean.
  Future<void> signOut() async {
    stop();
    await _forgetKey();
    await secrets.delete('model');
    await store.clear();
    chats = [];
    chat = Chat.create();
    models = [];
    model = null;
    error = null;
    notifyListeners();
  }

  Future<void> _forgetKey() async {
    credential = null;
    await secrets.delete('catchat');
  }

  Future<void> refreshModels() async {
    final c = credential;
    if (c == null) return;
    try {
      models = await api.models(c.key);
      model = pickModel(models, model);
      error = null;
    } on Unauthorized {
      await _forgetKey();
    } catch (e) {
      error = e is ApiError ? e.message : noConnection(e).message;
    }
    notifyListeners();
  }

  Future<void> selectModel(String id) async {
    model = id;
    notifyListeners();
    await secrets.write('model', id);
  }

  void newChat() {
    stop();
    chat = Chat.create();
    error = null;
    notifyListeners();
  }

  void openChat(Chat c) {
    stop();
    chat = c;
    error = null;
    notifyListeners();
  }

  Future<void> deleteChat(Chat c) async {
    if (identical(c, chat)) newChat();
    chats.remove(c);
    notifyListeners();
    await store.delete(c.id);
  }

  void send(String text) {
    final c = credential;
    final m = model;
    text = text.trim();
    if (busy || c == null || text.isEmpty) return;
    if (m == null) {
      error = 'CatChat has no model list yet. Check your network connection, then try again.';
      notifyListeners();
      refreshModels();
      return;
    }
    error = null;
    final messages = <Map<String, dynamic>>[
      {'role': 'system', 'content': demo ? demoSystemPrompt : systemPrompt(DateTime.now())},
      for (final old in chat.messages) old.toJson(),
      {'role': 'user', 'content': text},
    ];
    chat.messages.add(Message('user', text));
    final answer = Message('assistant', '');
    chat.messages.add(answer);
    if (!chats.contains(chat)) chats.insert(0, chat);
    _answerMessage = answer;
    busy = true;
    notifyListeners();
    _ask(c.key, m, messages, answer, 1);
  }

  // One request to CatChat. In demo mode the model can answer with tool calls:
  // then the app runs the mock tools, adds the results to the messages, and asks again.
  void _ask(String key, String model, List<Map<String, dynamic>> messages, Message answer, int round) {
    final tools = demoTools;
    final start = answer.text.length;
    var calls = <ToolCall>[];
    _answer = api
        .chat(key: key, model: model, messages: messages, tools: tools == null ? null : DemoTools.specs)
        .listen(
          (event) {
            switch (event) {
              case TextEvent(:final text):
                // No empty lines at the start of an answer.
                final joined = answer.text + text;
                answer.text = joined.trim().isEmpty ? '' : (answer.text.trim().isEmpty ? joined.trimLeft() : joined);
                notifyListeners();
              case ToolCallsEvent(calls: final asked):
                calls = asked;
            }
          },
          onError: (Object e) => _finish(e),
          onDone: () async {
            if (calls.isEmpty || tools == null) return _finish(null);
            if (round >= maxToolRounds) return _finish(ApiError('CatChat asked for data too many times. Try the question again.'));
            final said = answer.text.substring(start);
            messages.add({
              'role': 'assistant',
              'content': said.isEmpty ? null : said,
              'tool_calls': [for (final call in calls) call.toJson()],
            });
            for (final call in calls) {
              final ToolResult result;
              if (call.name == DemoTools.planTool) {
                // The plan card: the model gets the result only after the student's tap.
                final plan = await tools.buildPlan(call.args);
                if (!identical(_answerMessage, answer)) return;
                var send = false;
                if (plan['status'] == 'pending') {
                  answer.plan = plan;
                  final waiting = _planAnswer = Completer<bool>();
                  notifyListeners();
                  send = await waiting.future;
                }
                result = tools.planResult(plan, sent: send);
              } else {
                result = await tools.run(call.name, call.args);
              }
              // Stop, a new chat, or sign-out came while the tool ran.
              if (!identical(_answerMessage, answer)) return;
              answer.lookups.add(result.label);
              messages.add({'role': 'tool', 'tool_call_id': call.id, 'content': result.text});
              notifyListeners();
            }
            // Text that the model wrote before the tool call stays, on its own lines.
            if (answer.text.trim().isNotEmpty && !answer.text.endsWith('\n')) answer.text += '\n\n';
            _ask(key, model, messages, answer, round + 1);
          },
          cancelOnError: true,
        );
  }

  // Stop closes the connection. The part of the answer that came stays.
  void stop() {
    if (!busy) return;
    _answer?.cancel();
    _finish(null, stopped: true);
  }

  Future<void> _finish(Object? e, {bool stopped = false}) async {
    final answer = _answerMessage;
    final finished = chat;
    _answer = null;
    _answerMessage = null;
    busy = false;
    // A plan card that waits: Stop, a new chat, or an error is "Not sent".
    if (answer?.plan?['status'] == 'pending') answer!.plan!['status'] = 'declined';
    answerPlan(false);
    if (answer != null && answer.text.isEmpty && answer.plan == null) {
      finished.messages.remove(answer);
      if (e == null && !stopped) error = 'CatChat gave an empty answer. Try again.';
    }
    if (e is Unauthorized) {
      await _forgetKey();
    } else if (e != null) {
      error = e is ApiError ? e.message : noConnection(e).message;
    }
    notifyListeners();
    await store.save(finished);
    chats.sort((a, b) => b.updated.compareTo(a.updated));
    notifyListeners();
  }
}
