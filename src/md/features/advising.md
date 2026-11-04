# Advising (demo)

catai can act as an MSU academic advisor. This is a demo with mock data.

- In the desktop app, open the session menu (upper right) and click Advising, or use File > Advising (Cmd+Shift+A).
- There is one advising session. It is in `Documents/catai/Advising`. Each time, the app opens the same session.
- The app starts catatui there with `CATATUI_ADVISING=1`. Then `src/catatui/advising.ts` adds the advisor prompt and four tools:
  - `advising_transcript`: the student, the courses by term with grades, the GPA, and the credits.
  - `advising_requirements`: the major requirements (Computer Science, BS) and the status of each.
  - `advising_classes`: next term's classes, with times, seats, and the student's prerequisite status.
  - `advising_submit_plan`: send an agreed plan to the advisor (mock). In the app, the student approves it on a plan card in the chat (each term with course titles and credits, the warnings, the note, and Send to advisor or Not now), also in yolo mode. The card stays in the chat with its status. In the terminal, it is a select dialog. The tool adds warnings (a full class, a missing prerequisite, a class already done), saves a copy in `Advising/Submitted plans/`, and returns a confirmation number.
- All data is mock data: a made-up student and made-up sections. The courses look like MSU Computer Science, but they are not the official catalog. Each tool result starts with a "MOCK DATA" line.
- A real version must read the student's data from MSU systems (for example Banner and DegreeWorks), with the student's permission.
