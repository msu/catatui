// Markdown help for the answers: table repair and the code block with a Copy button.

import 'package:flutter/foundation.dart';
// flutter_markdown_plus uses the old material library, so the app uses it too. See src/md/features/mobile.md.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:markdown/markdown.dart' as md;

// The monospace font of the phone. Flutter has no "monospace" font on iOS.
String get monoFont => defaultTargetPlatform == TargetPlatform.iOS || defaultTargetPlatform == TargetPlatform.macOS ? 'Menlo' : 'monospace';

final _divider = RegExp(r'^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$');
final _fence = RegExp(r'^\s*(```|~~~)');
final _pipe = RegExp(r'(?<!\\)\|');

// The cells of one table row.
List<String> _cells(String line) {
  var t = line.trim();
  if (t.startsWith('|')) t = t.substring(1);
  if (t.endsWith('|') && !t.endsWith(r'\|')) t = t.substring(0, t.length - 1);
  return [for (final c in t.split(_pipe)) c.trim()];
}

// Repair tables that the markdown package refuses, so they do not show as raw text with "|":
// a divider row with a different number of columns than the header, and empty lines between the rows.
// Text in a code fence does not change.
String fixTables(String text) {
  final lines = text.split('\n');
  final out = <String>[];
  var inFence = false;
  bool isDivider(String l) => l.contains('|') && _divider.hasMatch(l);
  bool isBlank(String l) => l.trim().isEmpty;

  var i = 0;
  while (i < lines.length) {
    final line = lines[i];
    if (_fence.hasMatch(line)) inFence = !inFence;
    if (inFence || !line.contains('|') || isDivider(line)) {
      out.add(line);
      i++;
      continue;
    }
    // A header row: the divider row is the next line, or the line after one empty line.
    var j = i + 1;
    if (j + 1 < lines.length && isBlank(lines[j])) j++;
    if (j >= lines.length || !isDivider(lines[j])) {
      out.add(line);
      i++;
      continue;
    }
    final columns = _cells(line).length;
    final marks = _cells(lines[j]);
    out.add(line);
    out.add('| ${[for (var k = 0; k < columns; k++) k < marks.length && marks[k].isNotEmpty ? marks[k] : '---'].join(' | ')} |');
    i = j + 1;
    // The rows: skip one empty line if a row comes after it.
    while (i < lines.length) {
      if (!isBlank(lines[i]) && lines[i].contains('|') && !_fence.hasMatch(lines[i])) {
        out.add(lines[i]);
        i++;
      } else if (isBlank(lines[i]) && i + 1 < lines.length && lines[i + 1].trimLeft().startsWith('|')) {
        i++;
      } else {
        break;
      }
    }
  }
  return out.join('\n');
}

void copyText(BuildContext context, String text) {
  Clipboard.setData(ClipboardData(text: text));
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(const SnackBar(content: Text('Copied'), duration: Duration(seconds: 1)));
}

// A code block: the language name, a Copy button, and the code in a monospace font. A long line scrolls to the side.
class CodeBlockBuilder extends MarkdownElementBuilder {
  @override
  bool isBlockElement() => true;

  @override
  Widget? visitElementAfterWithContext(BuildContext context, md.Element element, TextStyle? preferredStyle, TextStyle? parentStyle) {
    final theme = Theme.of(context);
    var code = element.textContent;
    if (code.endsWith('\n')) code = code.substring(0, code.length - 1);
    final first = element.children == null || element.children!.isEmpty ? null : element.children!.first;
    final cls = first is md.Element ? first.attributes['class'] ?? '' : '';
    final language = cls.startsWith('language-') ? cls.substring(9) : '';
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainer,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.dividerColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 12),
            child: Row(
              children: [
                Expanded(child: Text(language, style: theme.textTheme.labelMedium)),
                TextButton.icon(
                  onPressed: () => copyText(context, code),
                  icon: const Icon(Icons.copy, size: 16),
                  label: const Text('Copy'),
                  style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                ),
              ],
            ),
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            // Not SelectableText: it takes the drag, and the long line does not scroll. The SelectionArea of the answer selects this text.
            child: Text(
              code,
              softWrap: false,
              style: TextStyle(fontFamily: monoFont, fontSize: 14, height: 1.35, color: theme.colorScheme.onSurface),
            ),
          ),
        ],
      ),
    );
  }
}
