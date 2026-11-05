# Feature: Auto Mode

`auto` is a mode between `ask` and `yolo`. The agent asks only when an action can do damage. A CatChat model (the judge) decides the commands that the fixed rules do not decide.

- Code: `src/catatui/permissions.ts` (the decision order), `src/catatui/judge.ts` (the judge request and the log).
- Plan and evaluation: `src/md/plans/auto-mode.md`.

## Decision order

For each tool call in auto mode, catatui uses the first rule that applies.

1. The rules of all modes: ta blocks changes, the sandbox blocks paths outside the project, and `git_clone`, `git_pull`, and `git_push` always ask.
2. Allow:
   - the read tools, and `http` GET;
   - the change tools in the project, but not `delete` (`/undo` can roll them back);
   - `git_init` and `git_commit`.
3. Ask:
   - `delete`, `git_restore`, and changes outside the project;
   - the always-ask list (`alwaysAsk`, the `RISKY` patterns): `rm`, `sudo`, `chmod`, `chown`, `curl | sh`, and `git commit`, `push`, `reset`, `rebase`, `clean`, `restore`, and `checkout --` in a shell command.
4. The judge: `bash`, `powershell`, `run`, `server start`, and `http` other than GET. If the judge says "allow", catatui allows the call. If not, it asks.
5. Ask also if the sandbox is off, if there is no CatChat sign-in, or if the judge gives an error or a timeout. Never allow on an error.

The ask dialog starts with the reason, for example "The safety check wants you to look at this first."

## The judge

- The model is `gemma4-31B-it` (`JUDGE_MODEL`), at temperature 0, with a one-word answer: "allow" or "ask". Any other answer means ask.
- The input has a fixed shape (`judgeState`): the command, the project folder, the operating system, the sandbox state, and the last student message (500 characters at most). There are no file contents and no tool results, because these can contain prompt injection.
- The timeout is 3 s (`JUDGE_TIMEOUT_MS`). The measured time is approximately 0.2 s (p50) and 0.3 s (p95).
- Each decision goes to `~/.catatui/auto-log.jsonl` (`logJudgment`). catatui does not send the log.

## Decisions

- Auto mode needs the sandbox. With the sandbox off, the footer shows "auto (sandbox off: asks)", and each command asks.
- Auto mode is off by default. The student turns it on with `/mode auto`, or with the model button menu in the desktop app.
- gemma4, not the decision model `nimble:9b`. In the evaluation, nimble:9b did not separate safe and risky commands: with 0 false allows, it asked for 59 of 60 safe commands. gemma4 had 0 false allows and asked for 5 of 60 (3 of them from the always-ask list). See the plan.
- Runner programs (`python`, `node`, `npx`) and chains go to the judge in auto mode. In ask mode, they always ask.

## Subtleties

- The judge reads the command text, and the model writes the command. A command can contain text that tries to change the answer (prompt injection). The always-ask list and the sandbox stay in place, so the judge cannot allow `rm` or a path outside the project.
- `scripts/auto-eval.ts` uses the same `judge` function. Run it after a change to the prompt, the model, or the always-ask list.
- The tests use a fake judge (`setJudge`) and a fake fetch. They use no network.
