import { structuredPatch } from "diff";
import { marked } from "marked";
import { useEffect, useReducer, useRef, useState } from "react";
import logo from "./bobcat.png";
import { FileIcon, FolderIcon } from "./icons.jsx";
import { closeDialog, initialState, itemsFromMessages, notice, plain, reduce, resultText, toolSummary } from "./chat.js";

const api = window.catatui;
// The project folder, for short paths in tool cards. It does not change while the app runs.
let PROJECT = "";

// Model output can contain HTML. Show it as text, so a page in an answer cannot run or load anything.
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
marked.use({ renderer: { html: ({ text }) => escape(text) } });

function reducer(state, action) {
  if (action.type === "local") return action.fn(state);
  return reduce(state, action.rec);
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  // "loading", "signin", or "chat"
  const [phase, setPhase] = useState("loading");
  const [info, setInfo] = useState({ project: "" });
  const [model, setModel] = useState(undefined);
  const [log, setLog] = useState("");
  const local = (fn) => dispatch({ type: "local", fn });

  useEffect(() => {
    const offs = [
      api.onEvent((rec) => dispatch({ type: "event", rec })),
      api.onStderr((t) => setLog((l) => (l + t).slice(-20_000))),
      api.onExit(({ code }) => local((s) => notice({ ...s, busy: false }, "error", `catatui stopped (exit code ${code}). Close the app and open it again.`))),
    ];
    boot();
    return () => offs.forEach((off) => off());
  }, []);

  // Read the sign-in state. If there is a sign-in, start catatui. Otherwise show the sign-in screen.
  async function boot() {
    const i = await api.info();
    PROJECT = i.project;
    setInfo(i);
    if (!i.signedIn || (i.expiryDays !== undefined && i.expiryDays <= 0)) return setPhase("signin");
    if (!i.project) return setPhase("projects");
    setPhase("loading");
    // Clear the chat before the start, so the status that catatui sends at start (the mode) stays.
    local(() => initialState);
    const r = await api.start();
    setModel(r.success ? r.data?.model : undefined);
    setPhase("chat");
  }

  async function openProject(path) {
    const r = await api.openProject(path);
    if (!r.ok) return r.error;
    await boot();
  }

  // Open an old chat of this project: load it in catatui, then show its messages.
  // A chat from History. If it is in a different folder, open that project first.
  async function openAnySession(s) {
    if (!s.here) {
      const err = await openProject(s.cwd);
      if (err) return local((st) => notice(st, "error", err));
    }
    await openSession(s.path);
  }

  async function openSession(path) {
    const r = await api.command({ type: "switch_session", sessionPath: path });
    if (!r.success || r.data?.cancelled) return local((s) => notice(s, "error", r.error ?? "catatui did not open the chat."));
    const m = await api.command({ type: "get_messages" });
    local((s) => ({ ...s, items: itemsFromMessages(m.data?.messages), busy: false, dialogs: [] }));
    refreshModel();
  }

  async function newChat() {
    const r = await api.command({ type: "new_session" });
    if (r.success && !r.data?.cancelled) local((s) => ({ ...s, items: [], busy: false, dialogs: [] }));
  }

  async function refreshModel() {
    const r = await api.command({ type: "get_state" });
    if (r.success) setModel(r.data?.model);
  }

  // new_project (project.ts) asks the app to move to a new project folder. When the agent is done, open the
  // folder (this starts catatui there) and send the goal to the new chat, so the work goes on there.
  const switchTo = state.status["catatui-switch"];
  const switching = useRef(false);
  useEffect(() => {
    if (!switchTo || state.busy || switching.current) return;
    switching.current = true;
    (async () => {
      try {
        const { path, goal } = JSON.parse(switchTo);
        const from = info.project;
        const err = await openProject(path);
        if (err) return local((s) => notice(s, "error", err));
        await send(`I moved here from ${from} to start a new project. The goal: ${goal}\nRead README.md, then help me start.`);
      } finally {
        switching.current = false;
      }
    })();
  }, [switchTo, state.busy]);

  // The chat goes to the bottom when the student sends a message or adds a file.
  const [scrollTick, setScrollTick] = useState(0);

  async function send(text) {
    setScrollTick((t) => t + 1);
    // An extension command (/undo, /mode plan) runs at once, also while the agent works.
    // Other text waits until the agent is done.
    const cmd = { type: "prompt", message: text };
    if (state.busy && !text.startsWith("/")) cmd.streamingBehavior = "followUp";
    const r = await api.command(cmd);
    if (!r.success) local((s) => notice(s, "error", r.error ?? "catatui did not accept the message."));
    if (text.startsWith("/model")) refreshModel();
  }

  async function pickModel(m) {
    const r = await api.command({ type: "set_model", provider: m.provider, modelId: m.id });
    if (r.success) setModel(r.data);
    else local((s) => notice(s, "error", r.error ?? "catatui did not change the model."));
  }

  async function signOut() {
    await api.signOut();
    setInfo((i) => ({ ...i, signedIn: false, user: undefined, expiryDays: undefined }));
    setPhase("signin");
  }

  const stop = () => api.command({ type: "abort" });

  // The file tree (left) and the file viewer (right). Read the tree again when the agent is done and after
  // each notice (for example "Undo complete"), so the git status and the changed files stay correct.
  const [tree, setTree] = useState({ files: [], status: {}, agent: [], git: false });
  const [showTree, setShowTree] = useState(true);
  const [viewing, setViewing] = useState(undefined);
  const [selectedFile, setSelectedFile] = useState(undefined);
  const [treeTick, setTreeTick] = useState(0);
  useEffect(() => {
    if (phase === "chat" && !state.busy) api.fileTree().then(setTree);
  }, [phase, state.busy, state.items.length, treeTick]);
  // catatui sends the number of undo steps (undo.ts). Undo is on only if there is a step.
  const undoSteps = Number(state.status["catatui-undo"] ?? 0);
  // File cards read the file again when this changes: after each tool, after Undo, and after a refresh.
  const fileTick = `${state.items.filter((it) => it.kind === "tool" && !it.running).length}-${undoSteps}-${treeTick}-${state.busy}`;

  // A double click on a file: show the file in the chat, and the agent asks what to do with it.
  // Add files to the chat (double click in the tree, or drag and drop). The agent does not read them yet:
  // it asks what to do. The file cards are the lines that start with FILE_PREFIX.
  const addFiles = (paths) => {
    if (!paths.length) return;
    const names = paths.join(", ");
    send(`${paths.map((p) => `${FILE_PREFIX}${p}`).join("\n")}\n` +
      `I added ${paths.length === 1 ? "this file" : "these files"} from the project folder: ${names}. ${paths.length === 1 ? "It is" : "They are"} not an attachment. ` +
      `Do not read ${paths.length === 1 ? "it" : "them"} and do not use any tool now. Reply with only this question: ` +
      `"What would you like me to do with ${paths.length === 1 ? "this file" : "these files"}?" ` +
      "Later, read a file with the tool for its type (read, excel_read, pdf_read, or docx_read), not with bash.");
  };
  const askAboutFile = (path) => addFiles([path]);

  // Drag and drop: files from the tree, or from Finder or Explorer (only files in the project).
  const [dropping, setDropping] = useState(false);
  async function onDrop(e) {
    e.preventDefault();
    setDropping(false);
    const fromTree = e.dataTransfer.getData("text/x-catatui-path");
    if (fromTree) return addFiles([fromTree]);
    const paths = [];
    for (const f of e.dataTransfer.files) {
      const r = await api.projectPath(api.pathForFile(f));
      if (r.error) local((st) => notice(st, "warning", r.error));
      else paths.push(r.path);
    }
    addFiles(paths);
  }

  if (phase === "signin") return <SignIn info={info} onDone={boot} />;
  if (phase === "projects") return <Projects onOpen={openProject} onCancel={info.project ? () => setPhase("chat") : undefined} />;
  if (phase === "loading") return <div className="loading"><img src={logo} alt="" /><p>Starting catatui...</p></div>;

  return (
    <div className="app">
      <header className="top">
        <img src={logo} alt="" className="logo big" />
        <div className="title">
          <strong className="app-name">catai</strong>
        </div>
        <div className="actions">
          {Object.entries(state.status).filter(([k]) => !CONTROLLED.includes(k)).map(([k, v]) => <span key={k} className="chip">{plain(v)}</span>)}
          <button className="btn" onClick={newChat} disabled={state.busy} title="Start a new chat in this project">+ New chat</button>
          <ChatsMenu busy={state.busy} onOpen={openAnySession} />
          <AccountMenu user={info.user} expiryDays={info.expiryDays} onSignOut={signOut} />
        </div>
      </header>

      <div className="pathbar">
        <FolderIcon open />
        <button className="project" title={`${info.project}\nClick to open a recent project`} onClick={() => setPhase("projects")}><bdi>{info.project}</bdi></button>
        <button className="btn small" onClick={async () => { const p = await api.pickFolder(); if (p) openProject(p); }} disabled={state.busy}>Open New Folder</button>
      </div>

      {info.expiryDays !== undefined && (
        <div className="banner">
          Your CatChat key expires in {info.expiryDays} day{info.expiryDays === 1 ? "" : "s"}.
          <button onClick={() => setPhase("signin")}>Get a new key</button>
        </div>
      )}

      <div className="body">
        {showTree
          ? <FileTree tree={tree} selected={selectedFile} onSelect={setSelectedFile} onOpen={askAboutFile} onDiff={setViewing} onRefresh={() => setTreeTick((t) => t + 1)} onCollapse={() => setShowTree(false)} />
          : <button className="tree-strip" onClick={() => setShowTree(true)} title="Show the files">»</button>}
        <div className={`main-col ${dropping ? "dropping" : ""}`}
          onDragOver={(e) => { e.preventDefault(); if (!dropping) setDropping(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false); }}
          onDrop={onDrop}>
          {dropping && <div className="drop-hint">Drop the file to add it to the chat</div>}
          <Chat items={state.items} busy={state.busy} onShowChanges={setViewing} changed={tree} scrollTick={scrollTick} fileTick={fileTick} />
          <Composer busy={state.busy} onSend={send} onStop={stop} editorText={state.editorText}
            clearEditorText={() => local((s) => ({ ...s, editorText: undefined }))}
            canUndo={undoSteps > 0} onUndo={() => send("/undo")}
            below={<>
              <ModelMenu model={model} busy={state.busy} onPick={pickModel} />
              <ModeMenu state={parseState(state.status.catatui)} onCommand={send} />
            </>} />
        </div>
        {viewing && <FileViewer path={viewing} tick={treeTick + state.items.length} onClose={() => setViewing(undefined)} onAsk={askAboutFile} />}
      </div>

      {state.dialogs[0] && (
        <Dialog req={state.dialogs[0]} onAnswer={(resp) => { api.respond(resp); local((s) => closeDialog(s, state.dialogs[0].id)); }} />
      )}

      {log && state.items.at(-1)?.text?.startsWith("catatui stopped") && <pre className="log">{log}</pre>}
    </div>
  );
}

// A user message that starts with this is a file card: the student double-clicked the file in the tree.
const FILE_PREFIX = "[file] ";

// Paths -> a tree of folders. Each folder: { dirs: Map, files: [] }.
function buildTree(paths) {
  const root = { dirs: new Map(), files: [] };
  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    for (const dir of parts.slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { dirs: new Map(), files: [] });
      node = node.dirs.get(dir);
    }
    node.files.push(p);
  }
  return root;
}

// The files of the project, with the git status. A click shows the file, a double click asks the agent about it.
function FileTree({ tree, selected, onSelect, onOpen, onDiff, onRefresh, onCollapse }) {
  const [changedOnly, setChangedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(() => new Set());
  // Colors like IntelliJ, only in a git repository: green new, blue modified, red deleted.
  const mark = (p) => (tree.git ? tree.status[p] : undefined);
  // Search: every word must be in the path (any case). A search shows all matching folders open.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const paths = tree.files
    .filter((p) => !changedOnly || mark(p))
    .filter((p) => words.every((w) => p.toLowerCase().includes(w)));
  const expandAll = changedOnly || words.length > 0;
  // The right-click menu (native, from main.js).
  const menu = async (e, p, folder) => {
    e.preventDefault();
    if (!folder) onSelect(p);
    const m = mark(p);
    const isText = !/\.(xlsx?|docx?|pptx?|pdf|png|jpe?g|gif|webp|ico|zip|gz)$/i.test(p);
    const picked = await api.fileMenu(p, { folder, canDiff: !folder && isText && (m === "M" || m === "R") });
    if (picked === "add") onOpen(p);
    if (picked === "diff") onDiff(p);
  };
  const root = buildTree(paths);
  const hasChange = (prefix) => paths.some((p) => p.startsWith(prefix) && mark(p));
  const toggle = (dir) => setOpen((o) => { const n = new Set(o); n.has(dir) ? n.delete(dir) : n.add(dir); return n; });

  const renderNode = (node, prefix, depth) => (
    <>
      {[...node.dirs.keys()].sort().map((name) => {
        const dir = `${prefix}${name}/`;
        const isOpen = expandAll || open.has(dir);
        return (
          <div key={dir}>
            <button className="tree-row dir" style={{ paddingLeft: `${0.4 + depth * 1.1}rem` }} onClick={() => toggle(dir)}
              onContextMenu={(e) => menu(e, dir.slice(0, -1), true)}>
              <span className="tree-caret">{isOpen ? "▾" : "▸"}</span>
              <FolderIcon open={isOpen} />
              <span className={`tree-name ${hasChange(dir) ? "git-M" : ""}`}>{name}</span>
            </button>
            {isOpen && renderNode(node.dirs.get(name), dir, depth + 1)}
          </div>
        );
      })}
      {node.files.sort().map((p) => {
        const m = mark(p);
        return (
          <button key={p} className={`tree-row ${p === selected ? "current" : ""}`} style={{ paddingLeft: `${1.4 + depth * 1.1}rem` }}
            title={`${p}\nDouble-click or drag into the chat to add the file. catatui asks what you want to do with it.`}
            draggable onDragStart={(e) => { e.dataTransfer.setData("text/x-catatui-path", p); e.dataTransfer.effectAllowed = "copy"; }}
            onClick={() => onSelect(p)} onDoubleClick={() => onOpen(p)} onContextMenu={(e) => menu(e, p, false)}>
            <FileIcon name={p.slice(prefix.length)} />
            <span className={`tree-name ${m ? `git-${m === "?" || m === "A" ? "new" : m === "D" ? "D" : "M"}` : ""}`} title={m ? STATUS_NAMES[m] ?? m : undefined}>{p.slice(prefix.length)}</span>
          </button>
        );
      })}
    </>
  );

  return (
    <aside className="tree">
      <div className="tree-head">
        {tree.git
          ? <label className="small"><input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} /> Changed only</label>
          : <span className="small muted">Files</span>}
        <span className="tree-tools">
          <button className="icon-btn" onClick={onRefresh} title="Read the files again" aria-label="Refresh">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 6.5A6.5 6.5 0 1 0 16.5 11" /><path d="M16 2.5v4.3h-4.3" /></svg>
          </button>
          <button className="icon-btn" onClick={onCollapse} title="Hide the files" aria-label="Hide the files">«</button>
        </span>
      </div>
      <div className="tree-search">
        <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4.5 4.5" /></svg>
        <input type="search" value={query} placeholder="Search files" onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
            if (e.key === "Enter" && paths.length === 1) onOpen(paths[0]);
          }} />
      </div>
      <div className="tree-body">
        {paths.length === 0 && <p className="muted small pad">{words.length ? "No files match the search." : changedOnly ? "No changed files." : "No files."}</p>}
        {renderNode(root, "", 0)}
      </div>
    </aside>
  );
}

const STATUS_NAMES = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", "?": "New file, not in git (untracked)" };

// The right panel: a file and its changes. "Before" is the last commit in git, or the file before the agent changed it.
function FileViewer({ path, tick, onClose, onAsk }) {
  const [file, setFile] = useState(undefined);
  useEffect(() => { api.fileView(path).then(setFile); }, [path, tick]);
  return (
    <aside className="files">
      <div className="files-head">
        <strong className="file-name" title={path}>{path}</strong>
        <button className="icon-btn" onClick={onClose} title="Close" aria-label="Close">×</button>
      </div>
      {file?.error && <p className="error pad">{file.error}</p>}
      {file && !file.error && (
        <>
          <div className="muted small pad">
            {file.status === "same" ? "No changes." : file.status === "added" ? "New file." : file.status === "deleted" ? "The file was deleted." : `Changes since the ${file.base}.`}
          </div>
          <FileDiff file={file} />
        </>
      )}
    </aside>
  );
}

function FileDiff({ file }) {
  if (file.binary || file.big) {
    return (
      <div className="pad">
        <p className="muted small">{file.binary ? "This file is not text (for example an Excel or Word file), so there is no diff." : "This file is too large to show a diff."}</p>
        {file.status !== "deleted" && <button onClick={() => api.openPath(file.path)}>Open the file</button>}
      </div>
    );
  }
  // No change: show the whole file with line numbers.
  if (file.status === "same") {
    return (
      <div className="diff-view">
        {file.after.split("\n").map((line, i) => (
          <div key={i} className="dl ctx"><span className="ln">{i + 1}</span><span className="dt">{line}</span></div>
        ))}
      </div>
    );
  }
  const patch = structuredPatch(file.path, file.path, file.before, file.after, "", "", { context: 3 });
  return (
    <div className="diff-view">
      {patch.hunks.map((h, i) => {
        let oldNo = h.oldStart;
        let newNo = h.newStart;
        return (
          <div key={i} className="hunk">
            <div className="hunk-head">@@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@</div>
            {h.lines.map((line, j) => {
              // "\ No newline at end of file" is not a line of the file.
              if (line.startsWith("\\")) return null;
              const kind = line[0] === "+" ? "add" : line[0] === "-" ? "del" : "ctx";
              const nums = kind === "add" ? ["", newNo++] : kind === "del" ? [oldNo++, ""] : [oldNo++, newNo++];
              return (
                <div key={j} className={`dl ${kind}`}>
                  <span className="ln">{nums[0]}</span><span className="ln">{nums[1]}</span>
                  <span className="dt">{line}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// The project screen: a traditional list of recent projects (from the catatui sessions), and buttons to open one.
// Click selects a row, double-click or Open opens it.
function Projects({ onOpen, onCancel }) {
  const [projects, setProjects] = useState(undefined);
  const [selected, setSelected] = useState(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    api.listProjects().then((p) => { setProjects(p); setSelected(p[0]?.path); }, () => setProjects([]));
  }, []);
  const open = async (path) => {
    if (!path) return;
    setError("");
    const err = await onOpen(path);
    if (err) setError(err);
  };
  // Escape goes back to the open project, the same as Cancel.
  useEffect(() => {
    if (!onCancel) return;
    const onKey = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="projects-screen">
      <div className="window">
        <div className="window-title">
          <img src={logo} alt="" />
          <span>Open a project</span>
        </div>
        <div className="window-body">
          <p>catatui works in one folder: your project. It can read and change the files in this folder.</p>
          <div><button className="btn" onClick={async () => open(await api.pickFolder())}>Open a folder...</button></div>
          <div className="list-label">Or open a recent project</div>
          <div className="listbox" role="listbox" tabIndex={0}
            onKeyDown={(e) => {
              if (!projects?.length) return;
              const i = projects.findIndex((p) => p.path === selected);
              if (e.key === "ArrowDown") setSelected(projects[Math.min(projects.length - 1, i + 1)].path);
              if (e.key === "ArrowUp") setSelected(projects[Math.max(0, i - 1)].path);
              if (e.key === "Enter") open(selected);
            }}>
            <div className="list-row list-header">
              <span className="col-name">Name</span>
              <span className="col-path">Location</span>
              <span className="col-when">Last used</span>
              <span className="col-count">Chats</span>
            </div>
            {projects === undefined && <div className="list-empty">Loading...</div>}
            {projects?.length === 0 && <div className="list-empty">No recent projects. Click "Open a folder..." to start.</div>}
            {projects?.map((p) => (
              <div key={p.path} role="option" aria-selected={p.path === selected} className={`list-row ${p.path === selected ? "selected" : ""}`}
                title={p.path} onClick={() => setSelected(p.path)} onDoubleClick={() => open(p.path)}>
                <span className="col-name"><FolderIcon open={false} /> {p.name}</span>
                {/* rtl puts the ellipsis on the left. bdi keeps the path itself in normal order. */}
                <span className="col-path"><bdi>{p.display ?? p.path}</bdi></span>
                <span className="col-when">{ago(p.modified)}</span>
                <span className="col-count">{p.sessions}</span>
              </div>
            ))}
          </div>
          {error && <p className="error">{error}</p>}
        </div>
        <div className="window-buttons">
          <span className="spacer" />
          {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}
          <button className="btn primary default" onClick={() => open(selected)} disabled={!selected}>Open</button>
        </div>
      </div>
    </div>
  );
}

// "New chat" and the old chats of this project.
function ChatsMenu({ busy, onOpen }) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  async function toggle() {
    if (!open) setSessions(await api.listSessions());
    setOpen(!open);
  }
  return (
    <span className="menu-wrap">
      <button className={`btn ${open ? "pressed" : ""}`} onClick={toggle} disabled={busy} title={busy ? "Wait until the agent is done" : "Old chats in all projects"}>History ▾</button>
      {open && (
        <div className="menu wide history" onMouseLeave={() => setOpen(false)}>
          <div className="menu-head">Old chats</div>
          {sessions.length === 0 && <div className="menu-empty">No old chats yet.</div>}
          {sessions.map((s) => (
            <button key={s.path} disabled={!s.exists} onClick={() => { setOpen(false); onOpen(s); }}
              title={s.exists ? s.cwd : `${s.cwd} does not exist now`}>
              <span className="chat-first">{(s.name ?? s.first ?? "(no text)").replace(/^\[file\] /, "File: ").split("\n")[0]}</span>
              <span className="history-meta">
                <span className={`history-folder ${s.here ? "here" : ""}`}><FolderIcon open={false} /><bdi>{s.folder}</bdi></span>
                <span className="menu-note">{ago(s.modified)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

// "5 minutes ago", "3 days ago".
function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

// Status keys that the mode menu shows. catatui sends the mode and options as JSON in "catatui".
const CONTROLLED = ["catatui", "catatui-undo", "catatui-switch", "mode", "ta", "sandbox", "ste"];

function parseState(json) {
  try {
    return json ? JSON.parse(json) : undefined;
  } catch {
    return undefined;
  }
}

const OPTION_NAMES = { ta: "Teaching assistant", sandbox: "Sandbox", ste: "Simple English" };

// The mode and options, like the /mode panel in the terminal. Changes go to catatui as /mode commands.
function ModeMenu({ state, onCommand }) {
  const [open, setOpen] = useState(false);
  if (!state) return null;
  const on = state.flags.filter((f) => state[f]);
  return (
    <span className="menu-wrap">
      <button className={`btn mode-${state.mode} ${open ? "pressed" : ""}`} onClick={() => setOpen(!open)} title="Mode and options">
        <span className="btn-label">Mode</span> {state.mode}{state.ta ? " + ta" : ""}{state.sandbox ? "" : " (no sandbox)"} ▾
      </button>
      {open && (
        <div className="menu wide up" onMouseLeave={() => setOpen(false)}>
          <div className="menu-head">Mode</div>
          {state.modes.map((m) => (
            <label key={m} className="menu-row">
              <input type="radio" name="mode" checked={state.mode === m} onChange={() => onCommand(`/mode ${m}`)} />
              <span><span className="menu-id">{m}</span><span className="menu-note">{state.help[m]}</span></span>
            </label>
          ))}
          <div className="menu-head">Options</div>
          {state.flags.map((f) => (
            <label key={f} className="menu-row">
              <input type="checkbox" checked={on.includes(f)} onChange={(e) => onCommand(`/mode ${f} ${e.target.checked ? "on" : "off"}`)} />
              <span><span className="menu-id">{OPTION_NAMES[f] ?? f}</span><span className="menu-note">{state.help[f]}</span></span>
            </label>
          ))}
        </div>
      )}
    </span>
  );
}

// The first screen when there is no sign-in, and the screen to get a new key.
function SignIn({ info, onDone }) {
  // "start", "waiting" (for the browser), or "key" (paste a key)
  const [step, setStep] = useState("start");
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => api.onSignInUrl(setUrl), []);

  async function sso() {
    setError("");
    setStep("waiting");
    const r = await api.signInSso();
    if (r.ok) return success(r.user);
    setStep("start");
    if (!/cancelled/.test(r.error)) setError(r.error);
  }

  // Show the "signed in" animation, then go on.
  const [who, setWho] = useState(undefined);
  function success(user) {
    setWho(netId(user) ?? "");
    setStep("done");
    setTimeout(onDone, 1800);
  }

  async function useKey() {
    setError("");
    setChecking(true);
    const r = await api.signInKey(key);
    setChecking(false);
    if (r.ok) return success(r.user);
    setError(r.error);
  }

  return (
    <div className="signin">
      <div className="card">
        <img src={logo} alt="Montana State University bobcat logo" />
        {step !== "done" && <h1>Sign in to CatChat</h1>}
        {info.signedIn && <p className="muted">Your key expires soon. Sign in to get a new key.</p>}

        {step === "start" && (
          <>
            <p className="muted">catatui uses the free MSU CatChat models. Sign in with your MSU account, then click "Create key" in the browser.</p>
            <button className="big" onClick={sso}>Sign in with your MSU account</button>
            <button className="link" onClick={() => setStep("key")}>Use a key from catchat access instead</button>
          </>
        )}

        {step === "done" && (
          <div className="signed-in">
            <svg viewBox="0 0 52 52" className="check" aria-hidden="true">
              <circle cx="26" cy="26" r="24" />
              <path d="M15 27 l7 7 l15 -16" />
            </svg>
            <p><strong>Signed in{who ? ` as ${who}` : ""}</strong></p>
            <p className="muted">Starting catatui...</p>
          </div>
        )}

        {step === "waiting" && (
          <>
            <p>Finish the sign-in in your browser.</p>
            <p className="muted">If the browser did not open, <button className="link inline" onClick={() => api.openExternal(url)} disabled={!url}>open the page again</button>.</p>
            <button className="secondary" onClick={() => api.signInCancel()}>Cancel</button>
          </>
        )}

        {step === "key" && (
          <>
            <ol className="steps">
              <li>Open <button className="link inline" onClick={() => api.openExternal("https://catchat-access.msu.montana.edu")}>catchat access</button>.</li>
              <li>Click "API Keys", then "+ Free Key".</li>
              <li>Give the key a name, select "Student" as your Team, then click "Create Key".</li>
              <li>Copy the key and paste it here.</li>
            </ol>
            <textarea rows={2} value={key} placeholder="sk-..." onChange={(e) => setKey(e.target.value)} autoFocus />
            <button className="big" onClick={useKey} disabled={!key.trim() || checking}>{checking ? "Checking..." : "Use this key"}</button>
            <button className="link" onClick={() => setStep("start")}>Back</button>
          </>
        )}

        {error && <p className="error">{error}</p>}
        {step !== "done" && <p className="muted small">The sign-in works only on the MSU network. If you are off campus, connect to the MSU VPN first.</p>}
      </div>
    </div>
  );
}

// The model chip. A click shows the CatChat models with their notes.
function ModelMenu({ model, busy, onPick }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState([]);
  async function toggle() {
    if (!open) {
      const r = await api.command({ type: "get_available_models" });
      setModels(r.success ? r.data.models : []);
    }
    setOpen(!open);
  }
  return (
    <span className="menu-wrap">
      <button className={`btn ${open ? "pressed" : ""}`} onClick={toggle} disabled={busy} title={busy ? "Wait until the agent is done" : "Pick a model"}>
        {model?.id ?? "No model"} ▾
      </button>
      {open && (
        <div className="menu up" onMouseLeave={() => setOpen(false)}>
          {models.map((m) => (
            <button key={`${m.provider}/${m.id}`} className={m.id === model?.id ? "current" : ""} onClick={() => { setOpen(false); onPick(m); }}>
              <span className="menu-id">{m.id}</span>
              {m.name && m.name !== m.id && <span className="menu-note">{m.name}</span>}
            </button>
          ))}
          {models.length === 0 && <div className="menu-empty">No models. Check your sign-in.</div>}
        </div>
      )}
    </span>
  );
}

// The NetID from the key alias. CatChat names keys <NetID>_<name> (App Connect: <NetID>_catatui, -2, -3 ...).
// CatChat has no real name for the student, only the NetID.
export const netId = (user) => (user ? user.split("_")[0] : undefined);

function AccountMenu({ user, expiryDays, onSignOut }) {
  const [open, setOpen] = useState(false);
  const id = netId(user);
  return (
    <span className="menu-wrap">
      <button className={`btn ${open ? "pressed" : ""}`} onClick={() => setOpen(!open)} title={id ? `Signed in to CatChat as ${id}` : "Account"}>
        <svg className="person" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="7" r="4" /><path d="M2.5 18c.8-4 4-6 7.5-6s6.7 2 7.5 6z" /></svg>
        {id ?? "MSU account"} ▾
      </button>
      {open && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          <div className="menu-head">Signed in to CatChat</div>
          <div className="account-id">{id ?? "MSU account (pasted key)"}</div>
          {expiryDays !== undefined && <div className="menu-note pad-x">The key expires in {expiryDays} days.</div>}
          <button onClick={() => { setOpen(false); onSignOut(); }}>Sign out</button>
        </div>
      )}
    </span>
  );
}

function Chat({ items, busy, onShowChanges, changed, scrollTick, fileTick }) {
  const end = useRef(null);
  const box = useRef(null);
  // Keep the newest text in view, unless the student scrolled up to read.
  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) end.current?.scrollIntoView();
  }, [items]);
  // After a send, always go to the bottom (also after the file card loads).
  useEffect(() => {
    if (!scrollTick) return;
    end.current?.scrollIntoView();
    const t = setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth" }), 400);
    return () => clearTimeout(t);
  }, [scrollTick]);

  return (
    <main className="chat" ref={box}>
      {items.length === 0 && (
        <div className="empty">
          <img src={logo} alt="" />
          <p>Type what you want in plain words. Type <code>/help</code> to see what catatui can do.</p>
        </div>
      )}
      {items.map((it, i) => <Item key={i} it={it} onShowChanges={onShowChanges} changed={changed} fileTick={fileTick} />)}
      {busy && <div className="working">Working...</div>}
      <div ref={end} />
    </main>
  );
}

function Item({ it, onShowChanges, changed, fileTick }) {
  if (it.kind === "user" && it.text.startsWith(FILE_PREFIX)) {
    const paths = it.text.split("\n").filter((l) => l.startsWith(FILE_PREFIX)).map((l) => l.slice(FILE_PREFIX.length));
    // A diff only for a file that git shows as modified (not new or deleted). FileCard also checks that it is text.
    const isModified = (p) => changed?.git && ["M", "R"].includes(changed.status?.[p]);
    return (
      <div className="file-cards">
        {paths.map((p) => <FileCard key={p} path={p} tick={fileTick} onShowChanges={isModified(p) ? () => onShowChanges(p) : undefined} />)}
      </div>
    );
  }
  if (it.kind === "user") return <div className="msg user">{it.text}</div>;
  if (it.kind === "notice") return <pre className={`notice ${it.level}`}>{plain(it.text)}</pre>;
  if (it.kind === "tool") return <Tool it={it} />;
  return (
    <div className="msg assistant">
      {it.blocks.map((b, i) =>
        b.type === "thinking" ? (
          <details key={i} className="thinking"><summary>Thinking</summary><div>{b.text}</div></details>
        ) : (
          <div key={i} className="md" dangerouslySetInnerHTML={{ __html: marked.parse(b.text) }} />
        ),
      )}
      {it.error && <div className="notice error">{it.error}</div>}
    </div>
  );
}

// The app that opens a file type, for the "Open in ..." button. The computer's default app for the type opens it.
// Only Office files get a name. Other files get "Open".
const OPEN_IN = { xlsx: "Excel", xls: "Excel", csv: "Excel", docx: "Word", doc: "Word", pptx: "PowerPoint", ppt: "PowerPoint" };
const sizeText = (n) => (n < 1024 ? `${n} bytes` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// A file that the student selected: the type icon, the name, a preview of a text file, and buttons.
// Binary files (Excel, Word, PDF) are not shown here. "Open in ..." opens them in their own app.
function FileCard({ path, tick, onShowChanges }) {
  const [p, setP] = useState(undefined);
  useEffect(() => { api.filePreview(path).then(setP); }, [path, tick]);
  const name = path.split("/").pop();
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  const app = OPEN_IN[ext];
  const meta = [path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "", p && !p.error ? sizeText(p.size) : ""].filter(Boolean).join(" - ");
  // A page: a small header, then the first lines of a text file (like a thumbnail), or a large icon.
  return (
    <div className="file-card" title={path}>
      <div className="file-card-head">
        <FileIcon name={name} />
        <span className="file-card-name">{name}</span>
      </div>
      <div className="file-card-page">
        {p?.error && <div className="file-card-msg">{p.error}</div>}
        {p && !p.error && !p.binary && <pre className="file-card-text">{p.text}</pre>}
        {p?.image && <img className="file-card-image" src={p.image} alt={name} />}
        {p?.binary && !p.image && <div className="file-card-big"><FileIcon name={name} /></div>}
      </div>
      <div className="file-card-foot">
        <span className="menu-note">{meta}</span>
        <span className="file-card-buttons">
          {onShowChanges && p && !p.binary && !p.error && <button className="btn small" onClick={onShowChanges}>Diff</button>}
          {p && !p.error && <button className="btn small" onClick={() => api.openPath(path)}>{app ? `Open in ${app}` : "Open"}</button>}
        </span>
      </div>
    </div>
  );
}

function Tool({ it }) {
  const text = resultText(it.result);
  const diff = it.result?.details?.diff;
  return (
    <details className={`tool ${it.isError ? "failed" : ""}`}>
      <summary>
        <span className="tool-name">{it.name}</span>
        <span className="tool-what">{toolSummary(it.name, it.args, PROJECT)}</span>
        <span className="tool-state">{it.running ? "running" : it.isError ? "failed" : "done"}</span>
      </summary>
      {diff ? <pre className="diff">{diff}</pre> : text && <pre>{text.length > 8000 ? `${text.slice(0, 8000)}\n...` : text}</pre>}
    </details>
  );
}

// The message box, with a toolbar under it: the model, the mode, and Undo (children), and Send or Stop.
function Composer({ busy, onSend, onStop, editorText, clearEditorText, canUndo, onUndo, below }) {
  const [text, setText] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (editorText === undefined) return;
    setText(editorText);
    clearEditorText();
    ref.current?.focus();
  }, [editorText]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  return (
    <footer className="composer">
      <div className="composer-left">
        <textarea className="input-field" ref={ref} value={text} autoFocus rows={Math.min(8, Math.max(3, text.split("\n").length))}
          placeholder={busy ? "The agent is working. Your message waits until it is done." : "Ask catatui. Enter sends, Shift+Enter is a new line."}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            if (e.key === "Escape" && busy) onStop();
          }} />
      </div>
      <div className="composer-right">
        {busy
          ? <button className="btn danger send" onClick={onStop} title="The agent is working. Click or press Escape to stop it."><span className="spinner" aria-hidden="true" />Stop</button>
          : <button className="btn primary send" onClick={submit} disabled={!text.trim()}>Send</button>}
        <button className="btn" onClick={onUndo} disabled={busy || !canUndo}
          title={canUndo ? "Put back the files the agent changed in your last request" : "Nothing to undo yet"}>Undo</button>
        <div className="below-send">{below}</div>
      </div>
    </footer>
  );
}

// A question from catatui: allow a change, pick an option, or type a value.
// It looks like a normal dialog window: the question in the title bar, the details in a box, buttons at the bottom right.
// The first option (for example "Yes") is the default: it has the focus, so Enter picks it. Escape cancels.
// An option like "Yes, and do not ask again for ..." shows as a checkbox, so the buttons stay short.
function Dialog({ req, onAnswer }) {
  const [value, setValue] = useState(req.prefill ?? "");
  const [always, setAlways] = useState(false);
  const cancel = () => onAnswer({ id: req.id, cancelled: true });
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && cancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req.id]);

  const lines = plain(req.title ?? "").split("\n");
  const question = lines[0];
  const detail = lines.slice(1).join("\n").replace(/^\n+|\s+$/g, "").replace(/^ {2}/gm, "");
  const isCommand = /^Run this command/.test(question);
  const options = req.method === "select" ? req.options.map(plain) : [];
  const alwaysOption = options.find((o) => /^Yes, and /.test(o));
  const buttons = options.filter((o) => o !== alwaysOption);
  const pick = (o) => onAnswer({ id: req.id, value: always && o === "Yes" && alwaysOption ? alwaysOption : o });

  return (
    <div className="overlay">
      <div className="window dialog-window" role="dialog" aria-modal="true" aria-label={question}>
        <div className="window-title">
          <img src={logo} alt="" />
          <span>{question}</span>
        </div>
        <div className="window-body">
          {detail && <pre className="dialog-detail">{detail}</pre>}
          {isCommand && <div className="what-note change">This command can change files on your computer. Allow it only if you trust it.</div>}
          {req.message && <p>{plain(req.message)}</p>}
          {(req.method === "input" || req.method === "editor") && (
            <textarea className="input-field" autoFocus rows={req.method === "editor" ? 10 : 2} value={value} placeholder={req.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && req.method === "input") { e.preventDefault(); onAnswer({ id: req.id, value }); } }} />
          )}
        </div>
        <div className="window-buttons">
          {alwaysOption && (
            <label className="always">
              <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
              {alwaysOption.replace(/^Yes, and d/, "D")}
            </label>
          )}
          <span className="spacer" />
          <span className="key-hint">Enter: {buttons[0] ?? "OK"} · Esc: Cancel</span>
          {/* The default button (the first option) is on the right. */}
          {req.method === "select" && buttons.map((o, i) => ({ o, i })).reverse().map(({ o, i }) => (
            <button key={o} className={`btn ${i === 0 ? "primary default" : ""}`} autoFocus={i === 0} onClick={() => pick(o)}>{o}</button>
          ))}
          {req.method === "confirm" && (
            <>
              <button className="btn" onClick={() => onAnswer({ id: req.id, confirmed: false })}>No</button>
              <button className="btn primary default" autoFocus onClick={() => onAnswer({ id: req.id, confirmed: true })}>Yes</button>
            </>
          )}
          {(req.method === "input" || req.method === "editor") && (
            <>
              <button className="btn" onClick={cancel}>Cancel</button>
              <button className="btn primary default" onClick={() => onAnswer({ id: req.id, value })}>OK</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
