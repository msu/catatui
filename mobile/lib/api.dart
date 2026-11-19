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

  // The answer text, one part at a time. To stop, cancel the subscription: this closes the connection at once.
  // The thinking of the model (reasoning_content) is not in the stream.
  Stream<String> chat({required String key, required String model, required List<Map<String, String>> messages}) {
    StreamSubscription<String>? lines;
    var cancelled = false;
    late final StreamController<String> out;

    Future<void> run() async {
      try {
        final req = http.Request('POST', Uri.parse('$catchatApi/v1/chat/completions'))
          ..headers.addAll(_headers(key))
          ..body = jsonEncode({'model': model, 'messages': messages, 'stream': true});
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
                  final part = deltaFrom(line);
                  if (part == null) return;
                  if (part.isEmpty) {
                    lines?.cancel();
                    out.close();
                  } else {
                    out.add(part);
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
              onDone: () => out.close(),
              cancelOnError: true,
            );
      } catch (e, s) {
        if (cancelled) return;
        out.addError(e, s);
        out.close();
      }
    }

    out = StreamController<String>(
      onListen: run,
      onCancel: () {
        cancelled = true;
        return lines?.cancel();
      },
    );
    return out.stream;
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
