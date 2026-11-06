// "Get a project from GitHub": what the student types -> the clone address.
import assert from "node:assert/strict";
import { test } from "node:test";
import { repoUrl } from "../src/catatui/github.ts";

test("repoUrl accepts the usual GitHub forms", () => {
  for (const t of ["msu/catatui", "github.com/msu/catatui", "https://github.com/msu/catatui", "https://github.com/msu/catatui.git",
    "https://github.com/msu/catatui/tree/master/desktop", "git@github.com:msu/catatui.git", " https://www.github.com/msu/catatui/ "]) {
    assert.deepEqual(repoUrl(t), { url: "https://github.com/msu/catatui.git", name: "catatui" }, t);
  }
  assert.deepEqual(repoUrl("https://gitlab.com/a/b.git"), { url: "https://gitlab.com/a/b.git", name: "b" });
  assert.ok("error" in repoUrl("hello"));
  assert.ok("error" in repoUrl("http://example.com/x"));
});

test("cloneProgress gives a percent for the whole clone", async () => {
  const { cloneProgress } = await import("../src/catatui/github.ts");
  assert.equal(cloneProgress("Cloning into 'x'..."), undefined);
  assert.deepEqual(cloneProgress("remote: Counting objects: 100% (10/10), done.\rReceiving objects:  50% (5/10)\r"), { percent: 45, label: "Downloading" });
  assert.deepEqual(cloneProgress("Resolving deltas: 100% (3/3), done."), { percent: 95, label: "Unpacking" });
  assert.deepEqual(cloneProgress("Updating files: 100% (4/4), done."), { percent: 100, label: "Writing files" });
});
