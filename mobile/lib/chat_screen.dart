// The chat screen: the messages, the message box, the model menu, and the drawer with the saved chats.

// flutter_markdown_plus uses the old material library, so the app uses it too. See src/md/features/mobile.md.
import 'package:flutter/foundation.dart';
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import 'app_state.dart';
import 'chats.dart';
import 'config.dart';
import 'markdown.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key, required this.app});
  final AppState app;

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  // A tap puts the start of a question in the message box, and the student completes it.
  static const _starters = {
    'Explain a concept': 'Explain this concept from my class in simple words: ',
    'Help me debug code': 'Help me find the problem in this code:\n',
    'Quiz me': 'Quiz me on this subject, one question at a time: ',
  };

  final _input = TextEditingController();
  final _inputFocus = FocusNode();

  AppState get app => widget.app;

  @override
  void dispose() {
    _input.dispose();
    _inputFocus.dispose();
    super.dispose();
  }

  void _send() {
    if (app.busy || _input.text.trim().isEmpty) return;
    HapticFeedback.lightImpact();
    app.send(_input.text);
    _input.clear();
  }

  void _stop() {
    HapticFeedback.lightImpact();
    app.stop();
  }

  void _start(String text) {
    _input.value = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
    _inputFocus.requestFocus();
  }

  // On iOS, Return on a hardware keyboard sends, and Shift+Return makes a new line. The screen keyboard sends no key events.
  // Not on Android: some screen keyboards there send the Return key event.
  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    final enter = event.logicalKey == LogicalKeyboardKey.enter || event.logicalKey == LogicalKeyboardKey.numpadEnter;
    if (defaultTargetPlatform != TargetPlatform.iOS || event is! KeyDownEvent || !enter || HardwareKeyboard.instance.isShiftPressed) {
      return KeyEventResult.ignored;
    }
    _send();
    return KeyEventResult.handled;
  }

  void _modelMenu() {
    final models = menuOrder(app.models);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheet) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        minChildSize: 0.3,
        maxChildSize: 0.95,
        snap: true,
        snapSizes: const [0.6],
        // The handle is in the list, so a drag on it (or on the list) moves the sheet: up makes it taller, down closes it.
        // The handle of showModalBottomSheet (showDragHandle) is not a part of the DraggableScrollableSheet: a drag up on it did nothing.
        builder: (_, scroll) => ListView(
          controller: scroll,
          children: [
            Center(
              child: Container(
                key: const ValueKey('sheet-handle'),
                width: 36,
                height: 4,
                margin: const EdgeInsets.symmetric(vertical: 12),
                decoration: BoxDecoration(color: Theme.of(sheet).colorScheme.onSurfaceVariant, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text('Model', style: Theme.of(sheet).textTheme.titleLarge),
            ),
            for (final id in models)
              ListTile(
                title: Text(modelName(id)),
                subtitle: Text([?modelNotes[id], id].join('\n')),
                isThreeLine: modelNotes[id] != null,
                selected: id == app.model,
                selectedTileColor: Theme.of(sheet).colorScheme.secondary.withValues(alpha: 0.15),
                trailing: id == app.model ? const Icon(Icons.check_circle, semanticLabel: 'Current model') : null,
                onTap: () {
                  app.selectModel(id);
                  Navigator.of(sheet).pop();
                },
              ),
            if (models.isEmpty) const ListTile(title: Text('CatChat gave no model list. Check your network connection.')),
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
          label: Text(app.model == null ? 'No model' : modelName(app.model!), overflow: TextOverflow.ellipsis),
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
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Image.asset('assets/logo.png', height: 96, semanticLabel: 'catai logo'),
                            const SizedBox(height: 12),
                            Text('Ask CatChat a question.', style: theme.textTheme.titleMedium),
                            const SizedBox(height: 16),
                            Wrap(
                              alignment: WrapAlignment.center,
                              spacing: 8,
                              runSpacing: 4,
                              children: [for (final s in _starters.entries) ActionChip(label: Text(s.key), onPressed: () => _start(s.value))],
                            ),
                          ],
                        ),
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
                          return MessageView(message: m, thinking: app.busy && i == 0 && m.text.isEmpty, complete: !(app.busy && i == 0));
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
                    child: Focus(
                      onKeyEvent: _onKey,
                      child: TextField(
                        controller: _input,
                        focusNode: _inputFocus,
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
                  ),
                  const SizedBox(width: 4),
                  app.busy
                      ? IconButton.filled(
                          onPressed: _stop,
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
  const MessageView({super.key, required this.message, this.thinking = false, this.complete = true});
  final Message message;
  final bool thinking;
  // False while the answer comes. A complete answer has a Copy button.
  final bool complete;

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
    final code = TextStyle(fontFamily: monoFont, fontSize: 14, backgroundColor: theme.colorScheme.surfaceContainer);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // SelectionArea makes the text selectable with a long press. With selectable text widgets (selectable: true),
          // a drag on a wide table or a long code line selects text and does not scroll.
          SelectionArea(
            child: MarkdownBody(
              data: fixTables(message.text),
              builders: {'pre': CodeBlockBuilder()},
              onTapLink: (_, href, _) {
                final uri = href == null ? null : Uri.tryParse(href);
                if (uri != null && (uri.scheme == 'https' || uri.scheme == 'http')) launchUrl(uri, mode: LaunchMode.externalApplication);
              },
              styleSheet: MarkdownStyleSheet.fromTheme(theme).copyWith(
                p: theme.textTheme.bodyLarge,
                code: code,
                // CodeBlockBuilder draws the box of a code block.
                codeblockDecoration: const BoxDecoration(),
                codeblockPadding: EdgeInsets.zero,
                // A wide table scrolls to the side.
                tableColumnWidth: const IntrinsicColumnWidth(),
                tableCellsPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                tableBorder: TableBorder.all(color: theme.dividerColor),
                tableHead: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
                tableBody: theme.textTheme.bodyMedium,
              ),
            ),
          ),
          if (complete)
            IconButton(
              onPressed: () => copyText(context, message.text),
              tooltip: 'Copy answer',
              visualDensity: VisualDensity.compact,
              iconSize: 18,
              icon: const Icon(Icons.copy),
            ),
        ],
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
                              trailing: PopupMenuButton<String>(
                                tooltip: 'Chat menu',
                                icon: const Icon(Icons.more_horiz),
                                onSelected: (_) => app.deleteChat(c),
                                itemBuilder: (_) => const [PopupMenuItem(value: 'delete', child: Text('Delete'))],
                              ),
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
