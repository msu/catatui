# Feature: Simplified Technical English

The agent writes in a short form of ASD-STE100. The code is in `src/ts/ste.ts`. The 8 rules are in `skills/simplified-technical-english/SKILL.md`.

## Decisions

- STE is on by default. Short, clear answers are easier to read, also for non-native English speakers, and STE removes much of the extra text that models add.
- The rules apply to prose only, not to code or quoted output.
- The choice stays after catatui stops. It is in `~/.catatui/catatui.json`.

## Subtleties

- pi loads a skill only when the model asks for it. So while STE is on, catatui puts the skill text in the system prompt for each request.
