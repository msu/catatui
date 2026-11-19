// The sign-in screen: MSU SSO in a web view, or a pasted key. See src/md/features/mobile.md.

// flutter_markdown_plus uses the old material library, so the app uses it too. See src/md/features/mobile.md.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';

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

  // Run one sign-in. A SignInError shows under the buttons.
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
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<Credential?> _sso() async {
    final request = SsoRequest();
    final redirect = await Navigator.of(context).push<Uri>(MaterialPageRoute(builder: (_) => SsoPage(request: request)));
    if (redirect == null) return null;
    return request.exchange(widget.app.client, request.codeFrom(redirect));
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

// The App Connect page in a web view. The page closes with the redirect address when the web view goes there.
class SsoPage extends StatefulWidget {
  const SsoPage({super.key, required this.request});
  final SsoRequest request;

  @override
  State<SsoPage> createState() => _SsoPageState();
}

class _SsoPageState extends State<SsoPage> {
  late final WebViewController _web;
  bool _loading = true;
  bool _done = false;

  @override
  void initState() {
    super.initState();
    _web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (req) => _redirect(req.url) ? NavigationDecision.prevent : NavigationDecision.navigate,
          // Some web views do not ask about a server redirect. Then the load of the redirect address starts (and fails).
          onPageStarted: (url) {
            _redirect(url);
            if (mounted) setState(() => _loading = true);
          },
          onPageFinished: (_) {
            if (mounted) setState(() => _loading = false);
          },
        ),
      );
    _start();
  }

  // Remove the cookies first, so a different student can sign in on the same phone.
  Future<void> _start() async {
    await WebViewCookieManager().clearCookies();
    await _web.loadRequest(widget.request.url);
  }

  bool _redirect(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null || !widget.request.isRedirect(uri)) return false;
    if (!_done && mounted) {
      _done = true;
      WebViewCookieManager().clearCookies();
      Navigator.of(context).pop(uri);
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('MSU Sign-In')),
      body: Column(
        children: [
          if (_loading) const LinearProgressIndicator(),
          Expanded(child: WebViewWidget(controller: _web)),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Text(
                'Sign in with your MSU account, then tap "Create key". $networkNote',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ),
        ],
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
