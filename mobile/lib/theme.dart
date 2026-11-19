// The MSU light and dark themes (MSU blue and gold). The values agree with themes/msu.json and themes/msu-light.json.

// flutter_markdown_plus uses the old material library, so the app uses it too. See src/md/features/mobile.md.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

const msuBlue = Color(0xFF162960);
const msuBlueLight = Color(0xFF8FB3FF);
const msuGold = Color(0xFFF4B425);

ThemeData msuTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(seedColor: msuBlue, brightness: brightness).copyWith(
    primary: dark ? msuBlueLight : msuBlue,
    onPrimary: dark ? const Color(0xFF0B1533) : Colors.white,
    secondary: msuGold,
    onSecondary: const Color(0xFF1A1A1A),
    surface: dark ? const Color(0xFF101317) : const Color(0xFFF4F4F2),
    onSurface: dark ? const Color(0xFFF4F4F2) : const Color(0xFF1A1A1A),
    surfaceContainer: dark ? const Color(0xFF1A1F26) : Colors.white,
    surfaceContainerHigh: dark ? const Color(0xFF232A33) : Colors.white,
    // The user message has MSU blue in the two themes.
    primaryContainer: dark ? const Color(0xFF24396F) : msuBlue,
    onPrimaryContainer: Colors.white,
  );
  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: scheme.surface,
    appBarTheme: AppBarTheme(
      backgroundColor: dark ? const Color(0xFF1A1F26) : msuBlue,
      foregroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: const Border(bottom: BorderSide(color: msuGold, width: 3)),
    ),
    drawerTheme: DrawerThemeData(backgroundColor: scheme.surfaceContainer),
  );
}
