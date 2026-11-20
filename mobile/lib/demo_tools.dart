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
const demoWeekday = 'Tuesday';
const demoSystemPrompt =
    'You are CatChat, an AI assistant for Montana State University students. '
    'Give clear and correct answers. Use markdown, and tables for lists of classes or events.\n\n'
    'The app is in DEMO MODE. All student and university data comes from tools with MOCK DATA. '
    'Say one time in the conversation, in your answer after the lookups, that the data is mock data for a demo. '
    'Do not write text before you call a tool.\n'
    'The student is Alex Rivera (mock student), a junior in Computer Science, BS.\n'
    'Today is $demoWeekday, $demoToday. Each date in the tool results has its weekday in a field that ends in "_weekday": use it, and do not calculate weekdays. "This fall" is Fall 2026 (the current term). "Next spring" is Spring 2027.\n\n'
    'For a question about classes, sections, professors, course outlines, a vet school, formal verification, '
    'research labs, clubs, or campus activities, call a tool first. Use only the data from the tools for such facts. '
    'If the tools do not have the data, say so. Do not invent professors, times, requirements, or events.\n'
    'Use the names of people. For a person whose pronouns you do not know, use they.\n'
    'Copy course codes, names, and numbers exactly from the tool results (for example "PHSX 220", not "PHYSX 220").\n\n'
    'Advising: for a plan of classes, read my_transcript, degree_requirements, and next_term_classes first. Check the prerequisites '
    '(major and math courses need a C- or better), and plan about 15 credits for a term. Show the plan as a table. '
    'When the student agrees on a plan, offer to send it to the advisor with submit_plan. The student approves it on a card in the app. '
    'For official decisions, send the student to the advisor.';

// The starter prompts of demo mode: the seven demo questions, with real names from the mock data.
// A tap puts the question in the message box. See src/md/features/mobile-demo.md.
const demoQuestions = <String, String>{
  'My grade in CSCI 305': 'What is my current grade in CSCI 305?',
  'Score I need on HW5': 'What do I need on HW5: A small interpreter to keep my B in CSCI 305?',
  'Who teaches CSCI 338?': 'Who is the professor for CSCI 338 this fall?',
  'Spring CS classes': 'What classes in computer science are offered next spring?',
  'Vet school': 'I want to get into vet school. What does Cascade Ridge College of Veterinary Medicine require, and what classes here can help me become a qualified applicant?',
  'Formal verification': 'What classes and labs can I join that will help my career in formal verification?',
  'Campus activities': 'What activities are happening at Montana State this week?',
};

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
    _tool(
      'next_term_classes',
      "The classes of next term, Spring 2027 (mock), for the student's plan: days, time, seats, if the class is full, and the student's status for each prerequisite.",
    ),
    _tool(
      'submit_plan',
      "Send a semester plan to the student's advisor for review (mock). Use it only after the student agrees on the plan. The app shows the plan on a card, and the student approves or declines it there.",
      {
        'terms': {
          'type': 'array',
          'description': 'The plan, one entry for each term.',
          'items': {
            'type': 'object',
            'properties': {
              'term': {'type': 'string', 'description': 'For example "Spring 2027".'},
              'courses': {
                'type': 'array',
                'items': {'type': 'string'},
                'description': 'Course numbers, for example "CSCI 460".',
              },
            },
          },
        },
        'message': {'type': 'string', 'description': "A short note to the advisor, in the student's words."},
      },
    ),
    _tool('campus_activities', 'Activities at Montana State (mock): events with date, time, place, and cost; student clubs; and recreation.', {
      'category': {'type': 'string', 'description': 'One of: Social, Career, Athletics, Outdoors, Academic, Campus, Clubs, Arts, Recreation. Empty: all.'},
    }),
  ];

  // One mock data file, for example "classes". The Classes screen reads it too.
  Future<Map<String, dynamic>> file(String name) async => _cache[name] ??= jsonDecode(await load('assets/demo/$name.json')) as Map<String, dynamic>;

  static String _text(Object? data) => '$mockNote\n${const JsonEncoder.withIndent(' ').convert(withWeekdays(data))}';

  static const _weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  static final _isoDate = RegExp(r'^\d{4}-\d{2}-\d{2}$');

  // A copy of the data with "<key>_weekday" after each date ("2026-11-04" gives "Wednesday").
  // The model does not calculate weekdays well: in a test it gave the wrong weekday for each event.
  static Object? withWeekdays(Object? data) {
    if (data is List) return [for (final item in data) withWeekdays(item)];
    if (data is! Map) return data;
    final out = <String, dynamic>{};
    for (final MapEntry(:key, :value) in data.entries) {
      out['$key'] = withWeekdays(value);
      final date = value is String && _isoDate.hasMatch(value) ? DateTime.tryParse(value) : null;
      if (date != null) out['${key}_weekday'] = _weekdays[date.weekday - 1];
    }
    return out;
  }

  static String _arg(Map<String, dynamic> args, String name) => '${args[name] ?? ''}'.trim();
  static String _norm(String s) => s.toUpperCase().replaceAll(RegExp(r'\s+'), '');

  // Run one tool. An unknown tool or bad data gives a result with the problem as text, so the model can tell the student.
  Future<ToolResult> run(String name, Map<String, dynamic> args) async {
    try {
      switch (name) {
        case 'catalog_search':
          return await _catalog(_arg(args, 'term'), _arg(args, 'subject'), _arg(args, 'course'));
        case 'vet_school_requirements':
          final data = Map<String, dynamic>.of(await file('vet-school'))..remove('mock_note');
          return ToolResult('vet school requirements', _text(data));
        case 'formal_verification_paths':
          final data = Map<String, dynamic>.of(await file('formal-verification'))..remove('mock_note');
          return ToolResult('formal verification classes and labs', _text(data));
        case 'campus_activities':
          return await _activities(_arg(args, 'category'));
        case 'my_classes':
          final data = await file('classes');
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
          return ToolResult('my transcript', _text((await file('advising'))['transcript']));
        case 'degree_requirements':
          return ToolResult('degree requirements', _text((await file('advising'))['requirements']));
        case 'next_term_classes':
          return ToolResult('next term\'s classes', _text((await file('advising'))['next_term']));
        case 'student_profile':
          final data = Map<String, dynamic>.of(await file('profile'))..remove('mock_note');
          return ToolResult('student profile', _text(data));
      }
      return ToolResult(name, 'There is no tool with the name "$name".');
    } catch (e) {
      return ToolResult(name, 'The tool "$name" failed: $e');
    }
  }

  Future<ToolResult> _catalog(String term, String subject, String course) async {
    final catalog = await file('catalog');
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
    final data = await file('activities');
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
    for (final k in ((await file('classes'))['classes'] as List).cast<Map<String, dynamic>>()) {
      if (_norm(k['code'] as String) == _norm(course)) return k;
    }
    return null;
  }

  Future<ToolResult> _noClass(String what, String course) async {
    final codes = [for (final k in (await file('classes'))['classes'] as List) k['code']];
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

  // ---- Advising: the plan card ----

  static const planTool = 'submit_plan';

  // The plan for the card in the chat, from the arguments of submit_plan: titles, credits, and the warnings that the advisor will see.
  // The same rules as advising_submit_plan on the desktop.
  Future<Map<String, dynamic>> buildPlan(Map<String, dynamic> args) async {
    final advising = await file('advising');
    final student = advising['transcript']['student'] as Map<String, dynamic>;
    final next = advising['next_term'] as Map<String, dynamic>;
    final sections = {for (final s in (next['classes'] as List).cast<Map<String, dynamic>>()) _norm(s['course'] as String): s};
    final titles = {for (final e in (advising['course_titles'] as Map<String, dynamic>).entries) _norm(e.key): e.value as String};
    // The last grade of each course on the transcript. "IP" is in progress. C- or better is a pass.
    const pass = {'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-'};
    final grades = {
      for (final t in (advising['transcript']['courses'] as List).cast<Map<String, dynamic>>()) _norm(t['course'] as String): t['grade'] as String,
    };

    final warnings = <String>[];
    final terms = <Map<String, dynamic>>[];
    final asked = args['terms'] is List ? args['terms'] as List : const [];
    for (final t in asked.whereType<Map<String, dynamic>>()) {
      final term = '${t['term'] ?? ''}'.trim();
      final courses = <Map<String, dynamic>>[];
      for (final raw in (t['courses'] is List ? t['courses'] as List : const [])) {
        final course = '$raw'.trim();
        final key = _norm(course);
        final section = sections[key];
        if (pass.contains(grades[key])) {
          warnings.add('$course is already complete.');
        } else if (grades[key] == 'IP') {
          warnings.add('$course is in progress now.');
        }
        if (section != null && _norm(term) == _norm(next['term'] as String) && section['full'] == true) warnings.add('$course is full in $term.');
        for (final p in (section?['prereq_status'] as List? ?? const []).cast<Map<String, dynamic>>()) {
          if (p['status'] != 'done' && p['status'] != 'in progress now') warnings.add('$course needs ${p['course']}.');
        }
        courses.add({'course': course, 'title': section?['title'] ?? titles[key] ?? '', 'credits': section?['credits'] ?? 3});
      }
      if (courses.isNotEmpty) terms.add({'term': term, 'credits': courses.fold<num>(0, (a, c) => a + (c['credits'] as num)), 'courses': courses});
    }
    final message = '${args['message'] ?? ''}'.trim();
    return {
      'advisor': student['advisor'],
      'student': student['name'],
      'terms': terms,
      if (message.isNotEmpty) 'message': message,
      'warnings': warnings,
      'status': terms.isEmpty ? 'declined' : 'pending',
    };
  }

  // The tool result for the model, after the student's tap on the plan card.
  ToolResult planResult(Map<String, dynamic> plan, {required bool sent, DateTime? now}) {
    if ((plan['terms'] as List).isEmpty) {
      return ToolResult('plan for the advisor', _text({'submitted': false, 'result': 'The plan has no courses. Give terms with course numbers.'}));
    }
    if (!sent) {
      plan['status'] = 'declined';
      // Only a tap on "Not now" comes here. After Stop or a new chat, the model gets no result.
      return ToolResult(
        'plan for the advisor (not sent)',
        _text({
          'submitted': false,
          'student_choice': 'Not now',
          'result':
              'The student tapped "Not now" on the plan card: the student chose not to send the plan yet. '
              'This is not an error, and nothing failed. Ask if the student wants to change the plan, or to send it later.',
        }),
      );
    }
    final number = 'PLAN-${(now ?? DateTime.now()).millisecondsSinceEpoch.toRadixString(36).toUpperCase()}';
    plan['status'] = 'sent';
    plan['confirmation'] = number;
    return ToolResult(
      'plan for the advisor (sent)',
      _text({
        'submitted': true,
        'confirmation': number,
        'to': plan['advisor'],
        'reply_expected': 'within 2 business days (mock)',
        'warnings': plan['warnings'],
        'next_step': 'Registration opens November 10, 2026 (mock date). The advisor must release the registration hold after the review (mock).',
      }),
    );
  }
}
