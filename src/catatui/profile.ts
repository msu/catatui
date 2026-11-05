// The mock student profile for the demo (catai --demo-mode): the account menu and the advising tools use it.
// MOCK DATA. The people, the email addresses, the balance, and the events are not real.
// The email addresses use example.montana.edu, so a click does not send mail to a real person.
// This file does not import pi, so the desktop app can load it without loading pi.

export interface Contact { role: string; name: string; email: string; office: string; hours: string }
export interface Charge { item: string; amount: number; due: string }
export interface UniversityEvent { date: string; title: string; place: string }

export const PROFILE = {
  first_name: "Alex",
  last_name: "Rivera",
  student_id: "-12345678",
  standing: "Junior",
  academic_standing: "Good standing",
  major: "Computer Science, BS",
  college: "Norm Asbjornson College of Engineering",
  // "Manage payments" opens this page. MOCK: replace it with the real MSU student account page before a demo.
  payment_url: "https://www.montana.edu/",
  contacts: [
    { role: "Advisor", name: "Dr. Sam Lee", email: "sam.lee@example.montana.edu", office: "Barnard Hall 357", hours: "Office hours Mon and Wed 10-11:30 AM, Thu 2-3 PM" },
    { role: "Department chair", name: "Dr. Jordan Park", email: "jordan.park@example.montana.edu", office: "Barnard Hall 359", hours: "Office hours Tue 1-3 PM, or by appointment" },
    { role: "Dean", name: "Dr. Morgan Ellis", email: "morgan.ellis@example.montana.edu", office: "Roberts Hall 212", hours: "Office hours Fri 9-10 AM, by appointment" },
  ] as Contact[],
  balance: [
    { item: "Spring 2027 tuition and fees", amount: 4875.5, due: "Jan 8, 2027" },
    { item: "Parking permit (2026-2027)", amount: 245, due: "Nov 30, 2026" },
  ] as Charge[],
  events: [
    { date: "Nov 10", title: "Spring 2027 registration opens", place: "MyInfo" },
    { date: "Nov 11", title: "Veterans Day ceremony", place: "Centennial Mall" },
    { date: "Nov 18", title: "Fall career fair", place: "Strand Union Building ballrooms" },
    { date: "Nov 25-29", title: "Thanksgiving break (no classes)", place: "All campus" },
    { date: "Dec 14-18", title: "Final exams", place: "All campus" },
  ] as UniversityEvent[],
};

export const fullName = () => `${PROFILE.first_name} ${PROFILE.last_name}`;
export const advisor = () => PROFILE.contacts[0];
export const balanceTotal = () => PROFILE.balance.reduce((n, c) => n + c.amount, 0);
