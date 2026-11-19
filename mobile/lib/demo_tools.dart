// The mock tools of demo mode: the fake end points of the demo. The model calls them, and the app runs them on the phone.
// They read the JSON files in assets/demo. See src/md/features/mobile.md, "Mock tools".

import 'dart:convert';

typedef AssetLoader = Future<String> Function(String path);

// The result of one tool call: a short line for the chat, and the text for the model.
class ToolResult {
  ToolResult(this.label, this.text);
  final String label;
  final String text;
}

// The mock student and the mock date. The same student as src/catatui/profile.ts.
const demoToday = '2026-11-03';
const demoSystemPrompt =
    'You are CatChat, an AI assistant for Montana State University students. '
    'Give clear and correct answers. Use markdown, and tables for lists of classes or events.\n\n'
    'The app is in DEMO MODE. All student and university data comes from tools with MOCK DATA. '
    'Say one time, at the start of the conversation, that the data is mock data for a demo.\n'
    'The student is Alex Rivera (mock student), a junior in Computer Science, BS.\n'
    'Today is $demoToday. "This fall" is Fall 2026 (the current term). "Next spring" is Spring 2027.\n\n'
    'For a question about classes, sections, professors, course outlines, a vet school, formal verification, '
    'research labs, clubs, or campus activities, call a tool first. Use only the data from the tools for such facts. '
    'If the tools do not have the data, say so. Do not invent professors, times, requirements, or events.';

Map<String, dynamic> _tool(String name, String description, [Map<String, dynamic> properties = const {}]) => {
  'type': 'function',
  'function': {
    'name': name,
    'description': description,
    'parameters': {'type': 'object', 'properties': properties},
  },
};

class DemoTools {
  DemoTools(this.load);
  final AssetLoader load;
  final _cache = <String, Map<String, dynamic>>{};

  static const mockNote = 'MOCK DATA for a demo. It is not official MSU data.';

  // The tools in the form of the OpenAI chat API.
  static final specs = <Map<String, dynamic>>[
    _tool(
      'catalog_search',
      'The class catalog (mock): sections of a term with instructor (professor), days, time, room, seats, prerequisites, and a short course outline. '
          'Terms: Fall 2026 (current), Spring 2027 (next), Fall 2027 (planned). Use it for "who teaches", "what classes are offered", and "what is this course about".',
      {
        'term': {'type': 'string', 'description': 'For example "Fall 2026" or "Spring 2027". Empty: all terms.'},
        'subject': {'type': 'string', 'description': 'A subject code, for example "CSCI" for computer science, "M" for mathematics, "BIOB", "CHMY".'},
        'course': {'type': 'string', 'description': 'One course, for example "CSCI 305".'},
      },
    ),
    _tool(
      'vet_school_requirements',
      'The admission requirements of a vet school that is not an MSU school (mock school): GPA, required courses with the MSU courses that satisfy each one, '
          'hours with animals, tests, letters, the application dates, and ways to get experience at MSU.',
    ),
    _tool(
      'formal_verification_paths',
      'For a career in formal verification (mock): the MSU classes that help with the reason for each, the research labs that take undergraduates with their contacts, '
          'study groups, research credit, and what employers ask for.',
    ),
    _tool(
      'my_classes',
      "The student's classes this term (mock): each class with instructor, time, room, the grade so far, and the next work due; all work due in the next two weeks; and the term dates.",
    ),
    _tool(
      'class_grades',
      "One of the student's classes (mock): the grade so far with each category and its weight, the grade scale, and all assignments with points, scores, and due dates.",
      {
        'course': {'type': 'string', 'description': 'For example "CSCI 305".'},
      },
    ),
    _tool(
      'grade_needed',
      'Calculates the score that the student needs on one assignment that is not graded yet, to have a target letter grade in the class after that assignment (mock data). '
          'Use it for "what do I need on X to keep an A". Do not do this arithmetic yourself.',
      {
        'course': {'type': 'string', 'description': 'For example "CSCI 305".'},
        'assignment': {'type': 'string', 'description': 'The assignment name or a part of it, for example "HW5" or "Final exam".'},
        'target': {'type': 'string', 'description': 'The target letter grade, for example "A" or "B+". Default: "A".'},
      },
    ),
    _tool(
      'class_syllabus',
      "One of the student's classes (mock): instructor, meeting times, description, grade weights, policies (late work, AI use), the schedule, and short lecture notes.",
      {
        'course': {'type': 'string', 'description': 'For example "CSCI 305".'},
      },
    ),
    _tool(
      'my_transcript',
      "The student's record (mock): name, major, advisor, the courses of each term with grades, the GPA, and the credits. Use it to compare with requirements, for example of a vet school.",
    ),
    _tool(
      'degree_requirements',
      "The requirements of the student's major, Computer Science BS (mock), with the status of each: done, in progress, or missing.",
    ),
    _tool(
      'student_profile',
      'The student (mock): standing, major, college, the contacts (advisor, department chair, dean) with office hours, and the account balance.',
    ),
    _tool('campus_activities', 'Activities at Montana State (mock): events with date, time, place, and cost; student clubs; and recreation.', {
      'category': {'type': 'string', 'description': 'One of: Social, Career, Athletics, Outdoors, Academic, Campus, Clubs, Arts, Recreation. Empty: all.'},
    }),
  ];

  Future<Map<String, dynamic>> _data(String name) async => _cache[name] ??= jsonDecode(await load('assets/demo/$name.json')) as Map<String, dynamic>;

  static String _text(Object? data) => '$mockNote\n${const JsonEncoder.withIndent(' ').convert(data)}';
  static String _arg(Map<String, dynamic> args, String name) => '${args[name] ?? ''}'.trim();
  static String _norm(String s) => s.toUpperCase().replaceAll(RegExp(r'\s+'), '');

  // Run one tool. An unknown tool or bad data gives a result with the problem as text, so the model can tell the student.
  Future<ToolResult> run(String name, Map<String, dynamic> args) async {
    try {
      switch (name) {
        case 'catalog_search':
          return await _catalog(_arg(args, 'term'), _arg(args, 'subject'), _arg(args, 'course'));
        case 'vet_school_requirements':
          final data = Map<String, dynamic>.of(await _data('vet-school'))..remove('mock_note');
          return ToolResult('vet school requirements', _text(data));
        case 'formal_verification_paths':
          final data = Map<String, dynamic>.of(await _data('formal-verification'))..remove('mock_note');
          return ToolResult('formal verification classes and labs', _text(data));
        case 'campus_activities':
          return await _activities(_arg(args, 'category'));
        case 'my_classes':
          final data = await _data('classes');
          return ToolResult('my classes', _text({'overview': data['overview'], 'deadlines': data['deadlines']}));
        case 'class_grades':
          final k = await _class(_arg(args, 'course'));
          if (k == null) return await _noClass('grades', _arg(args, 'course'));
          return ToolResult('grades for ${k['code']}', _text({'grades': k['grades'], 'assignments': k['assignments']}));
        case 'class_syllabus':
          final k = await _class(_arg(args, 'course'));
          if (k == null) return await _noClass('syllabus', _arg(args, 'course'));
          return ToolResult('syllabus for ${k['code']}', _text({'syllabus': k['syllabus'], 'materials': k['materials']}));
        case 'grade_needed':
          return await _gradeNeeded(_arg(args, 'course'), _arg(args, 'assignment'), _arg(args, 'target'));
        case 'my_transcript':
          return ToolResult('my transcript', _text((await _data('advising'))['transcript']));
        case 'degree_requirements':
          return ToolResult('degree requirements', _text((await _data('advising'))['requirements']));
        case 'student_profile':
          final data = Map<String, dynamic>.of(await _data('profile'))..remove('mock_note');
          return ToolResult('student profile', _text(data));
      }
      return ToolResult(name, 'There is no tool with the name "$name".');
    } catch (e) {
      return ToolResult(name, 'The tool "$name" failed: $e');
    }
  }

  Future<ToolResult> _catalog(String term, String subject, String course) async {
    final catalog = await _data('catalog');
    final outlines = catalog['outlines'] as Map<String, dynamic>;
    // "CSCI" is a subject. "CSCI 305" in the subject field is a course.
    if (course.isEmpty && RegExp(r'\d').hasMatch(subject)) {
      course = subject;
      subject = '';
    }
    final terms = <Map<String, dynamic>>[];
    for (final t in (catalog['terms'] as List).cast<Map<String, dynamic>>()) {
      if (term.isNotEmpty && !_norm(t['term'] as String).contains(_norm(term))) continue;
      final sections = [
        for (final s in (t['sections'] as List).cast<Map<String, dynamic>>())
          if ((course.isEmpty || _norm(s['course'] as String) == _norm(course)) &&
              (subject.isEmpty || (s['course'] as String).split(' ').first.toUpperCase() == subject.toUpperCase()))
            {...s, if (outlines[s['course']] != null) 'outline': outlines[s['course']]},
      ];
      if (sections.isNotEmpty) terms.add({'term': t['term'], 'status': t['status'], 'sections': sections});
    }
    final filters = [term, subject, course].where((f) => f.isNotEmpty).join(', ');
    final label = filters.isEmpty ? 'class catalog' : 'class catalog ($filters)';
    if (terms.isEmpty) {
      final all = [for (final t in catalog['terms'] as List) t['term']];
      return ToolResult(label, _text({'result': 'No sections for these filters.', 'terms_in_the_catalog': all, 'hint': 'Try with fewer filters.'}));
    }
    return ToolResult(label, _text({'today': catalog['today'], 'terms': terms}));
  }

  Future<ToolResult> _activities(String category) async {
    final data = await _data('activities');
    final events = [
      for (final e in (data['events'] as List).cast<Map<String, dynamic>>())
        if (category.isEmpty || '${e['category']}'.toLowerCase() == category.toLowerCase()) e,
    ];
    // An unknown category gives all events: better than an empty answer.
    final all = events.isEmpty && category.isNotEmpty;
    return ToolResult(
      category.isEmpty || all ? 'campus activities' : 'campus activities ($category)',
      _text({
        'today': data['today'],
        'events': all ? data['events'] : events,
        if (category.isEmpty || all || category.toLowerCase() == 'clubs') 'clubs': data['clubs'],
        if (category.isEmpty || all || category.toLowerCase() == 'recreation') 'recreation': data['recreation'],
      }),
    );
  }

  // One of the student's classes, by course code ("CSCI 305", "csci305").
  Future<Map<String, dynamic>?> _class(String course) async {
    for (final k in ((await _data('classes'))['classes'] as List).cast<Map<String, dynamic>>()) {
      if (_norm(k['code'] as String) == _norm(course)) return k;
    }
    return null;
  }

  Future<ToolResult> _noClass(String what, String course) async {
    final codes = [for (final k in (await _data('classes'))['classes'] as List) k['code']];
    return ToolResult('$what for $course', _text({'result': 'The student is not in a class "$course" this term.', 'classes_this_term': codes}));
  }

  // The score on one open assignment that gives the target letter grade.
  // The grade is the same calculation as the desktop demo: the mean of the category percents, by weight, for the categories with graded work.
  Future<ToolResult> _gradeNeeded(String course, String assignment, String target) async {
    final k = await _class(course);
    if (k == null) return _noClass('score needed', course);
    target = target.isEmpty ? 'A' : target.toUpperCase();
    final label = 'score needed in ${k['code']} for ${target.startsWith('A') ? 'an' : 'a'} $target';
    final grades = k['grades'] as Map<String, dynamic>;
    final scale = grades['scale'] as Map<String, dynamic>;
    final minimum = double.tryParse('${scale[target] ?? ''}'.replaceAll(RegExp(r'[^0-9.]'), ''));
    if (minimum == null) return ToolResult(label, _text({'result': 'There is no letter grade "$target".', 'scale': scale}));

    final all = ((k['assignments'] as Map<String, dynamic>)['assignments'] as List).cast<Map<String, dynamic>>();
    final matches = [
      for (final a in all)
        if ('${a['name']}'.toLowerCase().contains(assignment.toLowerCase())) a,
    ];
    final open = [
      for (final a in matches)
        if (a['score'] == null) a,
    ];
    if (assignment.isEmpty || open.length != 1) {
      return ToolResult(
        label,
        _text({
          'result': matches.isNotEmpty && open.isEmpty ? 'This assignment has a score already.' : 'Give the name of one assignment that is not graded yet.',
          'assignments_not_graded': [
            for (final a in all)
              if (a['score'] == null) {'name': a['name'], 'category': a['category'], 'due': a['due'], 'points': a['points']},
          ],
        }),
      );
    }
    final a = open.single;
    final points = (a['points'] as num).toDouble();
    // overall(x) = (fixed + weight * (earned + x) / (possible + points)) / weights, for the score x on the assignment.
    var fixed = 0.0;
    var weights = 0.0;
    var weight = 0.0;
    var earned = 0.0;
    var possible = 0.0;
    for (final cat in (grades['categories'] as List).cast<Map<String, dynamic>>()) {
      final w = (cat['weight'] as num).toDouble();
      final e = (cat['earned'] as num).toDouble();
      final p = (cat['possible'] as num).toDouble();
      if (cat['category'] == a['category']) {
        weight = w;
        earned = e;
        possible = p;
        weights += w;
      } else if (p > 0) {
        fixed += w * 100 * e / p;
        weights += w;
      }
    }
    final needed = ((minimum * weights - fixed) / (weight * 100)) * (possible + points) - earned;
    double overall(double x) => (fixed + weight * 100 * (earned + x) / (possible + points)) / weights;
    double round1(double v) => (v * 10).round() / 10;
    return ToolResult(
      label,
      _text({
        'course': k['code'],
        'assignment': a['name'],
        'category': a['category'],
        'points': points,
        'due': a['due'],
        'grade_now': {'percent': grades['percent'], 'letter': grades['letter']},
        'target': {'letter': target, 'minimum_percent': minimum},
        'score_needed': needed <= 0 ? 0 : round1(needed),
        'score_needed_percent': needed <= 0 ? 0 : round1(100 * needed / points),
        'possible': needed <= points,
        'grade_with_a_full_score': round1(overall(points)),
        'grade_with_a_zero': round1(overall(0)),
        'note': needed > points
            ? 'A full score on this assignment is not enough for the target. The grade after it is at most ${round1(overall(points))}%.'
            : needed <= 0
            ? 'Each score on this assignment keeps the grade at the target or above.'
            : 'The grade counts only the graded work and this assignment. Later work changes it.',
      }),
    );
  }
}
