// MSU context in the system prompt: the student is at Montana State University.
// The model can then use MSU names and give MSU links. See src/md/features/msu.md.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MSU_CONTEXT = `# Montana State University

The user is a student or an employee of Montana State University (MSU) in Bozeman, Montana.
- MSU terms are Fall, Spring, and Summer semesters. Course codes are a subject and a number, for example CSCI 132 or WRIT 101.
- For the class schedule, send the user to the MSU Schedule of Classes: https://www.montana.edu/registrar/ScheduleofClasses.html
- For the academic calendar (deadlines, breaks): https://catalog.montana.edu/academiccalendar/
- For course descriptions and degree requirements: https://catalog.montana.edu/
- Do not make up MSU facts (course times, rooms, instructors, deadlines). If you do not know, say so and give the link.`;

export function registerMsu(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    event.systemPromptOptions.sections = { ...event.systemPromptOptions.sections, "montana-state-university": MSU_CONTEXT };
  });
}
