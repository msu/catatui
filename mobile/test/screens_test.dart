import 'dart:convert';
import 'dart:io';

import 'package:catai/app_state.dart';
import 'package:catai/auth.dart';
import 'package:catai/chats.dart';
import 'package:catai/main.dart';
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
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
          Stream.value(utf8.encode('${delta('# Bobcats\n\nThe mascot is **Champ**.\n\n```\nprint("Go Cats")\n```\n\n<b>not bold</b>')}data: [DONE]\n')),
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
    expect(find.text('Qwen3.8-27B'), findsOneWidget);
    expect(find.text('Ask CatChat a question.'), findsOneWidget);
    await shot(tester, 'chat-empty');

    await ask(tester, 'Who is the MSU mascot?');
    expect(find.text('Who is the MSU mascot?'), findsOneWidget);
    expect(find.text('Bobcats', findRichText: true), findsOneWidget);
    expect(find.textContaining('<b>not bold</b>', findRichText: true), findsOneWidget);
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
    await tester.tap(find.text('Qwen3.8-27B'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Fastest'), findsOneWidget);
    await shot(tester, 'models');
    await tester.tap(find.text('gpt-oss:120b'));
    await tester.pumpAndSettle();
    expect(app.model, 'gpt-oss:120b');
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
}
