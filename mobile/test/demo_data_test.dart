// The new mock data for the demo (mobile/assets/demo): the files parse, and they agree with the desktop mock data.

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> load(String name) => jsonDecode(File('assets/demo/$name.json').readAsStringSync()) as Map<String, dynamic>;

void main() {
  final catalog = load('catalog');
  final vet = load('vet-school');
  final verification = load('formal-verification');
  final activities = load('activities');

  List<Map<String, dynamic>> sections(String term) => [
    for (final t in catalog['terms'] as List)
      if (t['term'] == term) ...(t['sections'] as List).cast<Map<String, dynamic>>(),
  ];

  test('each file starts with the mock note', () {
    for (final file in [catalog, vet, verification, activities]) {
      expect(file['mock_note'], startsWith('MOCK DATA'));
    }
  });

  test('the Fall 2026 instructors agree with src/catatui/classes.ts', () {
    // A copy of the four classes in classes.ts. Change the two together.
    const desktop = {
      'CSCI 305': 'Dr. Morgan Hale (mock)',
      'CSCI 338': 'Dr. Priya Raman (mock)',
      'M 221': 'Dr. Leah Ortiz (mock)',
      'PHSX 222': 'Dr. Chen Wu (mock)',
    };
    final fall = {for (final s in sections('Fall 2026')) s['course']: s['instructor']};
    desktop.forEach((course, instructor) => expect(fall[course], instructor, reason: course));
  });

  test('the Spring 2027 computer science sections agree with src/catatui/advising.ts', () {
    // A copy of the CSCI sections in SPRING_2027 (course: seats). Change the two together.
    const desktop = {'CSCI 460': 18, 'CSCI 468': 22, 'CSCI 440': 6, 'CSCI 446': 30, 'CSCI 476': 0, 'CSCI 482R': 25};
    final spring = {
      for (final s in sections('Spring 2027'))
        if ((s['course'] as String).startsWith('CSCI')) s['course']: s['seats'],
    };
    expect(spring, desktop);
  });

  test('each section has an instructor marked as mock, and each course in the data has an outline', () {
    final outlines = (catalog['outlines'] as Map).keys.toSet();
    for (final term in ['Fall 2026', 'Spring 2027', 'Fall 2027']) {
      expect(sections(term), isNotEmpty, reason: term);
      for (final s in sections(term)) {
        expect(s['instructor'], endsWith('(mock)'), reason: '${s['course']}');
      }
    }
    final needed = <String>{
      for (final r in vet['requirements']['courses'] as List) ...(r['msu_courses'] as List).cast<String>(),
      for (final c in verification['classes'] as List) c['course'] as String,
    };
    expect(needed.difference(outlines), isEmpty);
  });

  test('the vet school is not a real school, and email addresses use example.montana.edu', () {
    expect(vet['school']['name'], contains('(mock school)'));
    final text = [catalog, vet, verification, activities].map(jsonEncode).join();
    for (final m in RegExp(r'[\w.]+@[\w.]+').allMatches(text)) {
      expect(m.group(0), endsWith('@example.montana.edu'));
    }
  });

  test('the events are on or after the mock today, in date order', () {
    final dates = [for (final e in activities['events'] as List) e['date'] as String];
    expect(dates, [...dates]..sort());
    expect(dates.first.compareTo(activities['today'] as String), greaterThanOrEqualTo(0));
  });
}
