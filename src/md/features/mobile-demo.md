# Mobile Demo (plan)

A demo of the phone app with mock data, and a demo video. This file is the plan. The cards are card-11 to card-20. Built: the new mock data (card-13) and demo mode (card-14).

## Goal

- The phone app (`mobile/`, see [mobile.md](mobile.md)) shows what the desktop demo shows, and more where it fits the work of students and staff.
- iPhone first. Android after the iPhone demo works.
- Then a video that shows the features on the iPhone.

## What the desktop demo has

The desktop demo is `catai --demo-mode` (see [desktop.md](desktop.md), "Demo mode"). There is no demo video in this repository.

- Advising ([advising.md](advising.md), `src/catatui/advising.ts`): the transcript with grades and GPA, the Computer Science BS requirements with their status, the Spring 2027 sections (time, seats, prerequisite status), and a plan card with "Send to advisor".
- Classes ([classes.md](classes.md), `src/catatui/classes.ts`): four classes (CSCI 305, CSCI 338, M 221, PHSX 222) with instructor, room, weights, policies, assignments, scores, due dates, syllabus, and short lecture notes. An overview (work due soon, term dates, grades) and one study helper chat for each class.
- Profile (`src/catatui/profile.ts`): the mock student Alex Rivera (junior, Computer Science), the contacts (advisor, chair, dean), the account balance, and five university events.
- "Today" in the mock data is 2026-11-03.
- Each tool result starts with a "MOCK DATA" line, and the screens show a "Demo" badge.

## The demo questions

The app must give a correct, realistic answer to each of these from the mock data.

| # | Question | Data | In the desktop demo? |
|---|---|---|---|
| 1 | What is my current grade in class A? | class grades | Yes |
| 2 | What do I need to get on assignment B to maintain an A? | class grades and weights | Yes |
| 3 | Who is the professor for class C that starts this fall? | catalog with instructors by term | In part: only the four classes |
| 4 | What classes in computer science are offered next spring? | Spring 2027 sections | Yes |
| 5 | I want to get into vet school. What does vet school A (not an MSU school) require, and what classes here help me to be a qualified applicant? | vet school requirements, MSU course outlines | No |
| 6 | Classes and labs that I can join that will help my career in formal verification? | catalog, research labs | No |
| 7 | Activities at Montana State. | campus activities | In part: five events in the profile |

## Parts

1. Shared mock data (card-12): a script writes the desktop mock data to JSON in `mobile/assets/demo/`. The TypeScript files stay the source, so the two demos agree.
2. New mock data (card-13), in the same JSON form:
   - A catalog: courses with a short outline, the terms, and the instructor of each section (Fall 2026, Spring 2027, Fall 2027).
   - One vet school that is not an MSU school, with its admission requirements (courses, hours with animals, tests), and the MSU courses that agree with each requirement. The school and its numbers are mock data, and the answer says so.
   - Classes and research labs for formal verification (for example logic, programming languages, compilers, a verification lab with a contact).
   - Campus activities: clubs, events with dates and places, recreation.
3. Demo mode (card-14): off by default. In demo mode the app shows a "Demo" badge, a "mock data" note, and the mock student in the drawer. A build without demo mode has no demo data on the screen.
4. Mock tools in the chat (card-15): the fake end points. See "Decision" below.
5. Classes screen and class chat (card-16), and the Advising chat with the plan card (card-17), as on the desktop.
6. The seven questions as starter prompts in demo mode, and a check of each answer (card-18).
7. The video (card-19).
8. The Android check (card-20).

## Decision: how the fake end points answer

Decided 2026-11-18 by the human: mock tools with the real model.

- The app gives CatChat the mock data as tools (OpenAI `tools` in `POST /v1/chat/completions`), runs each tool call on the phone, and sends the result back. The model writes the answer. This is how the desktop demo works, and each wording of a question works.
- The phone must be on a network that reaches CatChat, also for the video.
- Not built: a fully fake end point with fixed answers and no model. It gives the same result each time and needs no network, but only the questions in a script work, and it does not show the real product.
- Not confirmed: that the CatChat models call tools correctly through the phone app's plain API calls. The tool-call test of 2026-10-28 (see [models.md](models.md)) used pi. card-15 tests this first.

## Rules for the mock data

- People, scores, sections, and labs are made up. Email addresses use `example.montana.edu`.
- Do not show mock data as real MSU data. Each tool result starts with a "MOCK DATA" line, and the model says one time that the data is mock data.
- The vet school is a made-up school, or a real school with a clear note that the requirements in the demo are not the real ones. The human decides.
- A real version must read the data from MSU systems (for example Banner, DegreeWorks, Brightspace D2L) with the student's permission.

## The video (outline)

1. Sign in with the MSU account.
2. A plain question, with a table and code in the answer. Copy.
3. The model menu.
4. Demo mode: the seven questions, one short clip for each.
5. Classes: grades and work due soon. A class chat.
6. Advising: a plan for next term, and "Send to advisor".
7. Saved chats and Sign Out.

The recording needs the human: the phone, the MSU sign-in, and the voice. Before the script is final, decide the length, who it is for (students, staff, or the two), and if the video shows the "Demo" badge.
