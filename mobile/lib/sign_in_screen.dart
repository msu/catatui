// The sign-in screen: MSU SSO in the system sign-in sheet, or a pasted key. See src/md/features/mobile.md.

import 'package:flutter/services.dart';

// flutter_markdown_plus uses the old material library, so the app uses it too. See src/md/features/mobile.md.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:url_launcher/url_launcher.dart';

import 'app_state.dart';
import 'auth.dart';
import 'config.dart';

const networkNote = 'The sign-in pages work only on the MSU network. If a page does not load, connect to the MSU VPN.';

class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key, required this.app});
  final AppState app;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  bool _busy = false;
  String? _error;

  // Run one sign-in. Every error shows under the buttons: before, only a SignInError did, and any other error
  // (for example a reply that is not JSON) stopped the spinner with no message.
  Future<void> _run(Future<Credential?> Function() signIn) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final c = await signIn();
      if (c != null) await widget.app.signIn(c);
    } on SignInError catch (e) {
      _error = e.message;
    } catch (e) {
      _error = 'The sign-in did not finish ($e). Try again.';
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // The system sheet is Safari (or Chrome), so Paste, password AutoFill and the MSU MFA prompts work as in the
  // browser. preferEphemeral: no cookies are kept, so a different student can sign in on the same phone, and iOS
  // does not ask "catai wants to use ... to sign in".
  Future<Credential?> _sso() async {
    final problem = await signInPageProblem(widget.app.client);
    if (problem != null) throw SignInError('$problem $networkNote');
    final request = SsoRequest();
    final forwarder = await LoopbackForwarder.start();
    // The student may leave the app during the sign-in (the Authenticator app, a password app).
    final lifecycle = AppLifecycleListener(onResume: () => forwarder.ensureListening());
    final String result;
    try {
      result = await FlutterWebAuth2.authenticate(
        url: request.url.toString(),
        callbackUrlScheme: appCallbackScheme,
        options: const FlutterWebAuth2Options(preferEphemeral: true),
      );
    } on PlatformException catch (e) {
      if (e.code == 'CANCELED') return null;
      throw SignInError('The sign-in page did not open (${e.message ?? e.code}). Try again.');
    } finally {
      lifecycle.dispose();
      await forwarder.close();
    }
    return request.exchange(widget.app.client, request.codeFrom(Uri.parse(result)));
  }

  Future<Credential?> _paste() async {
    final raw = await showDialog<String>(context: context, builder: (_) => const PasteKeyDialog());
    if (raw == null) return null;
    return pastedKey(widget.app.client, raw);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Image.asset('assets/logo.png', height: 120, semanticLabel: 'catai logo'),
                  const SizedBox(height: 16),
                  Text('catai', textAlign: TextAlign.center, style: theme.textTheme.headlineMedium),
                  const SizedBox(height: 4),
                  Text('CatChat for Montana State University', textAlign: TextAlign.center, style: theme.textTheme.bodyMedium),
                  const SizedBox(height: 32),
                  FilledButton(
                    onPressed: _busy ? null : () => _run(_sso),
                    child: const Padding(padding: EdgeInsets.all(12), child: Text('Sign in with your MSU account')),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: _busy ? null : () => _run(_paste),
                    child: const Padding(padding: EdgeInsets.all(12), child: Text('Paste a key')),
                  ),
                  const SizedBox(height: 24),
                  if (_busy) const Center(child: CircularProgressIndicator()),
                  if (_error != null)
                    Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  const SizedBox(height: 16),
                  Text(networkNote, textAlign: TextAlign.center, style: theme.textTheme.bodySmall),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class PasteKeyDialog extends StatefulWidget {
  const PasteKeyDialog({super.key});

  @override
  State<PasteKeyDialog> createState() => _PasteKeyDialogState();
}

class _PasteKeyDialogState extends State<PasteKeyDialog> {
  final _key = TextEditingController();

  @override
  void dispose() {
    _key.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Paste a key'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              '1. Open catchat access.\n'
              '2. Tap "API Keys" and then "+ Free Key".\n'
              '3. Give the key a unique name and select "Student" as your Team.\n'
              '4. Tap "Create Key", copy the key, and paste it here.',
            ),
            TextButton(
              onPressed: () => launchUrl(Uri.parse(catchatAccess), mode: LaunchMode.externalApplication),
              child: const Text('Open catchat access'),
            ),
            TextField(
              controller: _key,
              autocorrect: false,
              enableSuggestions: false,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Key', border: OutlineInputBorder()),
              onSubmitted: (v) => Navigator.of(context).pop(v),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.of(context).pop(_key.text), child: const Text('Sign In')),
      ],
    );
  }
}
