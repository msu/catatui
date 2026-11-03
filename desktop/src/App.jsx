import { structuredPatch } from "diff";
import { marked } from "marked";
import { useEffect, useReducer, useRef, useState } from "react";
import logo from "./bobcat.png";
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

  async function send(text) {
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

  // The files that the agent changed in this chat. Read them again when the agent is done and after each
  // notice (for example "Undo complete"), so the count and the panel stay correct.
  const [files, setFiles] = useState([]);
  const [showFiles, setShowFiles] = useState(false);
  useEffect(() => {
    if (phase === "chat" && !state.busy) api.changedFiles().then(setFiles);
  }, [phase, state.busy, state.items.length]);

  if (phase === "signin") return <SignIn info={info} onDone={boot} />;
  if (phase === "projects") return <Projects onOpen={openProject} />;
  if (phase === "loading") return <div className="loading"><img src={logo} alt="" /><p>Starting catatui...</p></div>;

  return (
    <div className="app">
      <header className="top">
        <img src={logo} alt="" className="logo" />
        <div className="title">
          <strong>catatui</strong>
          <button className="project link" title={`${info.project}\nClick to open a different project`} onClick={() => setPhase("projects")}>{info.project}</button>
        </div>
        <div className="chips">
          {Object.entries(state.status).filter(([k]) => !CONTROLLED.includes(k)).map(([k, v]) => <span key={k} className="chip">{plain(v)}</span>)}
          <button className={`chip ${showFiles ? "active" : ""}`} onClick={() => setShowFiles(!showFiles)} title="Files that the agent changed in this chat">
            Files{files.length ? ` (${files.length})` : ""}
          </button>
          <ChatsMenu busy={state.busy} onNew={newChat} onOpen={openSession} />
          <button className="chip" onClick={() => send("/undo")} disabled={state.busy} title="Put back the files the agent changed in your last request">Undo</button>
          <ModeMenu state={parseState(state.status.catatui)} onCommand={send} />
          <ModelMenu model={model} busy={state.busy} onPick={pickModel} />
          <AccountMenu user={info.user} onSignOut={signOut} />
        </div>
      </header>

      {info.expiryDays !== undefined && (
        <div className="banner">
          Your CatChat key expires in {info.expiryDays} day{info.expiryDays === 1 ? "" : "s"}.
          <button onClick={() => setPhase("signin")}>Get a new key</button>
        </div>
      )}

      <div className="body">
        <Chat items={state.items} busy={state.busy} />
        {showFiles && <FilesPanel files={files} onClose={() => setShowFiles(false)} />}
      </div>

      <Composer busy={state.busy} onSend={send} onStop={stop} editorText={state.editorText}
        clearEditorText={() => local((s) => ({ ...s, editorText: undefined }))} />

      {state.dialogs[0] && (
        <Dialog req={state.dialogs[0]} onAnswer={(resp) => { api.respond(resp); local((s) => closeDialog(s, state.dialogs[0].id)); }} />
      )}

      {log && state.items.at(-1)?.text?.startsWith("catatui stopped") && <pre className="log">{log}</pre>}
    </div>
  );
}

// The files that the agent changed in this chat, with a diff for each text file.
function FilesPanel({ files, onClose }) {
  const [sel, setSel] = useState(undefined);
  const file = files.find((f) => f.path === sel) ?? files[0];
  return (
    <aside className="files">
      <div className="files-head">
        <strong>Changed files</strong>
        <button className="link" onClick={onClose}>Close</button>
      </div>
      {files.length === 0 && <p className="muted small pad">The agent did not change files in this chat.</p>}
      <div className="file-list">
        {files.map((f) => (
          <button key={f.path} className={f === file ? "current" : ""} onClick={() => setSel(f.path)} title={f.path}>
            <span className={`file-status ${f.status}`}>{f.status === "added" ? "A" : f.status === "deleted" ? "D" : "M"}</span>
            <span className="file-name">{f.path}</span>
          </button>
        ))}
      </div>
      {file && <FileDiff file={file} />}
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
      {file.status !== "deleted" && <button className="link pad" onClick={() => api.openPath(file.path)}>Open the file</button>}
    </div>
  );
}

// The project screen: recent projects (from the catatui sessions) and a button to open a folder.
function Projects({ onOpen }) {
  const [projects, setProjects] = useState(undefined);
  const [error, setError] = useState("");
  useEffect(() => { api.listProjects().then(setProjects, () => setProjects([])); }, []);
  const open = async (path) => {
    if (!path) return;
    setError("");
    const err = await onOpen(path);
    if (err) setError(err);
  };
  return (
    <div className="signin">
      <div className="card projects">
        <img src={logo} alt="Montana State University bobcat logo" />
        <h1>Open a project</h1>
        <p className="muted">catatui works in one folder: your project. It can read and change the files in this folder.</p>
        <button className="big" onClick={async () => open(await api.pickFolder())}>Open a folder...</button>
        {error && <p className="error">{error}</p>}
        {projects === undefined && <p className="muted">Loading recent projects...</p>}
        {projects?.length > 0 && (
          <>
            <div className="menu-head">Recent</div>
            <div className="recent">
              {projects.map((p) => (
                <button key={p.path} onClick={() => open(p.path)} title={p.path}>
                  <span className="menu-id">{p.name}</span>
                  <span className="menu-note">{p.path}</span>
                  <span className="menu-note">{ago(p.modified)} - {p.sessions} chat{p.sessions === 1 ? "" : "s"}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// "New chat" and the old chats of this project.
function ChatsMenu({ busy, onNew, onOpen }) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  async function toggle() {
    if (!open) setSessions(await api.listSessions());
    setOpen(!open);
  }
  return (
    <span className="menu-wrap">
      <button className="chip" onClick={toggle} disabled={busy} title={busy ? "Wait until the agent is done" : "New chat and old chats"}>Chats ▾</button>
      {open && (
        <div className="menu wide" onMouseLeave={() => setOpen(false)}>
          <button onClick={() => { setOpen(false); onNew(); }}><span className="menu-id">+ New chat</span></button>
          {sessions.length > 0 && <div className="menu-head">Old chats in this project</div>}
          {sessions.map((s) => (
            <button key={s.path} onClick={() => { setOpen(false); onOpen(s.path); }}>
              <span className="chat-first">{s.name ?? s.first ?? "(no text)"}</span>
              <span className="menu-note">{ago(s.modified)} - {s.count} messages</span>
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
const CONTROLLED = ["catatui", "mode", "ta", "sandbox", "ste"];

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
      <button className={`chip mode-${state.mode}`} onClick={() => setOpen(!open)} title="Mode and options">
        {state.mode}{state.ta ? " + ta" : ""}{state.sandbox ? "" : " (no sandbox)"} ▾
      </button>
      {open && (
        <div className="menu wide" onMouseLeave={() => setOpen(false)}>
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
    if (r.ok) return onDone();
    setStep("start");
    if (!/cancelled/.test(r.error)) setError(r.error);
  }

  async function useKey() {
    setError("");
    setChecking(true);
    const r = await api.signInKey(key);
    setChecking(false);
    if (r.ok) return onDone();
    setError(r.error);
  }

  return (
    <div className="signin">
      <div className="card">
        <img src={logo} alt="Montana State University bobcat logo" />
        <h1>Sign in to CatChat</h1>
        {info.signedIn && <p className="muted">Your key expires soon. Sign in to get a new key.</p>}

        {step === "start" && (
          <>
            <p className="muted">catatui uses the free MSU CatChat models. Sign in with your MSU account, then click "Create key" in the browser.</p>
            <button className="big" onClick={sso}>Sign in with your MSU account</button>
            <button className="link" onClick={() => setStep("key")}>Use a key from catchat access instead</button>
          </>
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
        <p className="muted small">The sign-in works only on the MSU network. If you are off campus, connect to the MSU VPN first.</p>
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
      <button className="chip model" onClick={toggle} disabled={busy} title={busy ? "Wait until the agent is done" : "Pick a model"}>
        {model?.id ?? "no model"} ▾
      </button>
      {open && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
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

function AccountMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="menu-wrap">
      <button className="chip" onClick={() => setOpen(!open)} title="Account">{user ?? "Account"} ▾</button>
      {open && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          <button onClick={() => { setOpen(false); onSignOut(); }}>Sign out</button>
        </div>
      )}
    </span>
  );
}

function Chat({ items, busy }) {
  const end = useRef(null);
  const box = useRef(null);
  // Keep the newest text in view, unless the student scrolled up to read.
  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) end.current?.scrollIntoView();
  }, [items]);

  return (
    <main className="chat" ref={box}>
      {items.length === 0 && (
        <div className="empty">
          <img src={logo} alt="" />
          <p>Type what you want in plain words. Type <code>/help</code> to see what catatui can do.</p>
        </div>
      )}
      {items.map((it, i) => <Item key={i} it={it} />)}
      {busy && <div className="working">Working...</div>}
      <div ref={end} />
    </main>
  );
}

function Item({ it }) {
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

function Composer({ busy, onSend, onStop, editorText, clearEditorText }) {
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
      <textarea ref={ref} value={text} autoFocus rows={Math.min(8, Math.max(2, text.split("\n").length))}
        placeholder={busy ? "The agent is working. Your message waits until it is done." : "Ask catatui. Enter sends, Shift+Enter is a new line."}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          if (e.key === "Escape" && busy) onStop();
        }} />
      {busy ? <button className="stop" onClick={onStop}>Stop</button> : <button onClick={submit} disabled={!text.trim()}>Send</button>}
    </footer>
  );
}

// A question from catatui: allow a change, pick an option, or type a value.
function Dialog({ req, onAnswer }) {
  const [value, setValue] = useState(req.prefill ?? "");
  const cancel = () => onAnswer({ id: req.id, cancelled: true });
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && cancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req.id]);

  return (
    <div className="overlay">
      <div className="dialog" role="dialog" aria-modal="true">
        <pre className="dialog-title">{plain(req.title)}</pre>
        {req.message && <p>{plain(req.message)}</p>}
        {req.method === "select" && (
          <div className="options">
            {req.options.map((o, i) => (
              <button key={o} autoFocus={i === 0} onClick={() => onAnswer({ id: req.id, value: o })}>{plain(o)}</button>
            ))}
          </div>
        )}
        {req.method === "confirm" && (
          <div className="options">
            <button autoFocus onClick={() => onAnswer({ id: req.id, confirmed: true })}>Yes</button>
            <button onClick={() => onAnswer({ id: req.id, confirmed: false })}>No</button>
          </div>
        )}
        {(req.method === "input" || req.method === "editor") && (
          <>
            <textarea autoFocus rows={req.method === "editor" ? 10 : 2} value={value} placeholder={req.placeholder} onChange={(e) => setValue(e.target.value)} />
            <div className="options"><button onClick={() => onAnswer({ id: req.id, value })}>OK</button></div>
          </>
        )}
        <button className="cancel" onClick={cancel}>Cancel (Esc)</button>
      </div>
    </div>
  );
}
