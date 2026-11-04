import { structuredPatch } from "diff";
import { marked } from "marked";
import { useEffect, useReducer, useRef, useState } from "react";
import logo from "./bobcat.png";
import { FileIcon, FolderIcon } from "./icons.jsx";
import { PlanCard, Widget } from "./widgets.jsx";
import { isLocalUrl } from "../webapp.js";
import { closeDialog, initialState, itemsFromMessages, notice, plain, reduce, resultText, toolSummary, WIDGET_PREFIX, widgetAnswer } from "./chat.js";

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
    // From the chat screen, keep the screen while catatui starts. A parked catatui is ready at once.
    if (phase !== "chat") setPhase("loading");
    // Clear the chat before the start, so the status that catatui sends at start (the mode) stays.
    local(() => initialState);
    const r = await api.start();
    setModel(r.success ? r.data?.model : undefined);
    refreshThinking();
    // A window opened for an old chat: open it.
    if (i.openSession) await api.command({ type: "switch_session", sessionPath: i.openSession });
    // A project opens its last conversation, if catatui started a new, empty one.
    if (i.kind === "project" && !i.openSession) {
      const m0 = await api.command({ type: "get_messages" });
      if (!m0.data?.messages?.length) {
        const last = ((await api.listSessions()) ?? []).find((x) => x.cwd === i.project);
        if (last) await api.command({ type: "switch_session", sessionPath: last.path });
      }
    }
    // Advising, Classes, and each class have one session. If catatui started a new one, open the old one.
    if (["advising", "classes", "class"].includes(i.kind)) {
      const session = ((await api.listSessions()) ?? []).find((x) => x.cwd === i.project);
      if (session && session.path !== r.data?.sessionFile) await api.command({ type: "switch_session", sessionPath: session.path });
    }
    // A parked catatui can have a chat open. Show its messages.
    const m = await api.command({ type: "get_messages" });
    const items = itemsFromMessages(m.data?.messages);
    if (items.length) {
      local((s) => ({ ...s, items }));
      setScrollTick((t) => t + 1);
    }
    setPhase("chat");
    refreshNames(i);
  }

  // The names on the Chats and Projects buttons: the open chat (or the last chat), and the open project (or the last project).
  const [names, setNames] = useState({});
  const namesSeq = useRef(0);
  async function refreshNames(i = info) {
    // Only the newest call sets the names. An older call can end later.
    const seq = ++namesSeq.current;
    const [sessions, st] = await Promise.all([api.listSessions(), api.command({ type: "get_state" })]);
    if (seq !== namesSeq.current) return;
    const chats = (sessions ?? []).filter((x) => x.kind === "chat" && x.exists);
    const label = (x) => x && (x.title ?? shortText(x.name ?? x.first));
    const open = i.chat ? chats.find((x) => x.path === st.data?.sessionFile) : undefined;
    const base = (p) => p?.split(/[\\/]/).pop();
    setNames({
      chat: i.kind === "advising" ? "Academic advisor" : i.chat ? label(open) ?? "New chat" : label(chats[0]),
      project: i.chat ? base(i.lastProject) : base(i.project),
    });
  }
  useEffect(() => api.onTitlesUpdated(() => refreshNames()), [info]);
  useEffect(() => { if (!state.busy && phase === "chat") refreshNames(); }, [state.busy]);

  // Open a folder in this window. If another window has it, that window comes to the front (MOVED).
  async function openProject(path, sessionPath) {
    const r = await api.openProject(path, sessionPath);
    if (r.moved) return MOVED;
    if (!r.ok) return r.error;
    await boot();
  }

  // Open an old chat of this project: load it in catatui, then show its messages.
  // A chat from History. If it is in a different folder, open that project first.
  async function openAnySession(s) {
    if (!s.here) {
      const err = await openProject(s.cwd, s.path);
      if (err === MOVED) return;
      if (err) return local((st) => notice(st, "error", err));
    }
    await openSession(s.path);
  }

  async function openSession(path) {
    const r = await api.command({ type: "switch_session", sessionPath: path });
    if (!r.success || r.data?.cancelled) return local((s) => notice(s, "error", r.error ?? "catatui did not open the chat."));
    const m = await api.command({ type: "get_messages" });
    local((s) => ({ ...s, items: itemsFromMessages(m.data?.messages), busy: false, dialogs: [] }));
    // An opened chat starts at the bottom, at the newest message.
    setScrollTick((t) => t + 1);
    refreshNames();
    refreshModel();
  }

  // "New chat in this project" (Project menu): a new chat in the same project folder.
  async function newChat() {
    const r = await api.command({ type: "new_session" });
    if (r.success && !r.data?.cancelled) local((s) => ({ ...s, items: [], busy: false, dialogs: [] }));
  }

  // "New chat" (Chat menu): a new chat folder.
  async function startChat() {
    if (state.busy) return;
    if ((await api.newChat()).moved) return;
    await boot();
  }

  // Advising: there is one advising session. Open the advising folder, then the session (if there is one).
  async function goAdvising() {
    if (state.busy) return;
    if ((await api.advising()).moved) return;
    await boot();
  }

  // Classes: the overview (no code) or one class chat. Each has one session.
  async function goClasses(code) {
    if (state.busy) return;
    const r = await api.classes(code);
    if (r.moved) return;
    if (!r.ok) return local((st) => notice(st, "error", r.error ?? "catai could not open the class."));
    await boot();
  }

  // Remove sensitive information: one message ({ ts }), a tool call ({ toolCallId }), or each copy of a text ({ text }).
  // main.js asks first, changes the session file, and loads it again. Then the chat shows the new messages.
  async function removeFromChat(target) {
    const r = await api.redactSession(target);
    if (r.cancelled) return;
    if (!r.ok) return local((st) => notice(st, "error", r.error ?? "catai could not remove it."));
    const m = await api.command({ type: "get_messages" });
    local((st) => notice({ ...st, items: itemsFromMessages(m.data?.messages) }, "info",
      `Removed${target.text ? ` ${r.count} cop${r.count === 1 ? "y" : "ies"} of the text` : ""} from this conversation on this computer. CatChat got it when you sent it. This does not remove it there.`));
  }

  // A conversation was deleted (History window). If it was open here, start a new one.
  async function afterDelete(path) {
    const st = await api.command({ type: "get_state" });
    if (st.data?.sessionFile !== path) return;
    if (info.kind === "project") await newChat(); else await startChat();
  }

  // Close the project and go back to chat.
  async function goChat() {
    if (info.chat || state.busy) return;
    await startChat();
  }

  async function refreshModel() {
    const r = await api.command({ type: "get_state" });
    if (r.success) setModel(r.data?.model);
    refreshThinking();
  }

  // The thinking level (pi): off ... high, as the model supports. Shift+Tab in the message box and
  // Agent > Next Thinking Level go to the next level, like Shift+Tab in the terminal.
  const [thinking, setThinking] = useState({ level: undefined, levels: [] });
  async function refreshThinking() {
    const [st, lv] = await Promise.all([api.command({ type: "get_state" }), api.command({ type: "get_available_thinking_levels" })]);
    setThinking({ level: st.data?.thinkingLevel, levels: lv.data?.levels ?? [] });
  }
  async function setThinkingLevel(level) {
    await api.command({ type: "set_thinking_level", level });
    refreshThinking();
  }
  async function cycleThinking() {
    await api.command({ type: "cycle_thinking_level" });
    refreshThinking();
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
    const queue = state.busy && !text.startsWith("/");
    if (queue) cmd.streamingBehavior = "followUp";
    // A queued message shows at the end of the chat until the agent takes it.
    if (queue) local((s) => ({ ...s, queued: [...s.queued, text] }));
    // pi refuses a prompt while a compaction runs. A compaction while idle (idle-compact.ts) is not
    // necessary when the student is back, so stop it first. The context stays as it was.
    if (state.status["idle-compact"] && !text.startsWith("/")) await api.command({ type: "abort" });
    const r = await api.command(cmd);
    if (!r.success) local((s) => notice({ ...s, queued: queue ? s.queued.filter((q) => q !== text) : s.queued }, "error", r.error ?? "catatui did not accept the message."));
    if (text.startsWith("/model")) refreshModel();
  }

  async function pickModel(m) {
    const r = await api.command({ type: "set_model", provider: m.provider, modelId: m.id });
    if (r.success) { setModel(r.data); refreshThinking(); }
    else local((s) => notice(s, "error", r.error ?? "catatui did not change the model."));
  }

  async function signOut() {
    await api.signOut();
    setInfo((i) => ({ ...i, signedIn: false, user: undefined, expiryDays: undefined }));
    setPhase("signin");
  }

  // Take the queued messages back into the message box (pi: clear_queue returns their text).
  async function unqueue() {
    const r = await api.command({ type: "clear_queue" });
    const texts = [...(r.data?.steering ?? []), ...(r.data?.followUp ?? [])];
    local((s) => ({ ...s, queued: [], editorText: texts.length ? texts.join("\n\n") : s.editorText }));
  }
  // Stop: first take the queued messages back (else pi sends them after the stop), then stop the agent.
  const stop = async () => {
    if (state.queued.length) await unqueue();
    return api.command({ type: "abort" });
  };

  // The file tree (left) and the file viewer (right). Read the tree again when the agent is done and after
  // each notice (for example "Undo complete"), so the git status and the changed files stay correct.
  const [tree, setTree] = useState({ files: [], status: {}, agent: [], git: false });
  const [showTree, setShowTree] = useState(true);
  const [viewing, setViewing] = useState(undefined);
  const [selectedFile, setSelectedFile] = useState(undefined);
  // The "Select a folder for your project" window.
  const [picking, setPicking] = useState(false);
  // The side panel (right): tabs with pinned files and the web preview. width is in pixels, kept in localStorage.
  const [side, setSide] = useState({ tabs: [], active: undefined });
  const [sideWidth, setSideWidth] = useState(() => { try { return Number(localStorage.getItem("sideWidth")) || 480; } catch { return 480; } });
  const tabId = (t) => (t.type === "web" ? "web" : `file:${t.path}`);
  function openSide(tab) {
    setSide((st) => {
      const id = tabId(tab);
      const tabs = st.tabs.some((t) => tabId(t) === id) ? st.tabs.map((t) => (tabId(t) === id ? { ...t, ...tab } : t)) : [...st.tabs, tab];
      return { tabs, active: id };
    });
  }
  function closeSide(id) {
    setSide((st) => {
      const tabs = st.tabs.filter((t) => tabId(t) !== id);
      return { tabs, active: st.active === id ? (tabs.at(-1) ? tabId(tabs.at(-1)) : undefined) : st.active };
    });
  }
  // A project HTML file in the web preview.
  async function previewFile(path) {
    const url = await api.fileUrl(path);
    if (url) openSide({ type: "web", url, at: Date.now() });
  }
  // The web preview reloads when the agent is done (it can have changed the files) and after a file change.
  const [reloadTick, setReloadTick] = useState(0);
  // The "History" window: all chats and projects, with a search.
  const [history, setHistory] = useState(false);
  // Link a project to a class: the folder picker, then project.json in the class folder.
  const [linking, setLinking] = useState(false);
  const [linkTick, setLinkTick] = useState(0);
  const [treeTick, setTreeTick] = useState(0);
  useEffect(() => {
    if (phase === "chat" && !state.busy) api.fileTree().then(setTree);
  }, [phase, state.busy, state.items.length, treeTick, info.project]);
  // catatui sends the number of undo steps (undo.ts). Undo is on only if there is a step.
  const undoSteps = Number(state.status["catatui-undo"] ?? 0);
  // File cards read the file again when this changes: after each tool, after Undo, and after a refresh.
  useEffect(() => api.onFilesChanged(() => setTreeTick((t) => t + 1)), []);
  const fileTick = `${state.items.filter((it) => it.kind === "tool" && !it.running).length}-${undoSteps}-${treeTick}-${state.busy}`;

  // A double click on a file: show the file in the chat, and the agent asks what to do with it.
  // Add files to the chat (double click in the tree, or drag and drop). The agent does not read them yet:
  // it asks what to do. The file cards are the lines that start with FILE_PREFIX.
  const addFiles = (paths) => {
    if (!paths.length) return;
    // The full path, so the model does not search for the file (a search outside the project fails in the sandbox).
    const full = (p) => `${PROJECT.replace(/[\\/]$/, "")}/${p}`;
    send(`${paths.map((p) => `${FILE_PREFIX}${p}`).join("\n")}\n` +
      `I added ${paths.length === 1 ? "this file" : "these files"} from the project folder: ${paths.map(full).join(", ")}. ` +
      `${paths.length === 1 ? "It is" : "They are"} not an attachment, and you do not need to search for ${paths.length === 1 ? "it" : "them"}. ` +
      `Do not read ${paths.length === 1 ? "it" : "them"} and do not use any tool now. Reply with only this question: ` +
      `"What would you like me to do with ${paths.length === 1 ? "this file" : "these files"}?" ` +
      "When I answer, use the path above directly. Read a file with the tool for its type (read, excel_read, pdf_read, or docx_read) and change it with edit or write, not with bash.");
  };
  const askAboutFile = (path) => addFiles([path]);

  // show_preview (preview.ts) opens the web preview.
  useEffect(() => { if (state.preview) openSide({ type: "web", url: state.preview.url, at: state.preview.at }); }, [state.preview?.at]);
  const wasBusy = useRef(false);
  useEffect(() => {
    if (wasBusy.current && !state.busy) setReloadTick((t) => t + 1);
    wasBusy.current = state.busy;
  }, [state.busy]);
  // A new folder (another project, a chat, or a closed project): close the side panel of the old folder.
  useEffect(() => { setSide({ tabs: [], active: undefined }); }, [info.project]);

  // The keyboard. The areas, in order: the file tree, the diff, the chat, and the message box.
  // F6 and Shift+F6 (View menu) move between them. Ctrl+D (or Cmd+D) shows the diff of the selected file.
  // Escape goes back: from the diff to the tree, from the tree and the chat to the message box.
  const focusComposer = () => document.querySelector(".composer textarea")?.focus();
  const focusTree = () => (document.querySelector(".tree-row.current") ?? document.querySelector(".tree-row"))?.focus();
  function closeViewer() {
    setViewing(undefined);
    setTimeout(() => (document.querySelector(".tree-row") ? focusTree() : focusComposer()), 0);
  }
  function moveArea(step) {
    const areas = [
      { el: ".tree", focus: focusTree },
      { el: ".files", focus: () => document.querySelector(".files .diff-view, .files")?.focus() },
      { el: "main.chat", focus: () => document.querySelector("main.chat")?.focus() },
      { el: ".composer", focus: focusComposer },
    ].filter((a) => document.querySelector(a.el));
    const i = areas.findIndex((a) => document.activeElement?.closest(a.el));
    const next = areas[(i + step + areas.length) % areas.length];
    next?.focus();
  }
  // The selected file in a ref, so a fast Ctrl+D after a click gets the new selection.
  const selectedRef = useRef(undefined);
  const selectFile = (p) => { selectedRef.current = p; setSelectedFile(p); };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() !== "d" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      // In a text field, Ctrl+D keeps its normal meaning (on macOS, delete the next letter).
      if (document.activeElement?.matches("textarea, input:not([type=checkbox]):not([type=radio])")) return;
      const file = selectedRef.current;
      if (!file) return;
      e.preventDefault();
      setViewing((v) => (v === file ? undefined : file));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The application menu (main.js buildMenu). Send the state, so the menu shows the permissions and options.
  const agentState = parseState(state.status.catatui);
  useEffect(() => {
    api.menuState({ ...agentState, busy: state.busy, chat: !!info.chat, tree: showTree, webApp: !!tree.webApp, canUndo: undoSteps > 0, thinking: thinking.level, thinkingLevels: thinking.levels });
  }, [state.status.catatui, state.busy, info.chat, showTree, undoSteps, thinking]);
  // The menu actions do the same thing as the buttons. The ref has the newest functions.
  const menuActions = useRef();
  menuActions.current = (action) => {
    const [name, ...rest] = action.split(":");
    const arg = rest.join(":");
    if (phase !== "chat" && name !== "sign-out") return;
    switch (name) {
      case "new-chat": return startChat();
      case "new-project": return setPicking(true);
      case "new-chat-here": return newChat();
      case "advising": return goAdvising();
      case "classes": return goClasses();
      case "history": return setHistory(true);
      case "preview": return tree.webApp && openSide({ type: "web" });
      case "all-projects": return setPhase("projects");
      case "open": return openProject(arg).then((err) => err && local((s) => notice(s, "error", err)));
      case "close-project": return goChat();
      case "toggle-tree": return setShowTree((v) => !v);
      case "stop": return stop();
      case "undo": return send("/undo");
      case "mode": return send(`/mode ${arg}`);
      case "thinking": return setThinkingLevel(arg);
      case "next-thinking": return cycleThinking();
      case "option": return send(`/mode ${rest[0]} ${rest[1]}`);
      case "help": return send("/help");
      case "next-area": return moveArea(1);
      case "prev-area": return moveArea(-1);
      case "sign-out": return signOut();
    }
  };
  useEffect(() => api.onMenu((a) => menuActions.current(a)), []);
  // Another window asks this window to open one of its old chats.
  const openSessionRef = useRef();
  openSessionRef.current = openSession;
  useEffect(() => api.onOpenSession((path) => openSessionRef.current(path)), []);

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
        <SessionMenu info={info} name={names.chat} busy={state.busy} onNewChat={startChat} onNewProject={() => setPicking(true)}
          onNewChatHere={newChat} onAdvising={goAdvising} onClasses={() => goClasses()} onOpen={openAnySession} onAllProjects={() => setPhase("projects")} onHistory={() => setHistory(true)} />
        <div className="actions">
          {Object.entries(state.status).filter(([k]) => !CONTROLLED.includes(k)).map(([k, v]) => <span key={k} className="chip">{plain(v)}</span>)}
          <AccountMenu user={info.user} expiryDays={info.expiryDays} onSignOut={signOut} />
        </div>
      </header>

      {!info.chat && <div className="pathbar">
        <span className="pathbar-label">Project Directory:</span>
        <FolderIcon open />
        <button className="project" title={`${info.project}\nClick to open a different project`} onClick={() => setPhase("projects")}><bdi>{info.project}</bdi></button>
        {tree.webApp && <button className="btn small preview-btn" onClick={() => openSide({ type: "web" })}
          title={tree.webApp.server ? `Preview this ${tree.webApp.server.tool} app next to the chat` : "Preview the web pages of this project next to the chat"}><GlobeIcon /> Preview</button>}
        <ConversationMenu project={info.project} busy={state.busy} tick={state.items.length} onNew={newChat} onOpen={openSession} />
      </div>}

      {info.expiryDays !== undefined && (
        <div className="banner">
          Your CatChat key expires in {info.expiryDays} day{info.expiryDays === 1 ? "" : "s"}.
          <button onClick={() => setPhase("signin")}>Get a new key</button>
        </div>
      )}

      <div className="body">
        {info.kind === "advising" && <AdvisingTasks busy={state.busy} onAsk={send} />}
        {(info.kind === "classes" || info.kind === "class") && (
          <ClassesPanel kind={info.kind} busy={state.busy} onAsk={send} onClass={goClasses} onOpenProject={openProject}
            onLink={() => setLinking(true)} tick={linkTick} />
        )}
        {info.chat ? null : showTree
          ? <FileTree tree={tree} selected={selectedFile} onEscape={focusComposer} onSelect={selectFile} onOpen={askAboutFile} onDiff={setViewing} onRefresh={() => setTreeTick((t) => t + 1)} onCollapse={() => setShowTree(false)}
            onPin={(p) => openSide({ type: "file", path: p })} onPreview={previewFile} />
          : <button className="tree-strip" onClick={() => setShowTree(true)} title="Show the files">»</button>}
        {viewing && <FileViewer path={viewing} tick={treeTick + state.items.length} onClose={closeViewer} />}
        <div className={`main-col ${dropping ? "dropping" : ""}`}
          onDragOver={(e) => { e.preventDefault(); if (!dropping) setDropping(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false); }}
          onDrop={onDrop}>
          {dropping && <div className="drop-hint">Drop the file to add it to the chat</div>}
          <Chat items={state.items} busy={state.busy} onShowChanges={setViewing} changed={tree} scrollTick={scrollTick} fileTick={fileTick}
            widgets={state.widgets} onWidgetAnswer={(req, data) => { api.respond({ id: req.id, value: JSON.stringify(data) }); local((st) => closeDialog(st, req.id)); }}
            resume={info.kind === "chat" ? info.resumeProject : undefined} onResume={openProject} advising={info.kind === "advising"} onAsk={send}
            kind={info.kind} project={info.project} onOpenSession={openAnySession} onRemove={removeFromChat}
            onPin={(p) => openSide({ type: "file", path: p })} onOpenWeb={(url) => openSide({ type: "web", url, at: Date.now() })}
            onOpenView={(view, course) => (view === "advising" ? goAdvising() : goClasses(course))}
            queued={state.queued} onUnqueue={unqueue} />
          <Composer context={lastAssistantText(state.items)} busy={state.busy} onSend={send} onStop={stop} editorText={state.editorText}
            clearEditorText={() => local((s) => ({ ...s, editorText: undefined }))}
            canUndo={undoSteps > 0} onUndo={() => send("/undo")}
            below={<AgentMenu model={model} busy={state.busy} onPick={pickModel} state={parseState(state.status.catatui)} onCommand={send}
              thinking={thinking} onThinking={setThinkingLevel} />}
            onCycleThinking={thinking.levels.length > 1 ? cycleThinking : undefined} />
        </div>
        {side.tabs.length > 0 && (
          <SidePanel side={side} width={sideWidth} setWidth={setSideWidth} onActivate={(id) => setSide((st) => ({ ...st, active: id }))}
            onClose={closeSide} onOpenWeb={(url) => openSide({ type: "web", url, at: Date.now() })} fileTick={fileTick} reloadTick={reloadTick}
            files={tree.files} webApp={tree.webApp} onAsk={askAboutFile}
            onStartServer={(sv) => send(`Start the web app of this project with the server tool: ${sv.command}. When it runs, show http://localhost:${sv.port} with show_preview.`)} />
        )}
      </div>

      {history && <HistoryWindow info={info} onClose={() => setHistory(false)} onOpen={(s) => { setHistory(false); openAnySession(s); }} onDeleted={afterDelete} />}
      {linking && <LinkProject code={info.project?.split(/[\\/]/).pop()} onCancel={() => setLinking(false)}
        onPick={async (p) => { setLinking(false); await api.linkClassProject(p); setLinkTick((t) => t + 1); }} />}
      {picking && <FolderPicker onCancel={() => setPicking(false)} onPick={async (p) => { setPicking(false); const err = await openProject(p); if (err) local((st) => notice(st, "error", err)); }} />}

      {state.dialogs[0] && (
        <Dialog req={state.dialogs[0]} onAnswer={(resp) => { api.respond(resp); local((s) => closeDialog(s, state.dialogs[0].id)); }} />
      )}

      {log && state.items.at(-1)?.text?.startsWith("catatui stopped") && <pre className="log">{log}</pre>}
    </div>
  );
}

// A user message that starts with this is a file card: the student double-clicked the file in the tree.
const FILE_PREFIX = "[file] ";
// openProject returns this when another window has the folder. That window comes to the front.
const MOVED = Symbol("moved");

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
function FileTree({ tree, selected, onSelect, onOpen, onDiff, onRefresh, onCollapse, onEscape, onPin, onPreview }) {
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
    const picked = await api.fileMenu(p, { folder, canDiff: !folder && isText && (m === "M" || m === "R"), canRollback: !folder && !!m });
    if (picked === "add") onOpen(p);
    if (picked === "diff") onDiff(p);
    if (picked === "pin") onPin(p);
    if (picked === "preview") onPreview(p);
  };
  const root = buildTree(paths);
  const hasChange = (prefix) => paths.some((p) => p.startsWith(prefix) && mark(p));
  const toggle = (dir) => setOpen((o) => { const n = new Set(o); n.has(dir) ? n.delete(dir) : n.add(dir); return n; });
  // The keyboard in the tree: Up and Down move, Right opens a folder, Left closes it or goes to the parent folder,
  // Enter adds a file to the chat, Escape goes to the message box. Ctrl+D (in App) shows the diff.
  const onTreeKeys = (e) => {
    const rows = [...e.currentTarget.querySelectorAll(".tree-row")];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    const { dir, path } = rows[i].dataset;
    const go = (j) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, j))];
      r?.focus();
      if (r?.dataset.path) onSelect(r.dataset.path);
    };
    const parentRow = () => {
      const p = (dir ?? path).replace(/\/$/, "");
      const parent = p.slice(0, p.lastIndexOf("/") + 1);
      return rows.findIndex((r) => r.dataset.dir === parent);
    };
    const isOpen = dir && (expandAll || open.has(dir));
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(rows.length - 1);
    else if (e.key === "ArrowRight") { if (dir && !isOpen) toggle(dir); else if (dir) go(i + 1); }
    else if (e.key === "ArrowLeft") { if (isOpen && !expandAll) toggle(dir); else if (parentRow() >= 0) go(parentRow()); }
    else if (e.key === "Enter" && path) onOpen(path);
    else if (e.key === "Escape") onEscape();
    else return;
    e.preventDefault();
  };

  const renderNode = (node, prefix, depth) => (
    <>
      {[...node.dirs.keys()].sort().map((name) => {
        const dir = `${prefix}${name}/`;
        const isOpen = expandAll || open.has(dir);
        return (
          <div key={dir}>
            <button className="tree-row dir" data-dir={dir} style={{ paddingLeft: `${0.4 + depth * 1.1}rem` }} onClick={() => toggle(dir)}
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
          <button key={p} data-path={p} className={`tree-row ${p === selected ? "current" : ""}`} style={{ paddingLeft: `${1.4 + depth * 1.1}rem` }}
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
            if (e.key === "Escape") { if (query) setQuery(""); else onEscape(); }
            if (e.key === "Enter" && paths.length === 1) onOpen(paths[0]);
            if (e.key === "ArrowDown") { e.preventDefault(); e.currentTarget.closest(".tree").querySelector(".tree-row")?.focus(); }
          }} />
      </div>
      <div className="tree-body" onKeyDown={onTreeKeys}>
        {paths.length === 0 && <p className="muted small pad">{words.length ? "No files match the search." : changedOnly ? "No changed files." : "No files."}</p>}
        {renderNode(root, "", 0)}
      </div>
    </aside>
  );
}

const STATUS_NAMES = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", "?": "New file, not in git (untracked)" };

// The right panel: a file and its changes. "Before" is the last commit in git, or the file before the agent changed it.
function FileViewer({ path, tick, onClose }) {
  const [file, setFile] = useState(undefined);
  useEffect(() => { api.fileView(path).then(setFile); }, [path, tick]);
  return (
    <aside className="files" tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}>
      <div className="files-head">
        <strong className="file-name" title={path}>{path}</strong>
        <button className="icon-btn" onClick={onClose} title="Close (Escape)" aria-label="Close">×</button>
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
      <div className="diff-view" tabIndex={0}>
        {file.after.split("\n").map((line, i) => (
          <div key={i} className="dl ctx"><span className="ln">{i + 1}</span><span className="dt">{line}</span></div>
        ))}
      </div>
    );
  }
  const patch = structuredPatch(file.path, file.path, file.before, file.after, "", "", { context: 3 });
  return (
    <div className="diff-view" tabIndex={0}>
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
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    api.listProjects().then((p) => { setProjects(p); setSelected(p[0]?.path); }, () => setProjects([]));
  }, []);
  // The search matches the name and the location. Each word must match.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = projects?.filter((p) => words.every((w) => `${p.name} ${p.display ?? p.path}`.toLowerCase().includes(w)));
  // If the selected project is not in the search result, select the first match.
  useEffect(() => {
    if (shown && !shown.some((p) => p.path === selected)) setSelected(shown[0]?.path);
  }, [query, projects]);
  const open = async (path) => {
    if (!path) return;
    setError("");
    const err = await onOpen(path);
    if (err) setError(err);
  };
  // Escape goes back to the open project, the same as Cancel. The folder picker has its own Escape.
  useEffect(() => {
    if (!onCancel || picking) return;
    const onKey = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, picking]);
  // Arrow keys and Enter work in the search field and in the list.
  const onKeys = (e) => {
    if (!shown?.length) return;
    const i = shown.findIndex((p) => p.path === selected);
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(shown[Math.min(shown.length - 1, i + 1)].path); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected(shown[Math.max(0, i - 1)].path); }
    if (e.key === "Enter") open(selected);
  };
  useEffect(() => { document.querySelector(".list-row.selected")?.scrollIntoView({ block: "nearest" }); }, [selected]);
  return (
    <div className="projects-screen">
      {picking && <FolderPicker onPick={(path) => { setPicking(false); open(path); }} onCancel={() => setPicking(false)} />}
      <div className="window">
        <div className="window-title">
          <img src={logo} alt="" />
          <span>Open a project</span>
        </div>
        <div className="window-body">
          <p>catatui works in one folder: your project. It can read and change the files in this folder.</p>
          <div><button className="btn" onClick={() => setPicking(true)}>Open a folder...</button></div>
          <div className="list-label">Or open a recent project</div>
          <input className="input-field project-search" type="search" autoFocus placeholder="Search projects by name or location"
            value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeys} />
          <div className="listbox" role="listbox" tabIndex={0} onKeyDown={onKeys}>
            <div className="list-row list-header">
              <span className="col-name">Name</span>
              <span className="col-path">Location</span>
              <span className="col-when">Last used</span>
              <span className="col-count">Chats</span>
            </div>
            {projects === undefined && <div className="list-empty">Loading...</div>}
            {projects?.length === 0 && <div className="list-empty">No recent projects. Click "Open a folder..." to start.</div>}
            {projects?.length > 0 && shown.length === 0 && <div className="list-empty">No project matches "{query}".</div>}
            {shown?.map((p) => (
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
// Before Qwen makes a title: the first line of the first message, short. File lines become "File: name".
function shortText(text) {
  const line = (text ?? "").replace(/^\[file\] (.*)/, (_m, p) => `File: ${p.split("/").pop()}`).split("\n")[0];
  return line.length > 60 ? `${line.slice(0, 57)}...` : line || "(no text)";
}

function dayName(ms) {
  const d = new Date(ms);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

// The down arrow on menu buttons.
function Caret() {
  return (
    <svg className="caret" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="ficon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 20 17H10l-4.5 3.5V17H4a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 4 4.5z" fill="#1f5fc4" />
      <path d="M7 9h10M7 12.5h7" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

// The keyboard in a dropdown menu. When the menu opens, the checked item or the first item gets the focus.
// Up and Down move between the items. Enter clicks the item. Escape closes the menu and puts the focus back
// on the button that opened it. If the focus goes out of the menu (Tab or a click), the menu closes.
function useMenuKeys(open, setOpen) {
  const wrap = useRef(null);
  const opener = useRef(null);
  const items = () => [...(wrap.current?.querySelectorAll(".menu button:not(:disabled), .menu input:not(:disabled)") ?? [])];
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    const list = items();
    (list.find((el) => el.matches("input:checked")) ?? list[0])?.focus({ preventScroll: false });
  }, [open]);
  const onKeyDown = (e) => {
    if (!open) return;
    const list = items();
    const i = list.indexOf(document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      opener.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Also for radio buttons: the arrows move the focus, they do not change the choice.
      e.preventDefault();
      const n = list.length;
      list[(i + (e.key === "ArrowDown" ? 1 : n - 1) + n) % n]?.focus();
    } else if (e.key === "Enter" && document.activeElement?.matches(".menu input")) {
      e.preventDefault();
      document.activeElement.click();
    }
  };
  const onBlur = (e) => { if (open && !wrap.current?.contains(e.relatedTarget)) setOpen(false); };
  return { ref: wrap, onKeyDown, onBlur };
}

// The conversations of a project (right side of the project bar). The button shows the open conversation.
// The menu: New Conversation, and each conversation of the project with Rename and Delete.
function ConversationMenu({ project, busy, tick, onNew, onOpen }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState([]);
  const [current, setCurrent] = useState(undefined);
  const [editing, setEditing] = useState(undefined);
  const [draft, setDraft] = useState("");
  const load = async () => {
    const [all, st] = await Promise.all([api.listSessions(), api.command({ type: "get_state" })]);
    setList((all ?? []).filter((s) => s.cwd === project));
    setCurrent(st.data?.sessionFile);
  };
  useEffect(() => { if (!busy) load(); }, [project, busy, tick]);
  useEffect(() => api.onTitlesUpdated(load), [project]);
  const keys = useMenuKeys(open && !editing, setOpen);
  const close = () => { setOpen(false); setEditing(undefined); };
  const cur = list.find((s) => s.path === current);
  const label = cur ? sessionTitle(cur) : "New conversation";
  async function rename(s) {
    if (draft.trim() && draft.trim() !== sessionTitle(s)) await api.renameSession(s.path, draft);
    setEditing(undefined);
  }
  async function remove(s) {
    if (!(await api.deleteSession(s.path)).ok) return;
    if (s.path === current) await onNew();
    await load();
  }
  return (
    <span className="menu-wrap conversation-menu" {...keys}>
      <button className={`btn small conversation-btn ${open ? "pressed" : ""}`} disabled={busy} onClick={async () => { if (!open) await load(); setOpen(!open); }}
        title={busy ? "Wait until the agent is done" : "The conversations in this project"}>
        <ChatIcon /> <span className="split-label">{label}</span> <Caret />
      </button>
      {open && (
        <div className="menu conversations" tabIndex={-1} onMouseLeave={() => { if (!editing) close(); }}>
          <button className="menu-strong menu-icon-row" onClick={() => { close(); onNew(); }}>
            <ChatIcon /> <span className="grow">New Conversation</span> <Shortcut k={MAC ? "Cmd+Ctrl+N" : "Ctrl+Alt+Shift+N"} />
          </button>
          <div className="menu-sep" />
          <div className="menu-head">Conversations in {project.split(/[\\/]/).pop()}</div>
          {list.length === 0 && <div className="menu-empty">No conversations yet.</div>}
          {list.map((s) => (
            <div key={s.path} className={`conv-row ${s.path === current ? "current" : ""}`}>
              {editing === s.path ? (
                <input className="input-field conv-edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => rename(s)}
                  onKeyDown={(e) => { if (e.key === "Enter") rename(s); if (e.key === "Escape") { e.stopPropagation(); setEditing(undefined); } }} />
              ) : (
                <button className="conv-open" onClick={() => { close(); if (s.path !== current) onOpen(s.path); }}>
                  <span className="history-title">{sessionTitle(s)}</span>
                  <span className="history-sub">{ago(s.modified)} {"\u00b7"} {s.count} message{s.count === 1 ? "" : "s"}{s.path === current ? " \u00b7 open" : ""}</span>
                </button>
              )}
              {editing !== s.path && (
                <span className="conv-actions">
                  <button className="icon-btn" data-tip="Rename" aria-label="Rename" onClick={() => { setDraft(sessionTitle(s)); setEditing(s.path); }}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 14.5V16h1.5l8.6-8.6-1.5-1.5zM15.3 6.2l-1.5-1.5 1.1-1.1a1 1 0 0 1 1.4 0l.1.1a1 1 0 0 1 0 1.4z" /></svg>
                  </button>
                  <button className="icon-btn" data-tip="Delete" aria-label="Delete" onClick={() => remove(s)}>
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 6h10M8 6V4.5h4V6M6.5 6l.7 9.5h5.6l.7-9.5" /></svg>
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

// ---- side panel (right): pinned files and the web preview ----

function GlobeIcon() {
  return (
    <svg className="ficon" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10" cy="10" r="7.5" /><path d="M2.5 10h15M10 2.5c2.2 2.3 3.2 4.8 3.2 7.5s-1 5.2-3.2 7.5c-2.2-2.3-3.2-4.8-3.2-7.5s1-5.2 3.2-7.5z" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg className="ficon" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 3.5h5v5M16.5 3.5 11 9M8.5 16.5h-5v-5M3.5 16.5 9 11" />
    </svg>
  );
}

function SidePanel({ side, width, setWidth, onActivate, onClose, onOpenWeb, fileTick, reloadTick, files, webApp, onAsk, onStartServer }) {
  // Drag the left edge to change the width (240 px to 75% of the window).
  const drag = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let w = startW;
    const move = (ev) => { w = Math.max(240, Math.min(window.innerWidth * 0.75, startW + startX - ev.clientX)); setWidth(w); };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
      try { localStorage.setItem("sideWidth", String(Math.round(w))); } catch { /* No storage. */ }
    };
    document.body.classList.add("resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const id = (t) => (t.type === "web" ? "web" : `file:${t.path}`);
  const active = side.tabs.find((t) => id(t) === side.active) ?? side.tabs[0];
  return (
    <aside className="side-panel" style={{ width }}>
      <div className="side-resize" onMouseDown={drag} title="Drag to change the width" />
      <div className="side-tabs" role="tablist">
        {side.tabs.map((t) => (
          <span key={id(t)} className={`side-tab ${t === active ? "on" : ""}`}>
            <button role="tab" aria-selected={t === active} onClick={() => onActivate(id(t))} title={t.type === "web" ? t.url ?? "Web preview" : t.path}>
              {t.type === "web" ? <GlobeIcon /> : <FileIcon name={t.path} />}
              <span className="side-tab-name">{t.type === "web" ? "Preview" : t.path.split("/").pop()}</span>
            </button>
            <button className="side-tab-close" onClick={() => onClose(id(t))} aria-label="Close" title="Close">&times;</button>
          </span>
        ))}
      </div>
      <div className="side-body">
        {active?.type === "file" && <FilePane key={active.path} path={active.path} tick={fileTick} onAsk={onAsk} onPreview={onOpenWeb} />}
        {/* The web preview stays mounted (hidden) when another tab is on, so the page keeps its state. */}
        {side.tabs.some((t) => t.type === "web") && (
          <WebPane hidden={active?.type !== "web"} tab={side.tabs.find((t) => t.type === "web")} reloadTick={reloadTick} webApp={webApp} onOpen={onOpenWeb} onStartServer={onStartServer} />
        )}
      </div>
    </aside>
  );
}

// A pinned file: the whole text with line numbers, or the image. It reads the file again after each change.
function FilePane({ path, tick, onAsk, onPreview }) {
  const [f, setF] = useState(undefined);
  useEffect(() => { api.fileRead(path).then(setF); }, [path, tick]);
  const ext = path.split(".").pop().toLowerCase();
  return (
    <div className="file-pane">
      <div className="pane-bar">
        <span className="pane-path" title={path}><bdi>{path}</bdi></span>
        <button className="btn small" onClick={() => onAsk(path)}>Add to chat</button>
        {/^html?$/.test(ext) && <button className="btn small" onClick={async () => { const u = await api.fileUrl(path); if (u) onPreview(u); }}>Preview</button>}
        <button className="btn small" onClick={() => api.openPath(path)}>{OPEN_IN[ext] ? `Open in ${OPEN_IN[ext]}` : "Open"}</button>
      </div>
      {f?.error && <p className="error pad">{f.error}</p>}
      {f?.image && <div className="pane-image"><img src={f.image} alt={path} /></div>}
      {(f?.binary || f?.big) && <p className="muted pad">{f.big ? "This file is too large to show." : "This file is not text."} Click {OPEN_IN[ext] ? `"Open in ${OPEN_IN[ext]}"` : "\"Open\""}.</p>}
      {f?.text !== undefined && (
        <div className="diff-view pane-text" tabIndex={0}>
          {f.text.split("\n").map((line, i) => <div key={i} className="dl ctx"><span className="ln">{i + 1}</span><span className="dt">{line}</span></div>)}
        </div>
      )}
    </div>
  );
}

// "3000" -> http://localhost:3000, "localhost:5173/x" -> http://localhost:5173/x. A file path stays (the caller makes a file URL).
function previewUrl(input) {
  const t = input.trim();
  if (/^\d{2,5}$/.test(t)) return `http://localhost:${t}`;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(t)) return `http://${t}`;
  return t;
}

// The web preview: an embedded browser for a local server or a project HTML file. It reloads after each agent turn.
function WebPane({ hidden, tab, reloadTick, webApp, onOpen, onStartServer }) {
  const view = useRef(null);
  const [address, setAddress] = useState(tab?.url ?? "");
  const [failed, setFailed] = useState(undefined);
  const url = tab?.url;
  useEffect(() => { setAddress(url ?? ""); setFailed(undefined); }, [url, tab?.at]);
  useEffect(() => { if (url && reloadTick) { setFailed(undefined); view.current?.reload?.(); } }, [reloadTick]);
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const nav = (e) => { setAddress(e.url); setFailed(undefined); };
    const fail = (e) => { if (e.errorCode !== -3 && e.isMainFrame !== false) setFailed(e.errorDescription || "The page did not load."); };
    v.addEventListener("did-navigate", nav);
    v.addEventListener("did-navigate-in-page", nav);
    v.addEventListener("did-fail-load", fail);
    return () => { v.removeEventListener("did-navigate", nav); v.removeEventListener("did-navigate-in-page", nav); v.removeEventListener("did-fail-load", fail); };
  }, [url]);
  // Only this project: a local server (localhost) or a file in the project. Other sites open in the browser.
  async function go(input) {
    let u = previewUrl(input);
    if (/^https?:/i.test(u) && !isLocalUrl(u)) return setFailed("The preview shows only this project: a local server (localhost) or a project file. Open other sites in the browser.");
    if (!/^(https?|file):/i.test(u)) u = await api.fileUrl(u);
    if (u) onOpen(u); else setFailed(`There is no file ${input} in the project.`);
  }
  const server = webApp?.server;
  return (
    <div className="web-pane" hidden={hidden}>
      <div className="pane-bar">
        <button className="icon-btn" onClick={() => view.current?.goBack?.()} aria-label="Back" title="Back">&larr;</button>
        <button className="icon-btn" onClick={() => view.current?.goForward?.()} aria-label="Forward" title="Forward">&rarr;</button>
        <button className="icon-btn" onClick={() => { setFailed(undefined); view.current?.reload?.(); }} aria-label="Reload" title="Reload">&#x21bb;</button>
        <input className="input-field pane-address" value={address} placeholder={webApp?.server ? `localhost:${webApp.server.port}` : webApp?.pages?.[0] ?? "A project file"} spellCheck={false}
          onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(address); }} />
        {url && <button className="btn small" onClick={() => view.current?.openDevTools?.()} title="Developer tools for the page">Tools</button>}
        {url && /^https?:/.test(url) && <button className="btn small" onClick={() => api.openExternal(address || url)} title="Open in the browser">Browser</button>}
      </div>
      {url ? (
        <div className="web-frame">
          <webview ref={view} src={url} partition="persist:catai-preview" />
          {failed && (
            <div className="web-failed">
              <strong>The page did not load.</strong>
              <span>{failed}</span>
              <span>If it is a local server, start it first (or ask the agent to start it), then click Reload.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="web-start">
          {server ? <>
            <p>This project is a {server.tool} app. Start it to see it here, next to the chat.</p>
            <div className="web-picks">
              <button className="btn small primary" onClick={() => onStartServer?.(server)} title="The agent starts the app. It asks you first.">Start <code>{server.command}</code></button>
              <button className="btn small" onClick={() => go(String(server.port))} title="If the app runs now"><GlobeIcon /> localhost:{server.port}</button>
            </div>
          </> : webApp?.pages?.length ? <>
            <p>Show a web page of this project, next to the chat:</p>
            <div className="web-picks">
              {webApp.pages.map((f) => <button key={f} className="btn small" onClick={() => go(f)}><FileIcon name={f} /> {f}</button>)}
            </div>
          </> : <p>This project has no web pages to preview.</p>}
          <p className="muted small">The preview reloads each time the agent is done.</p>
        </div>
      )}
    </div>
  );
}

// The small button that opens a recent item in a new window.
function NewWindowButton({ onClick }) {
  return (
    <button className="icon-btn new-window-btn" onClick={onClick} aria-label="Open in a new window" data-tip="Open in a new window">
      <WindowIcon />
    </button>
  );
}

function WindowIcon() {
  return (
    <svg className="ficon window-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="4" width="17" height="14" rx="2" fill="#fff" stroke="#002f87" strokeWidth="1.6" />
      <path d="M2 8h17" stroke="#002f87" strokeWidth="1.6" />
      <circle cx="4.6" cy="6" r=".7" fill="#002f87" /><circle cx="6.8" cy="6" r=".7" fill="#002f87" />
      <circle cx="18.5" cy="17.5" r="5" fill="#d4a017" />
      <path d="M18.5 15v5M16 17.5h5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function HistoryRow({ icon, title, sub, current, onClick, hint }) {
  return (
    <button className={`history-row ${current ? "current" : ""}`} onClick={onClick} title={hint}>
      <span className={`history-icon is-${icon}`}><KindIcon kind={icon} open={false} /></span>
      <span className="history-text">
        <span className="history-title">{title}</span>
        <span className="history-sub">{sub}</span>
      </span>
    </button>
  );
}

// The session button (upper right): "Chat: <name>", "Project: <name>", or "Advising".
// The menu: New Chat, New Project..., Advising, the five last chats and projects, and all of the history.
const KIND_NAMES = { chat: "Chat", project: "Project", advising: "Advising", classes: "Classes", class: "Class" };

function KindIcon({ kind, open }) {
  if (kind === "chat") return <ChatIcon />;
  if (kind === "advising") return <AdvisingIcon />;
  if (kind === "classes" || kind === "class") return <ClassIcon />;
  return <FolderIcon open={open} />;
}

// A book: Classes and class chats.
function ClassIcon() {
  return (
    <svg className="ficon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 5.5C5.5 4 8.5 4 12 6c3.5-2 6.5-2 9-.5V19c-2.5-1.5-5.5-1.5-9 .5-3.5-2-6.5-2-9-.5z" fill="#002f87" />
      <path d="M12 6v13.5" stroke="#d4a017" strokeWidth="1.6" />
      <path d="M5.5 8.5c1.6-.6 3.3-.5 4.8.2M5.5 11.5c1.6-.6 3.3-.5 4.8.2M13.7 8.7c1.5-.7 3.2-.8 4.8-.2" stroke="#fff" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function AdvisingIcon() {
  return (
    <svg className="ficon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 1.5 8 12 13l10.5-5z" fill="#002f87" />
      <path d="M5.5 10.5V15c0 1.8 3 3.5 6.5 3.5s6.5-1.7 6.5-3.5v-4.5L12 13.6z" fill="#d4a017" />
      <path d="M21.5 8.5V14" stroke="#002f87" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// Keyboard shortcuts as the menu bar shows them (main.js buildMenu).
const MAC = navigator.userAgent.includes("Mac");
const keyText = (k) => (MAC ? k.replace("Ctrl+", "\u2303").replace("Alt+", "\u2325").replace("Shift+", "\u21e7").replace("Cmd+", "\u2318") : k.replace("Cmd+", "Ctrl+"));
const Shortcut = ({ k }) => <kbd className="shortcut">{keyText(k)}</kbd>;

// ---- Classes (classes.ts): the overview session and the class chats ----

const CLASSES_TASKS = [
  ["This week", "What is due this week in all my classes? Make me a plan for the week."],
  ["My grades", "Show my grade so far in each class. Which class needs the most attention?"],
  ["Important dates", "What are the important dates this term, for example the last day to withdraw?"],
  ["Late work", "Do I have late work? What should I do about it?"],
];
const CLASS_TASKS = [
  ["What is due next?", "What is due next in this class, and what do I need to do for it?"],
  ["My grade", "What is my grade so far in this class, by category?"],
  ["This week's topic", "Explain this week's topic from the lecture notes. Start simple."],
  ["Practice", "Give me three practice questions on this week's topic, one at a time."],
];

// "in 3 days", "today", "2 days late".
const dueText = (d) => (d === 0 ? "today" : d === 1 ? "tomorrow" : d > 1 ? `in ${d} days` : d === -1 ? "1 day late" : `${-d} days late`);

// The left panel. Overview: the classes (a click opens the class chat) and tasks. Class chat: the class,
// its tasks, the linked project, and a link back to all classes.
function ClassesPanel({ kind, busy, onAsk, onClass, onOpenProject, onLink, tick }) {
  const [data, setData] = useState(undefined);
  useEffect(() => { api.classInfo().then(setData); }, [kind, tick]);
  if (!data) return <aside className="tree advising-tasks" />;
  const me = data.classes.find((c) => c.code === data.code);
  const tasks = kind === "class" ? CLASS_TASKS : CLASSES_TASKS;
  return (
    <aside className="tree advising-tasks classes-panel">
      {kind === "class" && me ? (
        <div className="class-card current">
          <button className="link-btn" onClick={() => onClass()} disabled={busy}>&larr; All classes</button>
          <div className="class-code">{me.code}</div>
          <div className="class-title">{me.title}</div>
          <div className="class-meta">{me.instructor}<br />{me.meets} {"\u00b7"} {me.room}</div>
          <div className="class-grade">Grade so far: <strong>{me.grade}% ({me.letter})</strong></div>
        </div>
      ) : (
        <>
          <div className="tree-head"><span className="small muted">My classes {"\u00b7"} {data.term.name}</span></div>
          <div className="class-list">
            {data.classes.map((c) => (
              <button key={c.code} className="class-card" disabled={busy} onClick={() => onClass(c.code)} title={`Open the ${c.code} chat`}>
                <span className="class-row"><span className="class-code">{c.code}</span><span className="class-letter">{c.letter}</span></span>
                <span className="class-title">{c.title}</span>
                {c.next && <span className={`class-next ${c.next.in_days < 0 ? "late" : c.next.in_days <= 2 ? "soon" : ""}`}>{c.next.name} {"\u00b7"} {dueText(c.next.in_days)}</span>}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="tree-head"><span className="small muted">Tasks</span></div>
      <div className="tree-body">
        {tasks.map(([title, q]) => (
          <button key={title} className="advising-task" disabled={busy} onClick={() => onAsk(q)} title={busy ? "Wait until the agent is done" : q}>
            <strong>{title}</strong>
            <span>{q}</span>
          </button>
        ))}
      </div>
      {kind === "class" && (
        <div className="class-project">
          <div className="small muted">Project for this class</div>
          {data.link ? (
            <>
              <button className="btn small class-project-open" onClick={() => onOpenProject(data.link)} title={data.link}>
                <FolderIcon open={false} /> <span className="split-label">{data.link.split(/[\\/]/).pop()}</span>
              </button>
              <span className="class-project-actions">
                <button className="link-btn" onClick={() => api.openInWindow(data.link)}>New window</button>
                <button className="link-btn" onClick={onLink}>Change...</button>
                <button className="link-btn" onClick={async () => { await api.linkClassProject(null); api.classInfo().then(setData); }}>Unlink</button>
              </span>
            </>
          ) : (
            <button className="btn small" onClick={onLink}><FolderIcon open={false} /> Link a project...</button>
          )}
        </div>
      )}
      <p className="demo-note pad"><span className="demo-badge">Demo</span> Mock class data.</p>
    </aside>
  );
}

// The start screen of Classes and of a class chat. Overview: the work due soon and the next term date.
function ClassesIntro({ kind, code }) {
  const [data, setData] = useState(undefined);
  useEffect(() => { api.classInfo().then(setData); }, [kind, code]);
  const me = data?.classes.find((c) => c.code === code);
  return (
    <div className="empty advising-intro">
      <ClassIcon />
      <h2>{kind === "class" ? `${code}${me ? `: ${me.title}` : ""}` : "My Classes"}</h2>
      <p>{kind === "class"
        ? "Ask about assignments, your grade, the syllabus, or the lecture notes. The helper explains and gives hints. It does not do graded work for you."
        : "See what is due, your grades, and the important dates in all your classes. Pick a class on the left to open its chat."}</p>
      {kind === "classes" && data && (
        <div className="due-list">
          <div className="due-head">Due in the next two weeks</div>
          {data.upcoming.work.slice(0, 7).map((w) => (
            <div key={`${w.course}-${w.name}`} className={`due-row ${w.in_days < 0 ? "late" : w.in_days <= 2 ? "soon" : ""}`}>
              <span className="due-course">{w.course}</span>
              <span className="due-name">{w.name}</span>
              <span className="due-when">{dueText(w.in_days)}</span>
            </div>
          ))}
          {data.upcoming.term_dates[0] && (
            <div className="due-term"><strong>{data.upcoming.term_dates[0].what.replace(/ \(mock\)$/, "")}</strong> {"\u00b7"} {dueText(data.upcoming.term_dates[0].in_days)}</div>
          )}
        </div>
      )}
      <p className="demo-note"><span className="demo-badge">Demo</span> The classes, grades, and dates are mock data.</p>
    </div>
  );
}

// The start screen of the advising session: what the advisor can do, and example questions. A click sends one.
const ADVISING_EXAMPLES = [
  ["Plan next semester", "What classes should I take next semester? I want to graduate on time."],
  ["Check my progress", "How far am I from my degree? Show what is done and what is left."],
  ["Review my transcript", "Show my transcript and my GPA. Which grades are a problem?"],
  ["Map out graduation", "Make a plan for each semester until I graduate."],
  ["Send my plan", "Send my plan for next semester to my advisor for approval."],
];

// The left panel of the advising view: the advising tasks. A click sends the task. It is always there.
function AdvisingTasks({ busy, onAsk }) {
  return (
    <aside className="tree advising-tasks">
      <div className="tree-head"><span className="small muted">Advising tasks</span></div>
      <div className="tree-body">
        {ADVISING_EXAMPLES.map(([title, q]) => (
          <button key={title} className="advising-task" disabled={busy} onClick={() => onAsk(q)} title={busy ? "Wait until the advisor is done" : q}>
            <strong>{title}</strong>
            <span>{q}</span>
          </button>
        ))}
      </div>
      <p className="demo-note pad"><span className="demo-badge">Demo</span> Mock student data.</p>
    </aside>
  );
}

function AdvisingIntro() {
  return (
    <div className="empty advising-intro">
      <AdvisingIcon />
      <h2>Academic Advising</h2>
      <p>Plan your classes and check your progress toward your degree. The advisor reads your transcript, your major
        requirements, and next semester's classes.</p>
      <p>Pick a task on the left, or ask a question below.</p>
      <p className="demo-note"><span className="demo-badge">Demo</span> The student record and the class list are mock data. For official decisions, talk to your advisor.</p>
    </div>
  );
}

// A new chat: the eight last chats, projects, and the advising session as buttons at the top. A click opens one
// (Cmd+click: in a new window). When the chat starts, the buttons fade away.
function RecentStrip({ hide, current, onOpen, onOpenNew }) {
  const [list, setList] = useState([]);
  const [gone, setGone] = useState(hide);
  useEffect(() => { api.listSessions().then((all) => setList(recentItems((all ?? []).filter((s) => s.cwd !== current && s.exists), 8))); }, [current]);
  useEffect(() => api.onTitlesUpdated(() => api.listSessions().then((all) => setList(recentItems((all ?? []).filter((s) => s.cwd !== current && s.exists), 8)))), [current]);
  useEffect(() => {
    if (!hide) return setGone(false);
    const t = setTimeout(() => setGone(true), 450);
    return () => clearTimeout(t);
  }, [hide]);
  if (gone || list.length === 0) return null;
  return (
    <div className={`recent-strip ${hide ? "fading" : ""}`}>
      <div className="recent-strip-head">Continue where you left off</div>
      <div className="recent-strip-items">
        {list.map((s) => (
          <button key={s.path} className={`recent-chip kind-${s.kind}`} title={`${sessionSub(s)}\n${MAC ? "\u2318" : "Ctrl+"}click: open in a new window`}
            onClick={(e) => ((e.metaKey || e.ctrlKey) ? onOpenNew(s) : onOpen(s))}>
            <KindIcon kind={s.kind} open={false} />
            <span className="recent-chip-text">
              <span className="recent-chip-title">{sessionTitle2(s)}</span>
              <span className="recent-chip-sub">{KIND_NAMES[s.kind]} {"\u00b7"} {ago(s.modified)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// The session menu: the new items (with their shortcuts) on the left, the five last chats and projects on the right.
function SessionMenu({ info, name, busy, onNewChat, onNewProject, onNewChatHere, onAdvising, onClasses, onOpen, onAllProjects, onHistory }) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState([]);
  // Qwen makes the titles in the background. Read the list again when new titles are there.
  useEffect(() => api.onTitlesUpdated(() => { if (open) api.listSessions().then(setSessions); }), [open]);
  async function toggle() {
    if (!open) setSessions(await api.listSessions());
    setOpen(!open);
  }
  const close = () => setOpen(false);
  const keys = useMenuKeys(open, setOpen);
  const kind = info.kind ?? (info.chat ? "chat" : "project");
  const projectName = info.project?.split(/[\\/]/).pop();
  const label = kind === "advising" ? "Advising" : kind === "classes" ? "Classes" : kind === "class" ? `Class: ${projectName}`
    : `${KIND_NAMES[kind]}: ${kind === "project" ? projectName : name ?? "New chat"}`;
  const recent = recentItems(sessions, 5);
  const item = (icon, text, k, onClick, cls = "") => (
    <button className={`menu-icon-row ${cls}`} onClick={() => { close(); onClick(); }}>
      {icon} <span className="grow">{text}</span> {k && <Shortcut k={k} />}
    </button>
  );
  return (
    <span className="menu-wrap session-menu" {...keys}>
      <button className={`btn session-btn kind-${kind} ${open ? "pressed" : ""}`} onClick={toggle} disabled={busy}
        title={busy ? "Wait until the agent is done" : info.project}>
        <KindIcon kind={kind} open /> <span className="split-label">{label}</span> <Caret />
      </button>
      {open && (
        <div className="menu session" tabIndex={-1} onMouseLeave={close}>
          <div className="session-col">
            {item(<ChatIcon />, "New Chat", "Cmd+N", onNewChat, "menu-strong")}
            {item(<FolderIcon open={false} />, "New Project...", "Cmd+Shift+N", onNewProject, "menu-strong")}
            {item(<AdvisingIcon />, "Advising", "Cmd+Shift+A", onAdvising, `menu-strong ${kind === "advising" ? "current" : ""}`)}
            {item(<ClassIcon />, "Classes", "Cmd+Shift+C", onClasses, `menu-strong ${kind === "classes" || kind === "class" ? "current" : ""}`)}
            <div className="menu-sep" />
            {item(<WindowIcon />, "New Window", "Cmd+Alt+N", () => api.openInWindow(), "menu-strong")}
          </div>
          <div className="session-col recent">
            <div className="menu-head">Recent</div>
            {recent.length === 0 && <div className="menu-empty">No chats or projects yet.</div>}
            {recent.map((s) => (
              <div key={s.path} className="row-with-action">
                <HistoryRow icon={s.kind} title={sessionTitle(s)} sub={sessionSub(s)}
                  current={s.cwd === info.project} hint={`${s.kind === "project" ? s.cwd : "Chat"}\n${MAC ? "\u2318" : "Ctrl+"}click: open in a new window`}
                  onClick={(e) => { close(); if (e.metaKey || e.ctrlKey) api.openInWindow(s.cwd, s.path); else onOpen(s); }} />
                <NewWindowButton onClick={() => { close(); api.openInWindow(s.cwd, s.path); }} />
              </div>
            ))}
            <div className="menu-sep" />
            {item(<span className="ficon-pad" />, "Show All History...", "Cmd+Y", onHistory)}
          </div>
        </div>
      )}
    </span>
  );
}

// The last chats, projects, and the advising session, newest first.
function recentItems(sessions, max) {
  const out = [];
  for (const s of sessions ?? []) {
    if (out.length === max) break;
    // A project and the advising session show once (their last chat).
    if (s.kind !== "chat" && out.some((r) => r.kind === s.kind && r.cwd === s.cwd)) continue;
    out.push(s);
  }
  return out;
}
const sessionTitle = (s) => (s.kind === "advising" ? "Academic advising" : s.kind === "classes" ? "My classes" : s.kind === "class" ? s.projectName
  : s.title ?? shortText(s.name ?? s.first));
const sessionTitle2 = (s) => (s.kind === "project" ? s.projectName : sessionTitle(s));
const sessionSub = (s) => `${s.kind === "project" ? `Project ${s.projectName}` : KIND_NAMES[s.kind] ?? "Chat"} \u00b7 ${ago(s.modified)}`;

// "History": a window with all chats and projects. A search, and a filter for the type (all, chats, projects, advising).
// Up and Down move, Enter opens, Escape closes.
function HistoryWindow({ info, onClose, onOpen, onDeleted }) {
  const [sessions, setSessions] = useState(undefined);
  const [err, setErr] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [sel, setSel] = useState(0);
  useEffect(() => { api.listSessions().then(setSessions); }, []);
  useEffect(() => api.onTitlesUpdated(() => api.listSessions().then(setSessions)), []);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (sessions ?? [])
    .filter((s) => type === "all" || s.kind === type || (type === "class" && s.kind === "classes"))
    .filter((s) => words.every((w) => `${sessionTitle(s)} ${s.projectName ?? ""} ${s.first ?? ""}`.toLowerCase().includes(w)));
  useEffect(() => setSel(0), [query, type]);
  useEffect(() => { document.querySelector(".history-list .history-row.selected")?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const openNew = (s) => { onClose(); api.openInWindow(s.cwd, s.path); };
  const onKey = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && shown[sel]?.exists) { e.preventDefault(); return openNew(shown[sel]); }
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && shown[sel]?.exists) { e.preventDefault(); onOpen(shown[sel]); }
  };
  const TYPES = [["all", "All"], ["chat", "Chats"], ["project", "Projects"], ["class", "Classes"], ["advising", "Advising"]];
  return (
    <div className="overlay" onKeyDown={onKey}>
      <div className="window history-window" role="dialog" aria-modal="true" aria-label="History">
        <div className="window-title"><img src={logo} alt="" /><span>History</span></div>
        <div className="history-tools">
          <input className="input-field" type="search" autoFocus placeholder="Search chats and projects" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="segmented" role="radiogroup" aria-label="Type">
            {TYPES.map(([k, t]) => (
              <button key={k} role="radio" aria-checked={type === k} className={type === k ? "on" : ""} onClick={() => setType(k)}>{t}</button>
            ))}
          </div>
        </div>
        <div className="history-list">
          {sessions === undefined && <div className="list-empty">Loading...</div>}
          {sessions && shown.length === 0 && <div className="list-empty">Nothing matches.</div>}
          {shown.map((s, i) => {
            const day = dayName(s.modified);
            const head = i === 0 || dayName(shown[i - 1].modified) !== day;
            return (
              <div key={s.path} className="row-with-action">
                {head && <div className="menu-head">{day}</div>}
                <button className="icon-btn history-delete" data-tip="Delete" aria-label="Delete" onClick={async () => {
                  const r = await api.deleteSession(s.path);
                  setErr(r.error ?? "");
                  if (r.ok) { setSessions(await api.listSessions()); onDeleted(s.path); }
                }}>
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4.5h4V6M6 6l.8 10h6.4L14 6" /></svg>
                </button>
                <button className={`history-row ${i === sel ? "selected" : ""} ${s.cwd === info.project ? "current" : ""}`} disabled={!s.exists}
                  title={s.exists ? s.cwd : `${s.cwd} does not exist now`} onMouseEnter={() => setSel(i)} onClick={() => onOpen(s)}>
                  <span className={`history-icon is-${s.kind}`}><KindIcon kind={s.kind} open={false} /></span>
                  <span className="history-text">
                    <span className="history-title">{sessionTitle(s)}</span>
                    <span className="history-sub">{sessionSub(s)}</span>
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="window-buttons">
          <span className="picker-target">{err ? <span className="error">{err}</span> : sessions ? `${shown.length} of ${sessions.length}` : ""}</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn" disabled={!shown[sel]?.exists} onClick={() => openNew(shown[sel])} title={`${MAC ? "\u2318" : "Ctrl+"}Enter`}>Open in New Window</button>
          <button className="btn primary default" disabled={!shown[sel]?.exists} onClick={() => onOpen(shown[sel])}>Open</button>
        </div>
      </div>
    </div>
  );
}

// "Link a project to <class>": a search over the existing projects, and "Browse..." for any folder.
// Up and Down move, Enter links, Escape closes.
function LinkProject({ code, onPick, onCancel }) {
  const [projects, setProjects] = useState(undefined);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [browsing, setBrowsing] = useState(false);
  useEffect(() => { api.listProjects().then((p) => setProjects(p ?? []), () => setProjects([])); }, []);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  // A project with the course code in its name or path comes first.
  const key = (code ?? "").replace(/\s+/g, "").toLowerCase();
  const match = (p) => key && `${p.name}${p.path}`.replace(/[\s_-]+/g, "").toLowerCase().includes(key);
  const shown = (projects ?? [])
    .filter((p) => words.every((w) => `${p.name} ${p.display ?? p.path}`.toLowerCase().includes(w)))
    .sort((a, b) => Number(!!match(b)) - Number(!!match(a)));
  useEffect(() => setSel(0), [query]);
  useEffect(() => { document.querySelector(".link-list .list-row.selected")?.scrollIntoView({ block: "nearest" }); }, [sel]);
  if (browsing) return <FolderPicker title={`Select A Folder For ${code}`} action="Link Project" onCancel={() => setBrowsing(false)} onPick={onPick} />;
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter" && shown[sel]) { e.preventDefault(); onPick(shown[sel].path); }
  };
  return (
    <div className="overlay" onKeyDown={onKey}>
      <div className="window history-window link-window" role="dialog" aria-modal="true" aria-label={`Link a project to ${code}`}>
        <div className="window-title"><img src={logo} alt="" /><span>Link a Project to {code}</span></div>
        <div className="history-tools">
          <input className="input-field" type="search" autoFocus placeholder="Search your projects by name or location" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="history-list link-list">
          {projects === undefined && <div className="list-empty">Loading...</div>}
          {projects && shown.length === 0 && <div className="list-empty">{projects.length ? "No project matches." : "No projects yet. Click \"Browse...\" to pick a folder."}</div>}
          {shown.map((p, i) => (
            <div key={p.path} className={`list-row ${i === sel ? "selected" : ""}`} title={p.path} onMouseEnter={() => setSel(i)} onClick={() => setSel(i)} onDoubleClick={() => onPick(p.path)}>
              <span className="col-name"><FolderIcon open={false} /> {p.name}{match(p) && <span className="match-badge">{code}</span>}</span>
              <span className="col-path"><bdi>{p.display ?? p.path}</bdi></span>
              <span className="col-when">{ago(p.modified)}</span>
            </div>
          ))}
        </div>
        <div className="window-buttons">
          <button className="btn" onClick={() => setBrowsing(true)}>Browse...</button>
          <span className="spacer" />
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary default" disabled={!shown[sel]} onClick={() => onPick(shown[sel].path)}>Link Project</button>
        </div>
      </div>
    </div>
  );
}

// "Select a folder for your project": a folder picker in the app. Places on the left, folders on the right,
// "New Folder" to make one. It starts in Documents/catai.
function FolderPicker({ onPick, onCancel, title = "Select A Folder For Your Project", action = "Open Project" }) {
  const [dir, setDir] = useState(undefined);
  const [selected, setSelected] = useState(undefined);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const go = async (path) => { setSelected(undefined); setError(""); setDir(await api.listFolders(path)); };
  useEffect(() => { go(undefined); }, []);
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!dir) return null;
  const join = (a, b) => `${a.replace(/[\\/]$/, "")}${dir.sep}${b}`;
  const target = selected ? join(dir.path, selected) : dir.path;
  // A place (Documents, Home, catai projects) is not a good project folder. Select or make a folder in it.
  const isPlace = !selected && dir.places.some((p) => p.path === dir.path);
  const crumbs = dir.path.split(/[\\/]/).filter(Boolean);
  async function makeFolder() {
    const r = await api.makeFolder(dir.path, name);
    if (r.error) return setError(r.error);
    setNaming(false);
    setName("");
    await go(dir.path);
    setSelected(r.path.split(/[\\/]/).pop());
  }
  return (
    <div className="overlay">
      <div className="window picker" role="dialog" aria-modal="true" aria-label={title}>
        <div className="window-title"><img src={logo} alt="" /><span>{title}</span></div>
        <div className="picker-body">
          <nav className="picker-places">
            {dir.places.map((p) => (
              <button key={p.path} className={dir.path === p.path ? "current" : ""} onClick={() => go(p.path)}><FolderIcon open={dir.path === p.path} /> {p.name}</button>
            ))}
          </nav>
          <div className="picker-main">
            <div className="picker-crumbs">
              {dir.parent && <button className="icon-btn" onClick={() => go(dir.parent)} title="Up one folder" aria-label="Up one folder">↑</button>}
              <span className="crumbs"><bdi>{crumbs.slice(-3).join(` ${dir.sep} `)}</bdi></span>
            </div>
            <div className="listbox picker-list">
              {dir.folders.length === 0 && <div className="list-empty">No folders here. Click "New Folder" to make one.</div>}
              {dir.folders.map((f) => (
                <div key={f} className={`list-row folder-row ${f === selected ? "selected" : ""}`} onClick={() => setSelected(f)} onDoubleClick={() => go(join(dir.path, f))}>
                  <span className="col-name"><FolderIcon open={false} /> {f}</span>
                </div>
              ))}
            </div>
            {naming && (
              <div className="new-folder">
                <input className="input-field" autoFocus value={name} placeholder="Folder name, for example Semester Plan" onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") makeFolder(); if (e.key === "Escape") { e.stopPropagation(); setNaming(false); } }} />
                <button className="btn" onClick={makeFolder}>Make</button>
              </div>
            )}
            {error && <p className="error">{error}</p>}
          </div>
        </div>
        <div className="window-buttons">
          <button className="btn" onClick={() => setNaming(true)}>New Folder</button>
          <span className="picker-target" title={target}>{isPlace ? "Select a folder, or make a new one." : <>Project folder: <bdi>{target.split(/[\\/]/).pop()}</bdi></>}</span>
          <span className="spacer" />
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary default" onClick={() => onPick(target)} disabled={isPlace}>{action}</button>
        </div>
      </div>
    </div>
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
        <span className="btn-label">Mode</span> {state.mode}{state.ta ? " + ta" : ""}{state.sandbox ? "" : " (no sandbox)"} <Caret />
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

// One button for the model and the permissions: "Qwen3.8-27B · ask ▾". The menu opens upward.
// "Permissions" is the app name for the catatui modes (ask, plan, yolo). The CLI command is still /mode.
const THINKING_NOTES = {
  off: "No thinking. The fastest answers.",
  minimal: "Very little thinking.",
  low: "Short thinking. Fast.",
  medium: "The default.",
  high: "Thinks longer. Slower, better for hard problems.",
  xhigh: "Thinks very long.",
  max: "The most thinking.",
};

function AgentMenu({ model, busy, onPick, state, onCommand, thinking, onThinking }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState([]);
  async function toggle() {
    if (!open) {
      const r = await api.command({ type: "get_available_models" });
      setModels(r.success ? sortModels(r.data.models) : []);
    }
    setOpen(!open);
  }
  const perm = state?.mode ?? "ask";
  const keys = useMenuKeys(open, setOpen);
  return (
    <span className="menu-wrap agent-menu" {...keys}>
      <button className={`btn mode-${perm} ${open ? "pressed" : ""}`} onClick={toggle} title="Permissions, options, and model">
        <span className="agent-model">{model?.id ?? "No model"}</span>
        <span className="agent-perm">{perm}{state?.ta ? " + ta" : ""}{thinking?.level && thinking.levels.length > 1 && thinking.level !== "medium" ? ` \u00b7 ${thinking.level}` : ""}</span> <Caret />
      </button>
      {open && (
        <div className="menu up agent" tabIndex={-1} onMouseLeave={() => setOpen(false)}>
          {/* Left: permissions and options. They can change while the agent works. */}
          <div className="agent-col">
            {state && (
              <>
                <div className="menu-head">Permissions</div>
                {state.modes.map((m) => (
                  <label key={m} className="menu-row">
                    <input type="radio" name="perm" checked={state.mode === m} onChange={() => onCommand(`/mode ${m}`)} />
                    <span><span className="menu-id">{m}</span><span className="menu-note">{state.help[m]}</span></span>
                  </label>
                ))}
                <div className="menu-head">Options</div>
                {state.flags.map((f) => (
                  <label key={f} className="menu-row">
                    <input type="checkbox" checked={!!state[f]} onChange={(e) => onCommand(`/mode ${f} ${e.target.checked ? "on" : "off"}`)} />
                    <span><span className="menu-id">{OPTION_NAMES[f] ?? f}</span><span className="menu-note">{state.help[f]}</span></span>
                  </label>
                ))}
              </>
            )}
          </div>
          {/* Right: the models, Qwen first. The model cannot change while the agent works. */}
          <div className="agent-col models">
           <div className="models-inner">
            <div className="menu-head">Model{busy ? " (wait until the agent is done)" : ""}</div>
            <div className="model-list">
            {models.map((m) => (
              <label key={`${m.provider}/${m.id}`} className={`menu-row ${busy ? "disabled" : ""}`}>
                <input type="radio" name="model" disabled={busy} checked={m.id === model?.id} onChange={() => onPick(m)} />
                <span><span className="menu-id">{m.id}</span>{m.name && m.name !== m.id && <span className="menu-note">{m.name}</span>}</span>
              </label>
            ))}
            {models.length === 0 && <div className="menu-empty">No models. Check your sign-in.</div>}
            </div>
            {thinking?.levels.length > 1 && (
              <div className="thinking-section">
                    <div className="menu-head">Thinking <span className="menu-head-key">{MAC ? "\u21e7Tab" : "Shift+Tab"}</span></div>
                    <div className="thinking-levels" role="radiogroup" aria-label="Thinking level">
                      {thinking.levels.map((l) => (
                        <button key={l} role="radio" aria-checked={thinking.level === l} className={thinking.level === l ? "on" : ""}
                          title={THINKING_NOTES[l] ?? l} onClick={() => onThinking(l)}>{l}</button>
                      ))}
                    </div>
              </div>
            )}

           </div>
          </div>
        </div>
      )}
    </span>
  );
}

// Qwen first, then the other recommended models, then the rest in the CatChat order.
// The same order as PREFERRED_MODELS in src/catatui/config.ts.
const MODEL_ORDER = [/^qwen/i, /^gpt-oss:120b$/, /^gemma4/i];
function sortModels(models) {
  const rank = (m) => { const i = MODEL_ORDER.findIndex((re) => re.test(m.id)); return i < 0 ? MODEL_ORDER.length : i; };
  return [...models].sort((a, b) => rank(a) - rank(b));
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
        {model?.id ?? "No model"} <Caret />
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
  const keys = useMenuKeys(open, setOpen);
  // GitHub (github.ts): null when not signed in. undefined while it loads.
  const [gh, setGh] = useState(undefined);
  const [ghWindow, setGhWindow] = useState(false);
  useEffect(() => { if (open) api.gitHubState().then(setGh); }, [open]);
  return (
    <span className="menu-wrap" {...keys}>
      <button className={`btn ${open ? "pressed" : ""}`} onClick={() => setOpen(!open)} title={id ? `Signed in to CatChat as ${id}` : "Account"}>
        <svg className="person" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="7" r="4" /><path d="M2.5 18c.8-4 4-6 7.5-6s6.7 2 7.5 6z" /></svg>
        {id ?? "MSU account"} <Caret />
      </button>
      {open && (
        <div className="menu" tabIndex={-1} onMouseLeave={() => setOpen(false)}>
          <div className="menu-head">Signed in to CatChat</div>
          <div className="account-id">{id ?? "MSU account (pasted key)"}</div>
          {expiryDays !== undefined && <div className="menu-note pad-x">The key expires in {expiryDays} days.</div>}
          <button onClick={() => { setOpen(false); onSignOut(); }}>Sign out</button>
          <div className="menu-sep" />
          <div className="menu-head">GitHub</div>
          {gh ? <>
            <div className="account-id">{gh.login}</div>
            {gh.expiryDays !== undefined && <div className="menu-note pad-x">{gh.expiryDays <= 0 ? "The token expired." : `The token expires in ${gh.expiryDays} days.`}</div>}
            {gh.expiryDays !== undefined && gh.expiryDays <= 14 && <button onClick={() => { setOpen(false); setGhWindow(true); }}>New token...</button>}
            <button onClick={async () => { setOpen(false); setGh(await api.gitHubSignOut()); }}>Sign out of GitHub</button>
          </> : gh === null && <>
            <div className="menu-note pad-x">Sign in to push to and pull from GitHub.</div>
            <button onClick={() => { setOpen(false); setGhWindow(true); }}>Sign in to GitHub...</button>
          </>}
        </div>
      )}
      {ghWindow && <GitHubSignIn onDone={(state) => { setGhWindow(false); if (state !== undefined) setGh(state); }} />}
    </span>
  );
}

// The GitHub sign-in: the student makes a token on GitHub (the form is filled in) and pastes it here.
function GitHubSignIn({ onDone }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!token.trim() || busy) return;
    setBusy(true);
    setError("");
    const r = await api.gitHubSignIn(token);
    setBusy(false);
    if (r?.error) setError(r.error); else onDone(r);
  };
  return (
    <div className="overlay" onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { e.preventDefault(); onDone(undefined); } }}>
      <div className="window github-window" role="dialog" aria-modal="true" aria-label="Sign in to GitHub">
        <div className="window-title"><img src={logo} alt="" /><span>Sign In to GitHub</span></div>
        <div className="window-body">
          <p>catai uses a GitHub token to push, pull, and clone your repositories. It uses only this token, not your other GitHub sign-ins or SSH keys.</p>
          <ol>
            <li><button className="btn small" onClick={() => api.gitHubTokenPage()}>Open GitHub</button> The token form opens, filled in for catai.</li>
            <li>Pick an expiry, then click <b>Generate token</b>.</li>
            <li>Copy the token and paste it here.</li>
          </ol>
          <input className="input-field" type="password" autoFocus placeholder="ghp_..." value={token} spellCheck={false}
            onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          {error && <p className="error">{error}</p>}
          <p className="muted small">To remove access later, sign out here, and delete the token on GitHub (Settings, Developer settings, Personal access tokens).</p>
        </div>
        <div className="window-buttons">
          <span className="spacer" />
          <button className="btn" onClick={() => onDone(undefined)}>Cancel</button>
          <button className="btn primary default" onClick={submit} disabled={!token.trim() || busy}>{busy ? "Checking..." : "Sign In"}</button>
        </div>
      </div>
    </div>
  );
}

function Chat({ items, busy, onShowChanges, changed, scrollTick, fileTick, resume, onResume, widgets, onWidgetAnswer, advising, onAsk, kind, project, onOpenSession, onRemove, onPin, onOpenWeb, onOpenView, queued, onUnqueue }) {
  const end = useRef(null);
  const box = useRef(null);
  // Keep the newest text in view, unless the student scrolled up to read.
  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) end.current?.scrollIntoView();
  }, [items]);
  // After a send or after a chat opens, always go to the bottom. Go again after file cards, charts,
  // and widget frames load, because they make the chat taller.
  useEffect(() => {
    if (!scrollTick) return;
    end.current?.scrollIntoView();
    const ts = [150, 500, 1200].map((ms) => setTimeout(() => end.current?.scrollIntoView(), ms));
    return () => ts.forEach(clearTimeout);
  }, [scrollTick]);

  return (
    <main className="chat" ref={box} tabIndex={-1} onKeyDown={(e) => { if (e.key === "Escape") document.querySelector(".composer textarea")?.focus(); }}
      onContextMenu={async (e) => {
        // Selected text: Copy, or Remove from this conversation (each copy).
        const text = window.getSelection()?.toString().trim();
        if (!text || busy) return;
        e.preventDefault();
        if ((await api.chatMenu(text)) === "remove") onRemove({ text });
      }}>
      {kind === "chat" && <RecentStrip hide={items.length > 0} current={project} onOpen={onOpenSession} onOpenNew={(s) => api.openInWindow(s.cwd, s.path)} />}
      {items.length === 0 && advising && <AdvisingIntro />}
      {items.length === 0 && (kind === "classes" || kind === "class") && <ClassesIntro kind={kind} code={project?.split(/[\\/]/).pop()} />}
      {items.length === 0 && !advising && kind !== "classes" && kind !== "class" && (
        <div className="empty brand">
          <img src={logo} alt="" />
          <div className="brand-name">catai</div>
          <div className="brand-tag">{kind === "project" ? `Project ${project?.split(/[\\/]/).pop()}` : "Your AI Agent at Montana State University"}</div>
        </div>
      )}
      {items.map((it, i) => {
        const item = <Item key={i} it={it} onShowChanges={onShowChanges} changed={changed} fileTick={fileTick} widgets={widgets} onWidgetAnswer={onWidgetAnswer}
          onPin={onPin} onRemove={busy ? undefined : onRemove} onOpenWeb={onOpenWeb} onOpenView={busy ? undefined : onOpenView}
          live={busy && i === items.length - 1} />;
        // File cards have their own buttons. A removed message has nothing to remove.
        if (it.kind === "user" && (it.text.startsWith(FILE_PREFIX) || it.text === "[removed]")) return item;
        // "Remove" on a message or a tool call, when the agent is not working.
        const target = it.kind === "tool" ? (it.running ? undefined : { toolCallId: it.id }) : (it.kind === "user" || it.kind === "assistant") && it.ts !== undefined ? { ts: it.ts } : undefined;
        if (!target || busy) return item;
        return (
          <div key={i} className={`removable removable-${it.kind}`}>
            {item}
            <button className="icon-btn remove-btn" data-tip="Remove from this conversation" aria-label="Remove from this conversation" onClick={() => onRemove(target)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4.5h4V6M6 6l.8 10h6.4L14 6M8.5 9v4.5M11.5 9v4.5" /></svg>
            </button>
          </div>
        );
      })}
      {busy && <div className="working">Working<Dots /></div>}
      {queued?.length > 0 && (
        <div className="queued">
          {queued.map((q, i) => <div key={i} className="msg user queued-msg">{q.startsWith(FILE_PREFIX) ? shortText(q) : q}</div>)}
          <div className="queued-note">
            Queued: {queued.length === 1 ? "this message waits" : `these ${queued.length} messages wait`} until the agent is done.
            <button className="link-btn" onClick={onUnqueue}>Edit</button>
          </div>
        </div>
      )}
      <div ref={end} />
    </main>
  );
}

function Item({ it, onShowChanges, changed, fileTick, widgets, onWidgetAnswer, onPin, onRemove, onOpenWeb, onOpenView, live }) {
  // advising_submit_plan: the plan card. It is live while its request waits. After that, the result has the plan and the status.
  if (it.kind === "tool" && it.name === "advising_submit_plan") {
    const req = it.running ? widgets.find((w) => w.title.startsWith(`${WIDGET_PREFIX}{"type":"plan"`)) : undefined;
    let spec;
    let result;
    try { spec = req ? JSON.parse(req.title.slice(WIDGET_PREFIX.length)) : undefined; } catch { /* Not JSON. */ }
    const text = resultText(it.result) ?? "";
    try { result = text.includes("{") ? JSON.parse(text.slice(text.indexOf("{"))) : undefined; } catch { /* Not JSON. */ }
    spec ??= result?.plan;
    // A call that stopped early (for example the app closed) has no plan in the result. Use the arguments.
    if (!spec && Array.isArray(it.args?.terms)) {
      spec = { advisor: "your advisor", message: it.args.message, warnings: [],
        terms: it.args.terms.map((t) => ({ term: t.term, credits: (t.courses ?? []).length * 3, courses: (t.courses ?? []).map((c) => ({ course: c, title: "", credits: 3 })) })) };
      if (!it.running) result ??= { submitted: false };
    }
    if (spec) return <PlanCard spec={spec} result={result} running={it.running} onSubmit={req ? (data) => onWidgetAnswer(req, data) : undefined} />;
  }
  // open_view (views.ts): a card with a button that opens Advising, Classes, or one class chat.
  if (it.kind === "tool" && it.name === "open_view" && it.args?.view && !it.isError) {
    const { view, course, reason } = it.args;
    const title = view === "advising" ? "Advising" : course ? `${course} class chat` : "Classes";
    return (
      <div className={`view-card view-${view}`}>
        {view === "advising" ? <AdvisingIcon /> : <ClassIcon />}
        <span className="view-card-text">
          <strong>{title}</strong>
          {reason && <span>{reason}</span>}
        </span>
        <button className="btn primary" disabled={!onOpenView} onClick={() => onOpenView?.(view, course)}>Open {title}</button>
      </div>
    );
  }
  // show_preview: a card with the page and a button that opens it in the side panel (again).
  if (it.kind === "tool" && it.name === "show_preview" && !it.running && !it.isError) {
    const url = /The preview of (\S+) is open/.exec(resultText(it.result) ?? "")?.[1];
    if (url) {
      return (
        <div className="preview-card">
          <GlobeIcon />
          <span className="preview-card-url" title={url}><bdi>{url.replace(/^file:\/\/.*\//, "")}</bdi></span>
          <button className="btn small" onClick={() => onOpenWeb?.(url)}>Show preview</button>
        </div>
      );
    }
  }
  // show_widget: draw the widget. It is live while its request waits (the same JSON, or the only waiting widget).
  if (it.kind === "tool" && it.name === "show_widget" && it.args?.type) {
    const req = it.running ? (widgets.find((w) => w.title === `${WIDGET_PREFIX}${JSON.stringify(it.args)}`) ?? (widgets.length === 1 ? widgets[0] : undefined)) : undefined;
    return <Widget spec={it.args} answer={widgetAnswer(it.result)} onSubmit={req ? (data) => onWidgetAnswer(req, data) : undefined} />;
  }
  if (it.kind === "user" && it.text.startsWith(FILE_PREFIX)) {
    const paths = it.text.split("\n").filter((l) => l.startsWith(FILE_PREFIX)).map((l) => l.slice(FILE_PREFIX.length));
    // A diff only for a file that git shows as modified (not new or deleted). FileCard also checks that it is text.
    const isModified = (p) => changed?.git && ["M", "R"].includes(changed.status?.[p]);
    return (
      <div className="file-cards">
        {paths.map((p) => <FileCard key={p} path={p} tick={fileTick} onShowChanges={isModified(p) ? () => onShowChanges(p) : undefined}
          onPin={() => onPin(p)} onRemove={it.ts !== undefined && onRemove ? () => onRemove({ ts: it.ts }) : undefined} />)}
      </div>
    );
  }
  if ((it.kind === "user" && it.text === "[removed]") || (it.kind === "assistant" && it.blocks.length && it.blocks.every((b) => b.text === "[removed]"))) {
    return <div className={`msg removed ${it.kind}`}>Removed</div>;
  }
  if (it.kind === "user") return <div className="msg user">{it.text}</div>;
  if (it.kind === "notice") return <pre className={`notice ${it.level}`}>{plain(it.text)}</pre>;
  if (it.kind === "tool") return <Tool it={it} />;
  return (
    <div className="msg assistant">
      {it.blocks.map((b, i) =>
        b.type === "thinking" ? (
          <details key={i} className="thinking"><summary>Thinking{live && i === it.blocks.length - 1 && <Dots />}</summary><div>{b.text}</div></details>
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
function FileCard({ path, tick, onShowChanges, onPin, onRemove }) {
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
        <span className="file-card-tools">
          {onPin && <button className="icon-btn" data-tip="Open in the side panel" aria-label="Open in the side panel" onClick={onPin}><MaximizeIcon /></button>}
          {onRemove && <button className="icon-btn" data-tip="Remove from the chat" aria-label="Remove from the chat" onClick={onRemove}>&times;</button>}
        </span>
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
function Composer({ busy, onSend, onStop, editorText, clearEditorText, canUndo, onUndo, below, context, onCycleThinking }) {
  const [text, setText] = useState("");
  const ref = useRef(null);
  // The suggestion: the rest of the message in gray after the text. Tab accepts it, Escape hides it.
  // It shows only when the cursor is at the end, after a pause of 450 ms in typing. Not for /commands.
  const [hint, setHint] = useState("");
  const ghost = useRef(null);
  useEffect(() => {
    setHint("");
    const el = ref.current;
    if (text.trim().length < 3 || text.startsWith("/") || !el || el.selectionStart !== text.length) return;
    const t = setTimeout(async () => {
      const h = await api.suggest(text, context);
      if (ref.current?.value === text && ref.current.selectionStart === text.length) setHint(h);
    }, 450);
    return () => clearTimeout(t);
  }, [text]);
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
    setHint("");
  };
  return (
    <footer className="composer">
      <div className="composer-left composer-field">
        {/* The gray suggestion: a copy of the text (invisible) and the suggestion, under the text field. */}
        <div className="input-field composer-ghost" ref={ghost} aria-hidden="true">
          <span className="ghost-text">{text}</span><span className="ghost-hint">{hint}</span>
          {hint && <span className="ghost-key">Tab</span>}
        </div>
        <textarea className="input-field" ref={ref} value={text} autoFocus rows={Math.min(8, Math.max(3, (text + hint).split("\n").length))}
          placeholder={busy ? "The agent is working. Your message waits until it is done." : "Ask catai. Enter sends, Shift+Enter is a new line."}
          onChange={(e) => setText(e.target.value)}
          onScroll={(e) => { if (ghost.current) ghost.current.scrollTop = e.target.scrollTop; }}
          onSelect={(e) => { if (hint && e.target.selectionStart !== text.length) setHint(""); }}
          onKeyDown={(e) => {
            if (e.key === "Tab" && hint && !e.shiftKey) { e.preventDefault(); setText(text + hint); setHint(""); return; }
            // Shift+Tab: the next thinking level, like in the terminal.
            if (e.key === "Tab" && e.shiftKey && onCycleThinking) { e.preventDefault(); onCycleThinking(); return; }
            if (e.key === "Escape" && hint) { e.preventDefault(); setHint(""); return; }
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

// ".", "..", "...", "." again: the model is still working.
const Dots = () => <span className="dots" aria-hidden="true">...</span>;

// The text of the last answer, for the suggestions (the student often answers it).
function lastAssistantText(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "assistant") return items[i].blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").slice(-600);
  }
  return "";
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
