import 'dart:convert';
import 'dart:io';

import 'package:catai/demo_tools.dart';
import 'package:flutter_test/flutter_test.dart';

// The data of a tool result, after the MOCK DATA line.
Map<String, dynamic> data(ToolResult r) {
  expect(r.text, startsWith('${DemoTools.mockNote}\n'));
  return jsonDecode(r.text.substring(DemoTools.mockNote.length)) as Map<String, dynamic>;
}

void main() {
  final tools = DemoTools((path) => File(path).readAsString());

  List<Map<String, dynamic>> sections(Map<String, dynamic> d) => [for (final t in d['terms'] as List) ...(t['sections'] as List).cast<Map<String, dynamic>>()];

  test('each tool has a name, a description, and parameters', () {
    final names = [for (final s in DemoTools.specs) s['function']['name']];
    expect(names, [
      'catalog_search',
      'vet_school_requirements',
      'formal_verification_paths',
      'my_classes',
      'class_grades',
      'grade_needed',
      'class_syllabus',
      'my_transcript',
      'degree_requirements',
      'student_profile',
      'campus_activities',
    ]);
    for (final s in DemoTools.specs) {
      expect(s['type'], 'function');
      expect(s['function']['description'], isNotEmpty);
      expect(s['function']['parameters']['type'], 'object');
    }
  });

  test('question 3: the professor of a class this fall', () async {
    final r = await tools.run('catalog_search', {'term': 'Fall 2026', 'course': 'csci305'});
    final s = sections(data(r)).single;
    expect(s['instructor'], 'Dr. Morgan Hale (mock)');
    expect(s['outline'], contains('interpreters'));
    expect(r.label, 'class catalog (Fall 2026, csci305)');
  });

  test('question 4: the computer science classes of next spring', () async {
    final r = await tools.run('catalog_search', {'term': 'spring 2027', 'subject': 'CSCI'});
    final d = data(r);
    expect((d['terms'] as List).single['term'], 'Spring 2027');
    expect([for (final s in sections(d)) s['course']], ['CSCI 460', 'CSCI 468', 'CSCI 440', 'CSCI 446', 'CSCI 476', 'CSCI 482R']);
    expect(sections(d).every((s) => s['seats'] is int && '${s['instructor']}'.endsWith('(mock)')), isTrue);
  });

  test('catalog_search: a course in the subject field, all terms, and no match', () async {
    final all = sections(data(await tools.run('catalog_search', {'subject': 'CSCI 338'})));
    expect(all.map((s) => s['course']).toSet(), {'CSCI 338'});
    expect(all.length, 2);
    expect(sections(data(await tools.run('catalog_search', {}))).length, greaterThan(20));
    final none = data(await tools.run('catalog_search', {'term': 'Summer 2030'}));
    expect(none['terms_in_the_catalog'], ['Fall 2026', 'Spring 2027', 'Fall 2027']);
  });

  test('question 5: the vet school requirements with the MSU courses', () async {
    final r = await tools.run('vet_school_requirements', {});
    final d = data(r);
    expect(d['school']['name'], contains('(mock school)'));
    final biology = (d['requirements']['courses'] as List).first;
    expect(biology['msu_courses'], ['BIOB 160', 'BIOB 170']);
    expect(d.containsKey('mock_note'), isFalse);
    expect(r.label, 'vet school requirements');
  });

  test('question 6: classes and labs for formal verification', () async {
    final d = data(await tools.run('formal_verification_paths', {}));
    expect([for (final c in d['classes'] as List) c['course']], containsAll(['CSCI 305', 'CSCI 338', 'CSCI 491']));
    expect((d['labs'] as List).length, 3);
  });

  test('question 7: campus activities, all or one category', () async {
    final all = data(await tools.run('campus_activities', {}));
    expect((all['events'] as List).length, 15);
    expect(all.keys, containsAll(['clubs', 'recreation']));
    final arts = await tools.run('campus_activities', {'category': 'arts'});
    expect((data(arts)['events'] as List).single['title'], 'Symphony orchestra concert');
    expect(data(arts).containsKey('clubs'), isFalse);
    expect(arts.label, 'campus activities (arts)');
    // An unknown category gives all events.
    expect((data(await tools.run('campus_activities', {'category': 'Opera'}))['events'] as List).length, 15);
  });

  test('an unknown tool and a missing file give text for the model, not an error', () async {
    expect((await tools.run('grades', {})).text, contains('no tool'));
    final broken = DemoTools((_) async => throw const FileSystemException('missing'));
    expect((await broken.run('campus_activities', {})).text, contains('failed'));
  });

  test('the demo prompt has the mock date and the mock student', () {
    expect(demoSystemPrompt, contains(demoToday));
    expect(demoSystemPrompt, contains('Alex Rivera (mock student)'));
    expect(demoSystemPrompt, contains('Fall 2026'));
  });

  test('question 1: the current grade in a class', () async {
    final r = await tools.run('class_grades', {'course': 'csci 305'});
    final d = data(r);
    expect([d['grades']['percent'], d['grades']['letter']], [83.7, 'B']);
    expect((d['assignments']['assignments'] as List).length, 9);
    expect(r.label, 'grades for CSCI 305');
    final none = data(await tools.run('class_grades', {'course': 'CSCI 999'}));
    expect(none['classes_this_term'], ['CSCI 305', 'CSCI 338', 'M 221', 'PHSX 222']);
  });

  test('question 2: the score needed on an assignment for a target grade', () async {
    // M 221: online homework 20/20 (weight 20), exams 163/200 (weight 40). Exam 3 has 100 points.
    // For an A- (90%): (20*100 + 40*100*(163+x)/300) / 60 >= 90, so x >= 92.
    final r = await tools.run('grade_needed', {'course': 'M 221', 'assignment': 'exam 3', 'target': 'a-'});
    final d = data(r);
    expect(d['assignment'], 'Exam 3');
    expect(d['score_needed'], 92);
    expect(d['score_needed_percent'], 92);
    expect(d['possible'], isTrue);
    expect(d['grade_now'], {'percent': 87.7, 'letter': 'B+'});
    expect(r.label, 'score needed in M 221 for an A-');

    // For an A (93%), 105.5 points are necessary: not possible. The default target is A.
    final a = data(await tools.run('grade_needed', {'course': 'M 221', 'assignment': 'Exam 3'}));
    expect([a['score_needed'], a['possible'], a['grade_with_a_full_score']], [105.5, false, 91.8]);
    expect(a['note'], contains('not enough'));

    // A target that the student has already, with each score.
    final c = data(await tools.run('grade_needed', {'course': 'CSCI 305', 'assignment': 'HW5', 'target': 'D'}));
    expect([c['score_needed'], c['possible']], [0, true]);
  });

  test('grade_needed asks for one open assignment', () async {
    final graded = data(await tools.run('grade_needed', {'course': 'CSCI 305', 'assignment': 'HW1'}));
    expect(graded['result'], contains('has a score already'));
    final many = data(await tools.run('grade_needed', {'course': 'CSCI 305', 'assignment': 'HW'}));
    expect((many['assignments_not_graded'] as List).map((a) => a['name']), contains('HW5: A small interpreter'));
    expect(data(await tools.run('grade_needed', {'course': 'M 221', 'assignment': 'Exam 3', 'target': 'Z'}))['result'], contains('no letter grade'));
  });

  test('the classes, the syllabus, the transcript, the requirements, and the profile', () async {
    final mine = data(await tools.run('my_classes', {}));
    expect([for (final k in mine['overview']['classes'] as List) k['code']], ['CSCI 305', 'CSCI 338', 'M 221', 'PHSX 222']);
    expect(mine['deadlines']['work'], isNotEmpty);
    final syllabus = data(await tools.run('class_syllabus', {'course': 'PHSX 222'}));
    expect(syllabus['syllabus']['instructor'], 'Dr. Chen Wu (mock)');
    expect(syllabus['materials'], isNotEmpty);
    final transcript = data(await tools.run('my_transcript', {}));
    expect(transcript['student']['name'], 'Alex Rivera (mock student)');
    expect((transcript['courses'] as List).length, 20);
    expect(data(await tools.run('degree_requirements', {}))['major'], 'Computer Science, BS');
    final profile = data(await tools.run('student_profile', {}));
    expect(profile['contacts'][0]['role'], 'Advisor');
    expect(profile.containsKey('mock_note'), isFalse);
  });
}
