// Demo mode: a tap on the DEMO badge plays a short video of the demo (assets/demo/demo_video.mp4, 43 s, no sound,
// with captions in the video). See src/md/features/mobile.md, "Demo video".

// flutter_markdown_plus uses the old material library, so the app uses it too. See src/md/features/mobile.md.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

const demoVideoAsset = 'assets/demo/demo_video.mp4';

// Tests give a controller factory: video_player needs the platform player.
Future<void> showDemoVideo(BuildContext context, {VideoPlayerController Function()? controller}) => showDialog<void>(
  context: context,
  barrierColor: Colors.black87,
  builder: (_) => DemoVideoDialog(controller: controller ?? () => VideoPlayerController.asset(demoVideoAsset)),
);

class DemoVideoDialog extends StatefulWidget {
  const DemoVideoDialog({super.key, required this.controller});
  final VideoPlayerController Function() controller;

  @override
  State<DemoVideoDialog> createState() => _DemoVideoDialogState();
}

class _DemoVideoDialogState extends State<DemoVideoDialog> {
  late final VideoPlayerController _video = widget.controller();
  bool _ready = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    try {
      await _video.initialize();
      await _video.setVolume(0);
      _video.addListener(_changed);
      await _video.play();
      if (mounted) setState(() => _ready = true);
    } catch (e) {
      if (mounted) setState(() => _error = 'The demo video could not play.');
    }
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  bool get _ended => _ready && _video.value.position >= _video.value.duration && !_video.value.isPlaying;

  Future<void> _toggle() async {
    if (!_ready) return;
    if (_ended) {
      await _video.seekTo(Duration.zero);
      await _video.play();
    } else if (_video.value.isPlaying) {
      await _video.pause();
    } else {
      await _video.play();
    }
  }

  @override
  void dispose() {
    _video.removeListener(_changed);
    _video.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final size = MediaQuery.sizeOf(context);
    final aspect = _ready ? _video.value.aspectRatio : 480 / 1170;
    final playing = _ready && _video.value.isPlaying;
    return Dialog(
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: size.height * 0.85),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 4, 4),
              child: Row(
                children: [
                  Expanded(child: Text('catai demo', style: theme.textTheme.titleMedium)),
                  IconButton(tooltip: 'Close', icon: const Icon(Icons.close), onPressed: () => Navigator.of(context).pop()),
                ],
              ),
            ),
            Flexible(
              child: AspectRatio(
                aspectRatio: aspect,
                child: _error != null
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(_error!, textAlign: TextAlign.center),
                        ),
                      )
                    : !_ready
                    ? const Center(child: CircularProgressIndicator())
                    : Semantics(
                        button: true,
                        label: _ended ? 'Play the demo video again' : (playing ? 'Pause the demo video' : 'Play the demo video'),
                        child: GestureDetector(
                          onTap: _toggle,
                          child: Stack(
                            fit: StackFit.expand,
                            children: [
                              VideoPlayer(_video),
                              if (!playing)
                                Center(
                                  child: DecoratedBox(
                                    decoration: const BoxDecoration(color: Colors.black54, shape: BoxShape.circle),
                                    child: Padding(
                                      padding: const EdgeInsets.all(12),
                                      child: Icon(_ended ? Icons.replay : Icons.play_arrow, color: Colors.white, size: 40),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
              ),
            ),
            if (_ready) VideoProgressIndicator(_video, allowScrubbing: true, padding: const EdgeInsets.symmetric(vertical: 4)),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 12),
              child: Text('Mock student data. Tap the video to pause.', style: theme.textTheme.bodySmall, textAlign: TextAlign.center),
            ),
          ],
        ),
      ),
    );
  }
}
