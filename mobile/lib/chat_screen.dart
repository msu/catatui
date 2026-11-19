// The chat screen: the messages, the message box, the model menu, and the drawer with the saved chats.

// flutter_markdown_plus uses the old material library, so the app uses it too. See src/md/features/mobile.md.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import 'app_state.dart';
import 'chats.dart';
import 'config.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.app});
  final AppState app;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _input = TextEditingController();

  AppState get app => widget.app;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  void _send() {
    if (app.busy || _input.text.trim().isEmpty) return;
    app.send(_input.text);
    _input.clear();
  }

  void _modelMenu() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheet) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final id in app.models)
              ListTile(
                title: Text(id),
                subtitle: modelNotes[id] == null ? null : Text(modelNotes[id]!),
                trailing: id == app.model ? const Icon(Icons.check, semanticLabel: 'Selected') : null,
                onTap: () {
                  app.selectModel(id);
                  Navigator.of(sheet).pop();
                },
              ),
            if (app.models.isEmpty) const ListTile(title: Text('CatChat gave no model list. Check your network connection.')),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final messages = app.chat.messages;
    final credential = app.credential;
    return Scaffold(
      appBar: AppBar(
        title: TextButton.icon(
          onPressed: _modelMenu,
          style: TextButton.styleFrom(foregroundColor: Colors.white),
          icon: const Icon(Icons.arrow_drop_down),
          iconAlignment: IconAlignment.end,
          label: Text(app.model ?? 'No model', overflow: TextOverflow.ellipsis),
        ),
        actions: [IconButton(onPressed: app.newChat, tooltip: 'New Chat', icon: const Icon(Icons.add_comment_outlined))],
      ),
      drawer: ChatDrawer(app: app),
      body: SafeArea(
        child: Column(
          children: [
            if (credential != null && credential.expiresSoon)
              MaterialBanner(
                content: Text('Your CatChat key expires in ${credential.daysLeft} days. Sign out, then sign in again to get a new key.'),
                actions: const [SizedBox.shrink()],
              ),
            Expanded(
              child: messages.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Image.asset('assets/logo.png', height: 96, semanticLabel: 'catai logo'),
                          const SizedBox(height: 12),
                          Text('Ask CatChat a question.', style: theme.textTheme.titleMedium),
                        ],
                      ),
                    )
                  // The list is in reverse, so it stays at the bottom while the answer comes.
                  // shrinkWrap and the top alignment put a short chat at the top of the screen.
                  : Align(
                      alignment: Alignment.topCenter,
                      child: ListView.builder(
                        reverse: true,
                        shrinkWrap: true,
                        padding: const EdgeInsets.all(12),
                        itemCount: messages.length,
                        itemBuilder: (_, i) {
                          final m = messages[messages.length - 1 - i];
                          return MessageView(message: m, thinking: app.busy && i == 0 && m.text.isEmpty);
                        },
                      ),
                    ),
            ),
            if (app.error != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Text(app.error!, style: TextStyle(color: theme.colorScheme.error)),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 8, 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _input,
                      minLines: 1,
                      maxLines: 6,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(
                        hintText: 'Message CatChat',
                        filled: true,
                        fillColor: theme.colorScheme.surfaceContainer,
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(24)),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      ),
                    ),
                  ),
                  const SizedBox(width: 4),
                  app.busy
                      ? IconButton.filled(
                          onPressed: app.stop,
                          tooltip: 'Stop',
                          style: IconButton.styleFrom(backgroundColor: theme.colorScheme.error, foregroundColor: theme.colorScheme.onError),
                          icon: const Icon(Icons.stop),
                        )
                      : IconButton.filled(onPressed: _send, tooltip: 'Send', icon: const Icon(Icons.arrow_upward)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class MessageView extends StatelessWidget {
  const MessageView({super.key, required this.message, this.thinking = false});
  final Message message;
  final bool thinking;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (message.role == 'user') {
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: const EdgeInsets.only(left: 48, top: 6, bottom: 6),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(color: theme.colorScheme.primaryContainer, borderRadius: BorderRadius.circular(16)),
          child: SelectableText(message.text, style: TextStyle(color: theme.colorScheme.onPrimaryContainer, fontSize: 16)),
        ),
      );
    }
    if (thinking) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
            const SizedBox(width: 10),
            Text('Thinking...', style: theme.textTheme.bodyMedium),
          ],
        ),
      );
    }
    // flutter_markdown shows HTML in the answer as text.
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: MarkdownBody(
        data: message.text,
        selectable: true,
        onTapLink: (_, href, _) {
          final uri = href == null ? null : Uri.tryParse(href);
          if (uri != null && (uri.scheme == 'https' || uri.scheme == 'http')) launchUrl(uri, mode: LaunchMode.externalApplication);
        },
        styleSheet: MarkdownStyleSheet.fromTheme(theme).copyWith(
          p: theme.textTheme.bodyLarge,
          code: TextStyle(fontFamily: 'monospace', fontSize: 14, backgroundColor: theme.colorScheme.surfaceContainer),
          codeblockDecoration: BoxDecoration(
            color: theme.colorScheme.surfaceContainer,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: theme.dividerColor),
          ),
        ),
      ),
    );
  }
}

class ChatDrawer extends StatelessWidget {
  const ChatDrawer({super.key, required this.app});
  final AppState app;

  Future<void> _signOut(BuildContext context) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Sign out?'),
        content: const Text('This removes your CatChat key and all chats from this phone.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(d).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(d).pop(true), child: const Text('Sign Out')),
        ],
      ),
    );
    if (yes == true) await app.signOut();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Drawer(
      child: SafeArea(
        child: Column(
          children: [
            ListTile(
              leading: Image.asset('assets/logo.png', height: 40, semanticLabel: 'catai logo'),
              title: Text('catai', style: theme.textTheme.titleLarge),
              subtitle: app.credential?.user == null ? null : Text(app.credential!.user!),
            ),
            ListTile(
              leading: const Icon(Icons.add_comment_outlined),
              title: const Text('New Chat'),
              onTap: () {
                app.newChat();
                Navigator.of(context).pop();
              },
            ),
            const Divider(height: 1),
            Expanded(
              child: app.chats.isEmpty
                  ? Center(child: Text('No saved chats', style: theme.textTheme.bodySmall))
                  : ListView(
                      padding: EdgeInsets.zero,
                      children: [
                        for (final c in app.chats)
                          Dismissible(
                            key: ValueKey(c.id),
                            direction: DismissDirection.endToStart,
                            background: Container(
                              color: theme.colorScheme.error,
                              alignment: Alignment.centerRight,
                              padding: const EdgeInsets.only(right: 16),
                              child: Icon(Icons.delete, color: theme.colorScheme.onError, semanticLabel: 'Delete'),
                            ),
                            onDismissed: (_) => app.deleteChat(c),
                            child: ListTile(
                              title: Text(c.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                              selected: identical(c, app.chat),
                              onTap: () {
                                app.openChat(c);
                                Navigator.of(context).pop();
                              },
                            ),
                          ),
                      ],
                    ),
            ),
            const Divider(height: 1),
            ListTile(leading: const Icon(Icons.logout), title: const Text('Sign Out'), onTap: () => _signOut(context)),
          ],
        ),
      ),
    );
  }
}
