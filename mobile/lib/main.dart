// catai for phones: a CatChat chat client for MSU students. See src/md/features/mobile.md.

import 'dart:io';

// flutter_markdown_plus uses the old material library, so the app uses it too. See src/md/features/mobile.md.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'app_state.dart';
import 'chat_screen.dart';
import 'chats.dart';
import 'sign_in_screen.dart';
import 'theme.dart';

// The Keychain on iOS and the Keystore on Android.
class PhoneSecrets implements Secrets {
  static const _storage = FlutterSecureStorage();

  @override
  Future<String?> read(String name) => _storage.read(key: name);
  @override
  Future<void> write(String name, String value) => _storage.write(key: name, value: value);
  @override
  Future<void> delete(String name) => _storage.delete(key: name);
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final documents = await getApplicationDocumentsDirectory();
  final app = AppState(secrets: PhoneSecrets(), store: ChatStore(Directory('${documents.path}/chats')), client: http.Client());
  app.load();
  runApp(CataiApp(app: app));
}

class CataiApp extends StatelessWidget {
  const CataiApp({super.key, required this.app});
  final AppState app;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'catai',
      debugShowCheckedModeBanner: false,
      theme: msuTheme(Brightness.light),
      darkTheme: msuTheme(Brightness.dark),
      home: ListenableBuilder(
        listenable: app,
        builder: (_, _) {
          if (!app.loaded) return const Scaffold(body: Center(child: CircularProgressIndicator()));
          return app.credential == null ? SignInScreen(app: app) : ChatScreen(app: app);
        },
      ),
    );
  }
}
