// The state of the app: the sign-in, the models, the chats, and the answer that comes.

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'api.dart';
import 'auth.dart';
import 'chats.dart';
import 'config.dart';

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
  AppState({required this.secrets, required this.store, required this.client}) : api = CatChat(client);

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

  StreamSubscription<String>? _answer;
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
    final messages = [
      {'role': 'system', 'content': systemPrompt(DateTime.now())},
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

    _answer = api
        .chat(key: c.key, model: m, messages: messages)
        .listen(
          (part) {
            answer.text += part;
            notifyListeners();
          },
          onError: (Object e) => _finish(e),
          onDone: () => _finish(null),
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
    if (answer != null && answer.text.isEmpty) {
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
