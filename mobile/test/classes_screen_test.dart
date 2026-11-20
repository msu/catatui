import 'dart:io';

import 'package:catai/classes_screen.dart';
import 'package:catai/demo_tools.dart';
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'screens_test.dart' show loadFonts, shots;

void main() {
  final tools = DemoTools((path) => File(path).readAsString());

  test('inDays', () {
    expect([inDays(0), inDays(1), inDays(-1), inDays(8), inDays(-3)], ['today', 'tomorrow', 'yesterday', 'in 8 days', '3 days ago']);
  });

  testWidgets('the Classes screen shows the classes, the work due, and the term dates', (tester) async {
    tester.view.physicalSize = const Size(1179, 2556);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    String? picked;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () async => picked = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => ClassesScreen(tools: tools))),
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    // The mock data file loads from the disk.
    await tester.runAsync(() => tools.file('classes'));
    await tester.pumpAndSettle();

    expect(find.text('DEMO'), findsOneWidget);
    if (shots != null) {
      await tester.runAsync(loadFonts);
      await tester.pumpAndSettle();
      await expectLater(find.byType(MaterialApp), matchesGoldenFile('$shots/classes.png'));
    }
    expect(find.textContaining('mock data'), findsOneWidget);
    expect(find.text('CSCI 305  Concepts of Programming Languages'), findsOneWidget);
    expect(find.textContaining('Dr. Morgan Hale (mock)'), findsOneWidget);
    expect(find.textContaining('Next: Quiz 5: Closures, due tomorrow'), findsOneWidget);
    expect(find.text('83.7%'), findsOneWidget);
    // The list builds only the rows near the screen, so scroll to the last class.
    await tester.scrollUntilVisible(find.textContaining('PHSX 222  Physics II'), 200);
    await tester.scrollUntilVisible(find.text('Late work and work due soon'), 200);
    await tester.scrollUntilVisible(find.text('Term dates'), 300);
    expect(find.textContaining('Last day to withdraw'), findsOneWidget);

    // A tap on a class closes the screen with the course code.
    await tester.scrollUntilVisible(find.text('M 221  Introduction to Linear Algebra'), -300);
    await tester.tap(find.text('M 221  Introduction to Linear Algebra'));
    await tester.pumpAndSettle();
    expect(picked, 'M 221');
  });
}
