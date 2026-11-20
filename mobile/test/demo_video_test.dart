import 'package:catai/chat_screen.dart';
import 'package:catai/demo_video.dart';
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:video_player/video_player.dart';

Widget _app(Widget child) => MaterialApp(
  home: Scaffold(body: Center(child: child)),
);

void main() {
  testWidgets('a tap on a video DEMO badge opens the demo video, and Close closes it', (tester) async {
    await tester.pumpWidget(_app(const DemoBadge(playsVideo: true)));
    expect(find.bySemanticsLabel('Demo mode: mock data. Play the demo video'), findsOneWidget);
    await tester.tap(find.text('DEMO'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byType(DemoVideoDialog), findsOneWidget);
    expect(find.text('catai demo'), findsOneWidget);
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    expect(find.byType(DemoVideoDialog), findsNothing);
  });

  testWidgets('a plain DEMO badge (the plan card) does not open the video', (tester) async {
    await tester.pumpWidget(_app(const DemoBadge()));
    expect(find.bySemanticsLabel('Demo mode: mock data'), findsOneWidget);
    await tester.tap(find.text('DEMO'));
    await tester.pumpAndSettle();
    expect(find.byType(DemoVideoDialog), findsNothing);
  });

  testWidgets('if the video cannot play, the dialog says so', (tester) async {
    await tester.pumpWidget(
      _app(
        Builder(
          builder: (context) => TextButton(
            onPressed: () => showDemoVideo(context, controller: () => VideoPlayerController.asset('assets/demo/missing.mp4')),
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    for (var i = 0; i < 10; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
    expect(find.text('The demo video could not play.'), findsOneWidget);
  });

  test('the demo video asset is bundled', () {
    expect(demoVideoAsset, 'assets/demo/demo_video.mp4');
  });
}
