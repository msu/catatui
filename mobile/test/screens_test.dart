import 'dart:convert';
import 'dart:io';

import 'package:catai/app_state.dart';
import 'package:catai/auth.dart';
import 'package:catai/chat_screen.dart';
import 'package:catai/chats.dart';
import 'package:catai/main.dart';
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'app_state_test.dart' show MemorySecrets, delta;

// CATAI_SHOTS=<folder> saves a picture of each screen there (with real fonts).
final shots = Platform.environment['CATAI_SHOTS'];

Future<void> loadFonts() async {
  final fonts = Directory('${File(Platform.resolvedExecutable).parent.parent.parent.path}/material_fonts');
  for (final family in ['Roboto', 'MaterialIcons']) {
    final loader = FontLoader(family);
    for (final f in fonts.listSync().whereType<File>()) {
      final name = f.uri.pathSegments.last;
      if (name == '$family-Regular.ttf' || name == '$family-Medium.ttf' || name == '$family-Bold.ttf' || name == '$family-Regular.otf') {
        loader.addFont(f.readAsBytes().then((b) => ByteData.sublistView(b)));
      }
    }
    await loader.load();
  }
}

void main() {
  late Directory dir;
  late AppState app;

  setUp(() async {
    dir = Directory.systemTemp.createTempSync('catai-screens');
    app = AppState(
      secrets: MemorySecrets(),
      store: ChatStore(dir),
      client: MockClient.streaming((req, body) async {
        if (req.url.path == '/v1/models') {
          return http.StreamedResponse(
            Stream.value(
              utf8.encode(
                jsonEncode({
                  'data': [
                    {'id': 'Qwen3.8-27B'},
                    {'id': 'gpt-oss:120b'},
                  ],
                }),
              ),
            ),
            200,
          );
        }
        return http.StreamedResponse(
          Stream.value(
            utf8.encode(
              '${delta('# Bobcats\n\nThe mascot is **Champ**.\n\n```python\nprint("Go Cats")\n```\n\n| Sport | Season | Place |\n|---|---|\n| Football | Fall | Bobcat Stadium |\n\n<b>not bold</b>')}data: [DONE]\n',
            ),
          ),
          200,
        );
      }),
    );
    if (shots != null) await loadFonts();
  });
  tearDown(() {
    if (dir.existsSync()) dir.deleteSync(recursive: true);
  });

  Future<void> start(WidgetTester tester, {Brightness brightness = Brightness.light, bool signedIn = true}) async {
    tester.view.physicalSize = const Size(1179, 2556);
    tester.view.devicePixelRatio = 3;
    tester.platformDispatcher.platformBrightnessTestValue = brightness;
    addTearDown(tester.view.reset);
    addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
    await tester.runAsync(() async {
      await app.load();
      if (signedIn) await app.signIn(Credential(key: 'sk-a', expires: DateTime.now().add(const Duration(days: 100)), user: 'jane_catai-mobile'));
    });
    await tester.pumpWidget(CataiApp(app: app));
    await tester.runAsync(() => precacheImage(const AssetImage('assets/logo.png'), tester.element(find.byType(MaterialApp))));
    await tester.pumpAndSettle();
  }

  Future<void> shot(WidgetTester tester, String name) async {
    if (shots == null) return;
    await expectLater(find.byType(MaterialApp), matchesGoldenFile('$shots/$name.png'));
  }

  Future<void> ask(WidgetTester tester, String text) async {
    await tester.enterText(find.byType(TextField), text);
    await tester.tap(find.byTooltip('Send'));
    await tester.runAsync(() async {
      while (app.busy) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      await Future<void>.delayed(const Duration(milliseconds: 30));
    });
    await tester.pumpAndSettle();
  }

  testWidgets('with no key, the sign-in screen shows', (tester) async {
    await start(tester, signedIn: false);
    expect(find.text('Sign in with your MSU account'), findsOneWidget);
    expect(find.text('Paste a key'), findsOneWidget);
    await shot(tester, 'sign-in');

    await tester.tap(find.text('Paste a key'));
    // The spinner behind the dialog turns, so pumpAndSettle does not end.
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Open catchat access'), findsOneWidget);
    await shot(tester, 'paste-key');
  });

  testWidgets('a question gets an answer as markdown, and HTML shows as text', (tester) async {
    await start(tester);
    expect(find.text('Qwen 3.8'), findsOneWidget);
    expect(find.text('Quiz me'), findsOneWidget);
    expect(find.text('Ask CatChat a question.'), findsOneWidget);
    await shot(tester, 'chat-empty');

    await ask(tester, 'Who is the MSU mascot?');
    expect(find.text('Who is the MSU mascot?'), findsOneWidget);
    expect(find.text('Bobcats', findRichText: true), findsOneWidget);
    expect(find.textContaining('<b>not bold</b>', findRichText: true), findsOneWidget);
    // The table shows as a table, and the code block has its language and a Copy button.
    expect(find.byType(Table), findsOneWidget);
    expect(find.text('Bobcat Stadium', findRichText: true), findsOneWidget);
    expect(find.text('python'), findsOneWidget);
    expect(find.text('print("Go Cats")'), findsOneWidget);
    expect(find.byTooltip('Copy answer'), findsOneWidget);
    expect(find.byTooltip('Send'), findsOneWidget);
    await shot(tester, 'chat');
  });

  testWidgets('dark theme', (tester) async {
    await start(tester, brightness: Brightness.dark);
    await ask(tester, 'Who is the MSU mascot?');
    expect(Theme.of(tester.element(find.byType(Scaffold))).brightness, Brightness.dark);
    await shot(tester, 'chat-dark');
  });

  testWidgets('the model menu selects a model', (tester) async {
    await start(tester);
    await tester.tap(find.text('Qwen 3.8'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Fastest'), findsOneWidget);
    await shot(tester, 'models');
    // The current model has a check mark. Each row has the name, the note, and the id.
    expect(find.descendant(of: find.widgetWithText(ListTile, 'Qwen 3.8'), matching: find.byIcon(Icons.check_circle)), findsOneWidget);
    expect(find.byIcon(Icons.check_circle), findsOneWidget);
    expect(find.textContaining('gpt-oss:120b'), findsOneWidget);
    await tester.tap(find.text('GPT-OSS 120B'));
    await tester.pumpAndSettle();
    expect(app.model, 'gpt-oss:120b');
    expect(find.text('GPT-OSS 120B'), findsOneWidget);
  });

  testWidgets('the drawer lists the saved chats, and sign-out asks first', (tester) async {
    await start(tester);
    await ask(tester, 'Who is the MSU mascot?');
    await tester.tap(find.byTooltip('Open navigation menu'));
    await tester.pumpAndSettle();
    expect(find.text('jane_catai-mobile'), findsOneWidget);
    expect(find.widgetWithText(ListTile, 'Who is the MSU mascot?'), findsOneWidget);
    await shot(tester, 'drawer');

    await tester.tap(find.text('Sign Out'));
    await tester.pumpAndSettle();
    expect(find.textContaining('all chats'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Sign Out'));
    // Sign-out has some file steps. Each step needs real time, then a pump.
    for (var i = 0; i < 10 && app.credential != null || i < 5; i++) {
      await tester.pump();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 20)));
    }
    await tester.pumpAndSettle();
    expect(find.text('Sign in with your MSU account'), findsOneWidget);
  });

  testWidgets('Copy on a code block puts the code on the clipboard', (tester) async {
    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') copied = (call.arguments as Map)['text'] as String;
      return null;
    });
    await start(tester);
    await ask(tester, 'Who is the MSU mascot?');
    await tester.tap(find.text('Copy'));
    await tester.pump();
    expect(copied, 'print("Go Cats")');
    expect(find.text('Copied'), findsOneWidget);
    await tester.tap(find.byTooltip('Copy answer'));
    await tester.pump();
    expect(copied, startsWith('# Bobcats'));
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
  });

  testWidgets('a starter prompt puts the start of a question in the message box', (tester) async {
    await start(tester);
    await tester.tap(find.text('Quiz me'));
    await tester.pump();
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, startsWith('Quiz me on this subject'));
    expect(app.chat.messages, isEmpty);
  });

  testWidgets('on iOS, Return on a hardware keyboard sends, and Shift+Return does not', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    await start(tester);
    await tester.enterText(find.byType(TextField), 'Hi');
    await tester.tap(find.byType(TextField));
    await tester.pump();
    await tester.sendKeyDownEvent(LogicalKeyboardKey.shiftLeft);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.sendKeyUpEvent(LogicalKeyboardKey.shiftLeft);
    expect(app.chat.messages, isEmpty);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    expect(app.chat.messages.first.text, 'Hi');
    await tester.runAsync(() async {
      while (app.busy) {
        await Future<void>.delayed(const Duration(milliseconds: 5));
      }
      await Future<void>.delayed(const Duration(milliseconds: 30));
    });
    await tester.pumpAndSettle();
    debugDefaultTargetPlatformOverride = null;
  });

  testWidgets('the chat menu in the drawer deletes a chat', (tester) async {
    await start(tester);
    await ask(tester, 'Who is the MSU mascot?');
    await tester.tap(find.byTooltip('Open navigation menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Chat menu'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete'));
    await tester.pump();
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 50)));
    await tester.pumpAndSettle();
    expect(app.chats, isEmpty);
    expect(find.text('No saved chats'), findsOneWidget);
  });

  testWidgets('a long code line and a wide table scroll to the side', (tester) async {
    tester.view.physicalSize = const Size(1179, 2556);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final message = Message(
      'assistant',
      '```python\nprint("a very long line of code that is much wider than the phone screen and must scroll to the side")\n```\n\n'
          '| Algorithm | Best case | Average case | Worst case | Space |\n|---|---|---|---|---|\n'
          '| Radix sort | O(d·(n + k)) | O(d·(n + k)) | O(d·(n + k)) | O(n + k) |\n',
    );
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ListView(reverse: true, shrinkWrap: true, children: [MessageView(message: message)]),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final views = find.byWidgetPredicate((w) => w is SingleChildScrollView && w.scrollDirection == Axis.horizontal);
    expect(views, findsNWidgets(2));
    for (final view in views.evaluate().map((e) => e.widget)) {
      final position = tester.state<ScrollableState>(find.descendant(of: find.byWidget(view), matching: find.byType(Scrollable)).first).position;
      expect(position.maxScrollExtent, greaterThan(100));
      // The drag starts on the text. Selectable text took this drag, and the view did not scroll.
      // The text is wider than the screen, so the drag starts near its left side, not at its center.
      final text = find.descendant(of: find.byWidget(view), matching: find.byType(RichText)).first;
      await tester.dragFrom(tester.getTopLeft(text) + const Offset(250, 6), const Offset(-200, 0));
      await tester.pumpAndSettle();
      expect(position.pixels, greaterThan(100));
    }
  });

  testWidgets('a drag up on the handle makes the model sheet taller', (tester) async {
    await start(tester);
    await tester.tap(find.text('Qwen 3.8'));
    await tester.pumpAndSettle();
    final handle = find.byKey(const ValueKey('sheet-handle'));
    final before = tester.getTopLeft(handle).dy;
    await tester.drag(handle, const Offset(0, -300));
    await tester.pumpAndSettle();
    expect(find.text('Model'), findsOneWidget);
    expect(tester.getTopLeft(handle).dy, lessThan(before - 100));
    // A drag down closes the sheet.
    await tester.drag(handle, const Offset(0, 900));
    await tester.pumpAndSettle();
    expect(find.text('Model'), findsNothing);
  });
}
