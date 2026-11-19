// Run on a phone or a simulator on the MSU network: flutter test integration_test/sso_test.dart -d <device>
// The test opens the real App Connect page in the SSO web view and checks that the MSU sign-in page loads.

import 'package:catai/auth.dart';
import 'package:catai/sign_in_screen.dart';
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('the SSO web view loads the sign-in page', (tester) async {
    await tester.pumpWidget(MaterialApp(home: SsoPage(request: SsoRequest())));
    // Wait for the page, or for the error message.
    for (var i = 0; i < 30; i++) {
      await tester.pump(const Duration(seconds: 1));
      if (find.byType(LinearProgressIndicator).evaluate().isEmpty) break;
    }
    // Time for a person (or a screenshot tool) to look at the page.
    await tester.pump(const Duration(seconds: 8));
    expect(find.text('Try Again'), findsNothing, reason: 'The page did not load.');
    expect(find.byType(LinearProgressIndicator), findsNothing, reason: 'The page still loads.');
  });
}
