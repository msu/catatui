// Saved chats: one JSON file for each chat in a folder on the phone.

import 'dart:convert';
import 'dart:io';

class Message {
  Message(this.role, this.text, {List<String>? lookups}) : lookups = lookups ?? [];
  final String role; // "user" or "assistant"
  String text;
  // Demo mode: one line for each mock tool that the model called for this answer, for example "catalog (Spring 2027, CSCI)".
  final List<String> lookups;

  // The message for CatChat.
  Map<String, dynamic> toJson() => {'role': role, 'content': text};

  // The message in the chat file.
  Map<String, dynamic> toFile() => {...toJson(), if (lookups.isNotEmpty) 'lookups': lookups};
}

class Chat {
  Chat({required this.id, List<Message>? messages, DateTime? updated}) : messages = messages ?? [], updated = updated ?? DateTime.now();

  factory Chat.create() => Chat(id: DateTime.now().microsecondsSinceEpoch.toString());

  final String id;
  final List<Message> messages;
  DateTime updated;

  // The start of the first message.
  String get title {
    if (messages.isEmpty) return 'New Chat';
    final line = messages.first.text.trim().replaceAll(RegExp(r'\s+'), ' ');
    return line.length > 50 ? '${line.substring(0, 50)}...' : line;
  }

  String encode() => jsonEncode({'id': id, 'updated': updated.toIso8601String(), 'messages': messages.map((m) => m.toFile()).toList()});

  static Chat decode(String text) {
    final j = jsonDecode(text) as Map<String, dynamic>;
    return Chat(
      id: j['id'] as String,
      updated: DateTime.parse(j['updated'] as String),
      messages: [
        for (final m in j['messages'] as List<dynamic>)
          Message(m['role'] as String, m['content'] as String, lookups: (m['lookups'] as List<dynamic>?)?.cast<String>()),
      ],
    );
  }
}

class ChatStore {
  ChatStore(this.dir);
  final Directory dir;

  File _file(String id) => File('${dir.path}/$id.json');

  // All chats, the newest first. A file that cannot be read is ignored.
  Future<List<Chat>> list() async {
    if (!await dir.exists()) return [];
    final chats = <Chat>[];
    await for (final f in dir.list()) {
      if (f is! File || !f.path.endsWith('.json')) continue;
      try {
        chats.add(Chat.decode(await f.readAsString()));
      } catch (_) {}
    }
    chats.sort((a, b) => b.updated.compareTo(a.updated));
    return chats;
  }

  Future<void> save(Chat chat) async {
    await dir.create(recursive: true);
    chat.updated = DateTime.now();
    await _file(chat.id).writeAsString(chat.encode());
  }

  Future<void> delete(String id) async {
    final f = _file(id);
    if (await f.exists()) await f.delete();
  }

  Future<void> clear() async {
    if (await dir.exists()) await dir.delete(recursive: true);
  }
}
