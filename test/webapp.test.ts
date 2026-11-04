import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore: plain JavaScript module of the desktop app
import { detectWebApp, isLocalUrl } from "../desktop/webapp.js";

// A project as { path: text }.
const detect = (project: Record<string, string>) => detectWebApp((p: string) => project[p], Object.keys(project));
const pkg = (o: object) => JSON.stringify(o);

test("no web app: no result", () => {
  assert.equal(detect({}), undefined);
  assert.equal(detect({ "main.py": "print(1)", "README.md": "x" }), undefined);
  assert.equal(detect({ "package.json": pkg({ scripts: { test: "node --test" } }) }), undefined);
  assert.equal(detect({ "package.json": pkg({ scripts: { start: "node cli.js" } }) }), undefined);
  assert.equal(detect({ "package.json": "{bad" }), undefined);
  assert.equal(detect({ "node_modules/x/index.html": "", "dist/index.html": "" }), undefined);
});

test("npm apps: the tool, the command, and the port", () => {
  assert.deepEqual(detect({ "package.json": pkg({ scripts: { dev: "vite" }, devDependencies: { vite: "7" } }), "index.html": "" }),
    { server: { command: "npm run dev", port: 5173, tool: "Vite" } });
  assert.deepEqual(detect({ "package.json": pkg({ scripts: { dev: "next dev" } }) }).server, { command: "npm run dev", port: 3000, tool: "Next.js" });
  assert.deepEqual(detect({ "package.json": pkg({ scripts: { start: "node server.js" }, dependencies: { express: "5" } }) }).server,
    { command: "npm start", port: 3000, tool: "Express" });
  assert.equal(detect({ "package.json": pkg({ scripts: { dev: "vite --port 4000" } }) }).server.port, 4000);
  assert.equal(detect({ "package.json": pkg({ scripts: { start: "ng serve" } }) }).server.port, 4200);
});

test("Python apps: Django and Flask", () => {
  assert.equal(detect({ "manage.py": "os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'x')" }).server.tool, "Django");
  assert.deepEqual(detect({ "app.py": "from flask import Flask\napp = Flask(__name__)" }).server,
    { command: "flask --app app run", port: 5000, tool: "Flask" });
  assert.equal(detect({ "manage.py": "print('hello')" }), undefined);
});

test("static sites: HTML files, index.html first, no build output", () => {
  const r = detect({ "about.html": "", "docs/x.html": "", "index.html": "", "build/index.html": "", "style.css": "" });
  assert.deepEqual(r.pages, ["index.html", "about.html", "docs/x.html"]);
});

test("isLocalUrl: only localhost", () => {
  for (const u of ["http://localhost:5173/", "http://127.0.0.1:8000/x", "https://localhost", "http://[::1]:3000/"]) assert.equal(isLocalUrl(u), true, u);
  for (const u of ["https://example.com", "http://localhost.evil.com/", "file:///etc/passwd", ""]) assert.equal(isLocalUrl(u), false, u);
});
