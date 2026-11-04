# Classes (demo)

catai shows the student's classes this term, with mock data. It uses the same mock student as advising.

- In the desktop app, open the session menu and click Classes, or use File > Classes (Cmd+Shift+C).
- Classes (one session, `Documents/catai/Classes`): all classes, the work due soon, the term dates, and the grades.
  - The left panel lists the classes (code, title, grade so far, next work due). A click opens the class chat.
  - The start screen shows the work due in the next two weeks and the next term date (for example the last day to withdraw).
  - Tasks: This week, My grades, Important dates, Late work.
- A class chat (one session per class, `Documents/catai/Classes/<code>`): a study helper for one class.
  - The left panel shows the class, the grade so far, the tasks, and "All classes".
  - The helper follows the class policies, also on AI use. It explains and gives hints. It does not write graded work.
  - A class chat can link to a project folder ("Link a project..."): a window with a search over the existing projects (a project with the course code in its name or path comes first) and "Browse..." for any folder. The link is `project.json` in the class folder. The panel can open the project in this window or in a new window. The system prompt names the linked project.
- The app starts catatui with `CATATUI_CLASSES=1` (the overview) or `CATATUI_CLASS=<code>` (a class chat). Then `src/catatui/classes.ts` adds the prompt and the tools:
  - `classes_overview` and `classes_deadlines` (overview only): all classes, and the work due soon with the term dates.
  - `class_assignments`, `class_grades`, `class_syllabus`, `class_materials`: one class. In a class chat, the course is that class.
- All data is mock data: four classes (CSCI 305, CSCI 338, M 221, PHSX 222), made-up instructors, scores, dates, and short lecture notes. "Today" is 2026-11-03. Each tool result starts with a "MOCK DATA" line.
- A real version must read the data from the learning system (for example Brightspace D2L), with the student's permission.
