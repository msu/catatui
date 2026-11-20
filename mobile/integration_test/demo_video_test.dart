// Run on a phone or a simulator: flutter test integration_test/demo_video_test.dart -d <device>
// Opens the demo video popup with the real iOS/Android video player and checks that the bundled video plays.

import 'package:catai/chat_screen.dart';
import 'package:catai/demo_video.dart';
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:video_player/video_player.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a tap on the DEMO badge plays the demo video', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: Center(child: DemoBadge(playsVideo: true))),
      ),
    );
    await tester.tap(find.text('DEMO'));
    for (var i = 0; i < 40 && find.byType(VideoPlayer).evaluate().isEmpty; i++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    expect(find.text('The demo video could not play.'), findsNothing);
    expect(find.byType(VideoPlayer), findsOneWidget, reason: 'The video did not start.');
    final video = tester.widget<VideoPlayer>(find.byType(VideoPlayer)).controller;
    expect(video.value.duration, greaterThan(const Duration(seconds: 30)));
    final before = video.value.position;
    // Time for a person (or a screenshot tool) to look at the popup.
    for (var i = 0; i < 20; i++) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    expect(video.value.position, greaterThan(before), reason: 'The video does not play.');
    await tester.tap(find.byTooltip('Close'));
    await tester.pumpAndSettle();
    expect(find.byType(DemoVideoDialog), findsNothing);
  });
}
