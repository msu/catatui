// The CatChat API (LiteLLM, OpenAI format): the model list and the chat with streaming.

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config.dart';

// CatChat did not accept the key (HTTP 401). The student must sign in again.
class Unauthorized implements Exception {
  @override
  String toString() => 'Your CatChat key does not work. Sign in again.';
}

class ApiError implements Exception {
  ApiError(this.message);
  final String message;
  @override
  String toString() => message;
}

class CatChat {
  CatChat(this.client);
  final http.Client client;

  Map<String, String> _headers(String key) => {'Authorization': 'Bearer $key', 'Content-Type': 'application/json'};

  Future<List<String>> models(String key) async {
    final res = await client.get(Uri.parse('$catchatApi/v1/models'), headers: _headers(key)).timeout(const Duration(seconds: 15));
    if (res.statusCode == 401) throw Unauthorized();
    if (res.statusCode != 200) throw ApiError('CatChat did not return a model list (HTTP ${res.statusCode}).');
    final data = (jsonDecode(res.body) as Map<String, dynamic>)['data'] as List<dynamic>;
    return visibleModels(data.map((m) => (m as Map<String, dynamic>)['id'] as String));
  }

  // The answer, one part at a time: text parts, and at the end the tool calls of the model (if it made any).
  // To stop, cancel the subscription: this closes the connection at once.
  // The thinking of the model (reasoning_content) is not in the stream.
  Stream<ChatEvent> chat({required String key, required String model, required List<Map<String, dynamic>> messages, List<Map<String, dynamic>>? tools}) {
    StreamSubscription<String>? lines;
    var cancelled = false;
    final calls = ToolCallParts();
    late final StreamController<ChatEvent> out;

    void finish() {
      if (out.isClosed) return;
      if (calls.isNotEmpty) out.add(ToolCallsEvent(calls.take()));
      out.close();
    }

    Future<void> run() async {
      try {
        final req = http.Request('POST', Uri.parse('$catchatApi/v1/chat/completions'))
          ..headers.addAll(_headers(key))
          ..body = jsonEncode({'model': model, 'messages': messages, 'stream': true, if (tools != null && tools.isNotEmpty) 'tools': tools});
        final res = await client.send(req);
        if (cancelled) {
          res.stream.listen(null).cancel();
          return;
        }
        if (res.statusCode == 401) throw Unauthorized();
        if (res.statusCode != 200) throw ApiError(errorMessage(res.statusCode, await res.stream.bytesToString()));
        lines = res.stream
            .transform(utf8.decoder)
            .transform(const LineSplitter())
            .listen(
              (line) {
                try {
                  calls.add(line);
                  final part = deltaFrom(line);
                  if (part == null) return;
                  if (part.isEmpty) {
                    lines?.cancel();
                    finish();
                  } else {
                    out.add(TextEvent(part));
                  }
                } catch (e, s) {
                  lines?.cancel();
                  out.addError(e, s);
                  out.close();
                }
              },
              onError: (Object e, StackTrace s) {
                out.addError(e, s);
                out.close();
              },
              onDone: finish,
              cancelOnError: true,
            );
      } catch (e, s) {
        if (cancelled) return;
        out.addError(e, s);
        out.close();
      }
    }

    out = StreamController<ChatEvent>(
      onListen: run,
      onCancel: () {
        cancelled = true;
        return lines?.cancel();
      },
    );
    return out.stream;
  }
}

// One part of the answer stream.
sealed class ChatEvent {}

class TextEvent extends ChatEvent {
  TextEvent(this.text);
  final String text;
}

// The model asks the app to run tools. This comes one time, at the end of the stream.
class ToolCallsEvent extends ChatEvent {
  ToolCallsEvent(this.calls);
  final List<ToolCall> calls;
}

class ToolCall {
  ToolCall(this.id, this.name, this.arguments);
  final String id;
  final String name;
  // The arguments as JSON text.
  final String arguments;

  // The arguments as a map. Text that is not a JSON object gives an empty map.
  Map<String, dynamic> get args {
    try {
      final j = jsonDecode(arguments.isEmpty ? '{}' : arguments);
      return j is Map<String, dynamic> ? j : {};
    } on FormatException {
      return {};
    }
  }

  // The form of the call in the assistant message that goes back to CatChat.
  Map<String, dynamic> toJson() => {
    'id': id,
    'type': 'function',
    'function': {'name': name, 'arguments': arguments.isEmpty ? '{}' : arguments},
  };
}

// Collects the tool calls from the lines of the stream. OpenAI sends the name first and the arguments in parts,
// with an index for each call. Some servers send the full call in one part, with the arguments as an object and no id.
class ToolCallParts {
  final _ids = <int, String>{};
  final _names = <int, String>{};
  final _arguments = <int, StringBuffer>{};

  bool get isNotEmpty => _names.isNotEmpty;

  void add(String line) {
    if (!line.startsWith('data:')) return;
    final data = line.substring(5).trim();
    if (data == '[DONE]' || !data.contains('tool_calls')) return;
    final Object? j;
    try {
      j = jsonDecode(data);
    } on FormatException {
      return;
    }
    if (j is! Map<String, dynamic>) return;
    final choices = j['choices'];
    if (choices is! List || choices.isEmpty) return;
    final delta = (choices.first as Map<String, dynamic>)['delta'];
    final parts = delta is Map<String, dynamic> ? delta['tool_calls'] : null;
    if (parts is! List) return;
    for (var n = 0; n < parts.length; n++) {
      final part = parts[n];
      if (part is! Map<String, dynamic>) continue;
      final index = part['index'] is int ? part['index'] as int : n;
      final id = part['id'];
      if (id is String && id.isNotEmpty) _ids[index] = id;
      final function = part['function'];
      if (function is! Map<String, dynamic>) continue;
      final name = function['name'];
      if (name is String && name.isNotEmpty) _names[index] = name;
      final arguments = function['arguments'];
      final buffer = _arguments.putIfAbsent(index, StringBuffer.new);
      if (arguments is String) {
        buffer.write(arguments);
      } else if (arguments is Map) {
        buffer.write(jsonEncode(arguments));
      }
    }
  }

  // The complete calls, in index order. Then the collector is empty.
  List<ToolCall> take() {
    final indexes = _names.keys.toList()..sort();
    final calls = [for (final i in indexes) ToolCall(_ids[i] ?? 'call_$i', _names[i]!, _arguments[i]?.toString() ?? '')];
    _ids.clear();
    _names.clear();
    _arguments.clear();
    return calls;
  }
}

// One line of the event stream. Null: no text in this line. Empty: the stream is complete.
String? deltaFrom(String line) {
  if (!line.startsWith('data:')) return null;
  final data = line.substring(5).trim();
  if (data == '[DONE]') return '';
  try {
    final j = jsonDecode(data) as Map<String, dynamic>;
    final error = j['error'];
    if (error != null) throw ApiError('CatChat error: ${error is Map ? error['message'] : error}');
    final choices = j['choices'] as List<dynamic>?;
    if (choices == null || choices.isEmpty) return null;
    final content = ((choices.first as Map<String, dynamic>)['delta'] as Map<String, dynamic>?)?['content'];
    return content is String && content.isNotEmpty ? content : null;
  } on FormatException {
    return null;
  }
}

// The message from a LiteLLM error body, or the start of the body.
String errorMessage(int status, String body) {
  var text = body;
  try {
    final error = (jsonDecode(body) as Map<String, dynamic>)['error'];
    if (error is Map && error['message'] is String) text = error['message'] as String;
  } catch (_) {}
  if (text.length > 300) text = '${text.substring(0, 300)}...';
  return 'CatChat error (HTTP $status): $text';
}
