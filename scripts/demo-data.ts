// Writes the desktop demo mock data to JSON for the phone app (mobile/assets/demo/).
// Run: node scripts/demo-data.ts
// The source of the data is the TypeScript files of the desktop demo (catai --demo-mode):
// src/catatui/profile.ts, advising.ts, and classes.ts. Do not edit the JSON files by hand:
// change the TypeScript files, and then run this script again. test/demo-data.test.ts makes sure
// that the JSON files agree with the TypeScript data and with the results of the desktop tools.
// Each section of the JSON has the same form as the result of a desktop tool (without the "MOCK DATA" line),
// so that the phone app can give the model the same data as the desktop app.
// See src/md/features/mobile-demo.md.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  earnedCredits, gpa, inProgress, MOCK_NOTE as ADVISING_NOTE, passed, requirementStatus, SPRING_2027, STUDENT, TITLES,
  TOTAL_CREDITS, TRANSCRIPT, UPPER_DIVISION_CREDITS,
} from "../src/catatui/advising.ts";
import { CLASSES, daysFrom, grade, LETTERS, MOCK_NOTE as CLASSES_NOTE, summaries, TERM, upcoming } from "../src/catatui/classes.ts";
import { balanceTotal, fullName, PROFILE } from "../src/catatui/profile.ts";

export const DEMO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "mobile", "assets", "demo");

// The note comes from the comment at the top of profile.ts. profile.ts has no note in its data.
const PROFILE_NOTE = "MOCK DATA for a demo. The people, the email addresses, the balance, and the events are not real.";

// The mock student for the account menu (profile.ts).
function profile() {
  return { mock_note: PROFILE_NOTE, ...PROFILE, full_name: fullName(), balance_total: balanceTotal() };
}

// Advising (advising.ts). Each key has the result of one desktop tool:
// transcript = advising_transcript, requirements = advising_requirements,
// next_term = advising_classes with no filter. course_titles is for the plan card (advising_submit_plan).
function advising() {
  const student = { ...STUDENT, standing: PROFILE.standing, academic_standing: PROFILE.academic_standing, contacts: PROFILE.contacts };
  return {
    mock_note: ADVISING_NOTE,
    transcript: { student, ...gpa(), ...earnedCredits(), courses: TRANSCRIPT },
    requirements: {
      major: STUDENT.major, catalog: STUDENT.catalog, grade_rule: "Major and math courses need C- or better.",
      total_credits_required: TOTAL_CREDITS, upper_division_credits_required: UPPER_DIVISION_CREDITS, ...earnedCredits(),
      requirements: requirementStatus().map(({ any, ...r }) => ({ ...r, options: any.length > 1 ? any : undefined })),
    },
    next_term: {
      term: STUDENT.next_term, registration_opens: STUDENT.registration_opens,
      classes: SPRING_2027.map((s) => ({
        ...s,
        full: s.seats === 0,
        already_done: passed(s.course),
        prereq_status: s.prereq.map((p) => ({ course: p, status: passed(p) ? "done" : inProgress(p) ? "in progress now" : "missing" })),
      })),
    },
    course_titles: TITLES,
  };
}

// Classes (classes.ts). overview = classes_overview, deadlines = classes_deadlines (14 days).
// For each class: syllabus = class_syllabus, assignments = class_assignments, grades = class_grades,
// materials = all the lecture notes (class_materials with no filter).
function classes() {
  const scale = Object.fromEntries(LETTERS.map(([m, l]) => [l, `${m}%+`]));
  return {
    mock_note: CLASSES_NOTE,
    overview: { term: TERM.name, today: TERM.today, classes: summaries() },
    deadlines: upcoming(14),
    term_dates: TERM.dates,
    classes: CLASSES.map((c) => {
      const { assignments, materials, ...syllabus } = c;
      return {
        code: c.code,
        syllabus,
        assignments: { course: c.code, today: TERM.today, assignments: assignments.map((a) => ({ ...a, in_days: daysFrom(a.due) })) },
        grades: { course: c.code, ...grade(c), scale },
        materials,
      };
    }),
  };
}

// The JSON text of each file, by file name. JSON.stringify drops the keys with the value undefined, as in the desktop tools.
export function demoFiles(): Record<string, string> {
  const text = (data: unknown) => `${JSON.stringify(data, null, 2)}\n`;
  return { "profile.json": text(profile()), "advising.json": text(advising()), "classes.json": text(classes()) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(DEMO_DIR, { recursive: true });
  for (const [name, body] of Object.entries(demoFiles())) {
    writeFileSync(join(DEMO_DIR, name), body);
    console.log(`Wrote mobile/assets/demo/${name}`);
  }
}
