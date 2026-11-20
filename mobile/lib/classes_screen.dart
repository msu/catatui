// The Classes screen of demo mode: the student's classes this term, with mock data from assets/demo/classes.json.
// See src/md/features/mobile.md, "Mock tools".

// flutter_markdown_plus uses the old material library, so the app uses it too. See src/md/features/mobile.md.
// ignore: deprecated_member_use
import 'package:flutter/material.dart';

import 'chat_screen.dart' show DemoBadge;
import 'demo_tools.dart';

// "in 3 days", "tomorrow", "today", "3 days ago".
String inDays(int days) => switch (days) {
  0 => 'today',
  1 => 'tomorrow',
  -1 => 'yesterday',
  > 0 => 'in $days days',
  _ => '${-days} days ago',
};

// A tap on a class closes the screen with the course code, for example "CSCI 305".
class ClassesScreen extends StatefulWidget {
  const ClassesScreen({super.key, required this.tools});
  final DemoTools tools;

  @override
  State<ClassesScreen> createState() => _ClassesScreenState();
}

class _ClassesScreenState extends State<ClassesScreen> {
  late final Future<Map<String, dynamic>> _classes = widget.tools.file('classes');

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Classes'),
        actions: const [
          Center(child: DemoBadge(playsVideo: true)),
          SizedBox(width: 12),
        ],
      ),
      body: SafeArea(
        child: FutureBuilder(
          future: _classes,
          builder: (context, snapshot) {
            if (snapshot.hasError) return Center(child: Text('The class data did not load (${snapshot.error}).'));
            final data = snapshot.data;
            if (data == null) return const Center(child: CircularProgressIndicator(semanticsLabel: 'Loading classes'));
            final overview = data['overview'] as Map<String, dynamic>;
            final deadlines = data['deadlines'] as Map<String, dynamic>;
            Widget heading(String text) => Padding(
              padding: const EdgeInsets.fromLTRB(4, 20, 4, 6),
              child: Semantics(header: true, child: Text(text, style: theme.textTheme.titleMedium)),
            );
            return ListView(
              padding: const EdgeInsets.all(12),
              children: [
                Text('${overview['term']}. The classes, grades, and dates are mock data.', style: theme.textTheme.bodySmall),
                heading('My classes'),
                for (final k in (overview['classes'] as List).cast<Map<String, dynamic>>())
                  Card(
                    child: ListTile(
                      title: Text('${k['code']}  ${k['title']}'),
                      subtitle: Text(
                        [
                          '${k['instructor']}',
                          '${k['meets']}, ${k['room']}',
                          if (k['next'] != null) 'Next: ${k['next']['name']}, due ${inDays(k['next']['in_days'] as int)}',
                        ].join('\n'),
                      ),
                      isThreeLine: true,
                      trailing: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text('${k['letter']}', style: theme.textTheme.titleLarge),
                          Text('${k['grade']}%', style: theme.textTheme.bodySmall),
                        ],
                      ),
                      onTap: () => Navigator.of(context).pop('${k['code']}'),
                    ),
                  ),
                heading('Late work and work due soon'),
                for (final w in (deadlines['work'] as List).cast<Map<String, dynamic>>())
                  ListTile(
                    dense: true,
                    title: Text('${w['name']}'),
                    subtitle: Text('${w['course']}, ${w['points']} points'),
                    trailing: Text(inDays(w['in_days'] as int)),
                  ),
                heading('Term dates'),
                for (final d in (deadlines['term_dates'] as List).cast<Map<String, dynamic>>())
                  ListTile(dense: true, title: Text('${d['what']}'), subtitle: Text('${d['date']}'), trailing: Text(inDays(d['in_days'] as int))),
              ],
            );
          },
        ),
      ),
    );
  }
}
