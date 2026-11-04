// Find a web application in a project, for the web preview. The Preview button shows only for a project with one.
// No Electron here, so a test can run it in Node.
//
// Result: undefined (no web app), or
//   { server: { command, port, tool } } for an app that runs a local server (npm, Django, Flask), or
//   { pages: [html files] } for a static site (HTML files that open directly from the project).

// Server tools in package.json, the port that each uses by default, and how to find it.
const NODE_TOOLS = [
  { tool: "Next.js", dep: "next", script: /\bnext\b/, port: 3000 },
  { tool: "Nuxt", dep: "nuxt", script: /\bnuxt\b/, port: 3000 },
  { tool: "Astro", dep: "astro", script: /\bastro\b/, port: 4321 },
  { tool: "Angular", dep: "@angular/cli", script: /\bng\s+serve\b/, port: 4200 },
  { tool: "Create React App", dep: "react-scripts", script: /\breact-scripts\b/, port: 3000 },
  { tool: "Vite", dep: "vite", script: /\bvite\b/, port: 5173 },
  { tool: "Parcel", dep: "parcel", script: /\bparcel\b/, port: 1234 },
  { tool: "webpack", dep: "webpack-dev-server", script: /\bwebpack(-dev-server|\s+serve)\b/, port: 8080 },
  { tool: "http-server", dep: "http-server", script: /\bhttp-server\b/, port: 8080 },
  { tool: "live-server", dep: "live-server", script: /\blive-server\b/, port: 8080 },
  { tool: "serve", dep: "serve", script: /\bserve\b/, port: 3000 },
  { tool: "Express", dep: "express", script: undefined, port: 3000 },
];

const SKIP = /(^|\/)(node_modules|\.git|dist|build|out|\.next|coverage|venv|\.venv)\//;

// A port in a script: "--port 4000", "--port=4000", "-p 4000".
const portIn = (script) => Number(/(?:--port[=\s]|-p\s)\s*(\d{2,5})\b/.exec(script ?? "")?.[1]) || undefined;

function nodeServer(pkg) {
  const scripts = pkg.scripts ?? {};
  const name = scripts.dev ? "dev" : scripts.start ? "start" : undefined;
  if (!name) return undefined;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const script = scripts[name];
  const t = NODE_TOOLS.find((x) => x.script?.test(script)) ?? NODE_TOOLS.find((x) => deps[x.dep]);
  if (!t) return undefined;
  return { command: name === "start" ? "npm start" : "npm run dev", port: portIn(script) ?? t.port, tool: t.tool };
}

// readText(relPath): the text of a project file, or undefined. files: the project files (relative paths, "/").
export function detectWebApp(readText, files) {
  const list = (files ?? []).filter((f) => !SKIP.test(f));
  const top = list.filter((f) => !f.includes("/"));

  if (top.includes("package.json")) {
    try {
      const server = nodeServer(JSON.parse(readText("package.json") ?? "{}"));
      if (server) return { server };
    } catch { /* A bad package.json: not a web app. */ }
  }
  if (top.includes("manage.py") && /django/i.test(readText("manage.py") ?? "")) {
    return { server: { command: "python3 manage.py runserver", port: 8000, tool: "Django" } };
  }
  const flask = top.find((f) => f.endsWith(".py") && /^\s*(from\s+flask\s+import|import\s+flask)\b/m.test(readText(f) ?? ""));
  if (flask) return { server: { command: `flask --app ${flask.slice(0, -3)} run`, port: 5000, tool: "Flask" } };

  // A static site: HTML files. index.html first, then the files nearest the top.
  const pages = list.filter((f) => /\.html?$/i.test(f))
    .sort((a, b) => (b.endsWith("index.html") - a.endsWith("index.html")) || a.split("/").length - b.split("/").length || a.localeCompare(b));
  return pages.length ? { pages: pages.slice(0, 6) } : undefined;
}

// The preview shows only this project: a local server, or a file in the project (the caller checks the file).
export const isLocalUrl = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(String(url ?? ""));
