// The text editor in the side panel (CodeMirror 6). See src/md/features/desktop.md.
// - Autosave: 1 second after the student stops typing, when the editor loses the focus, and when it closes.
// - A save sends the text that the editor loaded or saved last ("expected"). If the file on disk is different
//   (another app changed it), main.js writes nothing, and a bar asks: Reload, or Keep mine.
// - While the agent works (busy), the editor saves at once and then is locked. The agent changes the open file
//   with editor_edit (src/catatui/editor.ts): the change goes into the document, so Cmd+Z can undo it.
// - While "Changes" is on, the editor is read only. Only the Revert and Keep buttons change it.
import { useEffect, useRef, useState } from "react";
import { basicSetup, EditorView } from "codemirror";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { unifiedMergeView } from "@codemirror/merge";

const api = window.catatui;
// A change from the disk, not from the student: no autosave.
const fromDisk = Annotation.define();

// Syntax highlighting by file type. Other text files open with no highlighting.
const LANGS = {
  html: () => html(), htm: () => html(), css: () => css(),
  js: () => javascript(), mjs: () => javascript(), cjs: () => javascript(), jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }), tsx: () => javascript({ typescript: true, jsx: true }),
  json: () => json(), md: () => markdown(), markdown: () => markdown(), py: () => python(),
  txt: () => [], csv: () => [],
};
// All text files open in the editor (FilePane checks that the file is text). Binary files have their own views.
export const isEditable = () => true;

// The open editors, by project path. The app gives editor_edit requests to the editor of the file.
export const editors = new Map();

// Apply editor_edit: each oldText must be in the document exactly one time. All edits are one undo step.
function applyEdits(view, spec) {
  const doc = view.state.doc.toString();
  if (spec.content !== undefined && !spec.edits?.length) return { changes: [{ from: 0, to: doc.length, insert: spec.content }] };
  const changes = [];
  for (const e of spec.edits ?? []) {
    const at = doc.indexOf(e.oldText);
    if (at < 0) return { error: `The text to replace is not in the file: ${JSON.stringify(e.oldText.slice(0, 80))}. Read the file again.` };
    if (doc.indexOf(e.oldText, at + 1) >= 0) return { error: `The text to replace is in the file more than one time: ${JSON.stringify(e.oldText.slice(0, 80))}. Give more text around it.` };
    changes.push({ from: at, to: at + e.oldText.length, insert: e.newText });
  }
  changes.sort((a, b) => a.from - b.from);
  for (let i = 1; i < changes.length; i++) if (changes[i].from < changes[i - 1].to) return { error: "Two edits change the same text. Give one edit for it." };
  return { changes };
}

// original: the text to compare with ("Changes" on), or undefined. The merge view shows each changed block inline,
// with "Revert" (back to the original text, then autosave) and "Keep" (hide the block) buttons.
export function TextEditor({ path, text, busy, onSaved, onFocusInfo, original }) {
  const host = useRef(null);
  const view = useRef(null);
  const base = useRef(text); // the text on disk that the editor knows
  const timer = useRef(undefined);
  const lock = useRef(new Compartment());
  const merge = useRef(new Compartment());
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [status, setStatus] = useState("saved"); // saved, dirty, saving, conflict, error
  const [conflict, setConflict] = useState(undefined); // the text on disk, in a conflict
  const [error, setError] = useState("");
  const statusRef = useRef(status);
  statusRef.current = status;
  const cb = useRef({ onSaved, onFocusInfo });
  cb.current = { onSaved, onFocusInfo };

  // Returns true if the file on disk has the text of the editor now.
  async function save(byAgent = false) {
    clearTimeout(timer.current);
    const v = view.current;
    if (!v || statusRef.current === "conflict") return false;
    const now = v.state.doc.toString();
    if (now === base.current) { setStatus("saved"); return true; }
    setStatus("saving");
    const r = await api.fileWrite(path, now, base.current);
    if (r.conflict) { statusRef.current = "conflict"; setConflict(r.text ?? ""); setStatus("conflict"); return false; }
    if (r.error) { setError(r.error); setStatus("error"); return false; }
    base.current = now;
    setError("");
    setStatus(v.state.doc.toString() === now ? "saved" : "dirty");
    // The agent does not get a "student edited" note for its own change.
    if (!byAgent) cb.current.onSaved?.(path);
    return true;
  }
  const saveRef = useRef(save);
  saveRef.current = save;

  // The cursor line and the selection, for the agent's context. At most 2 times a second.
  const focusTimer = useRef(undefined);
  const reportFocus = (v) => {
    clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => {
      const sel = v.state.selection.main;
      cb.current.onFocusInfo?.({ path, line: v.state.doc.lineAt(sel.head).number, selection: sel.empty ? "" : v.state.sliceDoc(sel.from, sel.to).slice(0, 2000) });
    }, 500);
  };

  useEffect(() => {
    const lang = LANGS[path.split(".").pop().toLowerCase()]?.() ?? [];
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          lang,
          lock.current.of([]),
          merge.current.of([]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": `Edit ${path}` }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(fromDisk))) {
              setStatus((s) => (s === "conflict" ? s : "dirty"));
              clearTimeout(timer.current);
              timer.current = setTimeout(() => saveRef.current(), 1000);
            }
            if (u.selectionSet || u.docChanged || u.focusChanged) reportFocus(u.view);
          }),
          EditorView.domEventHandlers({ blur: () => { saveRef.current(); } }),
        ],
      }),
    });
    view.current = v;
    reportFocus(v);
    // editor_edit from the agent: change the document, then save at once.
    editors.set(path, {
      apply: async (spec) => {
        const r = applyEdits(v, spec);
        if (r.error) return { error: r.error };
        v.dispatch({ changes: r.changes, userEvent: "input.agent" });
        return (await saveRef.current(true)) ? { ok: true } : { error: "The change is in the editor, but the editor could not save it. Tell the student to look at the file." };
      },
    });
    return () => {
      editors.delete(path);
      clearTimeout(focusTimer.current);
      saveRef.current();
      v.destroy();
      view.current = undefined;
    };
  }, [path]);

  // The file on disk changed (an agent tool, Undo, or another app). No local changes: show the new text.
  // Local changes: a conflict, so the student chooses.
  useEffect(() => {
    const v = view.current;
    if (!v || text === undefined || text === base.current) return;
    if (v.state.doc.toString() === base.current) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text }, annotations: fromDisk.of(true) });
      base.current = text;
      setStatus("saved");
    } else if (v.state.doc.toString() !== text) {
      setConflict(text);
      setStatus("conflict");
    } else base.current = text;
  }, [text]);

  // "Changes": the merge view against the original text. While the agent works, Revert and Keep do nothing.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const button = (type, action) => {
      const b = document.createElement("button");
      b.className = `btn small merge-${type}`;
      b.textContent = type === "reject" ? "Revert" : "Keep";
      b.title = type === "reject" ? "Undo this change (back to the original text)" : "Keep this change and hide it";
      b.onmousedown = (e) => { if (!busyRef.current) action(e); else e.preventDefault(); };
      return b;
    };
    v.dispatch({ effects: merge.current.reconfigure(original === undefined ? [] : unifiedMergeView({
      original, gutter: true, mergeControls: button, collapseUnchanged: { margin: 3, minSize: 6 },
    })) });
  }, [original]);

  // The agent works: save now, then lock. After the agent: unlock.
  // "Changes" on: also locked. Only Revert and Keep change the text (they dispatch, so readOnly does not stop them).
  const diffing = original !== undefined;
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if ((busy || diffing) && statusRef.current === "dirty") saveRef.current();
    v.dispatch({ effects: lock.current.reconfigure(busy || diffing ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []) });
  }, [busy, diffing]);

  const reload = () => {
    const v = view.current;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: conflict }, annotations: fromDisk.of(true) });
    base.current = conflict;
    setConflict(undefined);
    setStatus("saved");
  };
  const keepMine = async () => {
    base.current = conflict;
    setConflict(undefined);
    statusRef.current = "dirty";
    setStatus("dirty");
    await saveRef.current();
  };

  return (
    <div className="editor">
      <div className="editor-bar" role="status" aria-live="polite">
        {busy ? <span className="editor-lock">catai is working. You can edit when it is done.</span>
          : diffing && status !== "conflict" && status !== "error" ? <span className="editor-state">Read only while Changes is on. Use Revert, or turn off Changes to edit.</span>
          : status === "saved" ? <span className="editor-state">Saved</span>
          : status === "saving" ? <span className="editor-state">Saving...</span>
          : status === "dirty" ? <span className="editor-state">Edited</span>
          : status === "error" ? <span className="error">{error}</span> : null}
        {status === "conflict" && (
          <span className="editor-conflict">
            Another app changed this file.
            <button className="btn small" onClick={reload}>Reload</button>
            <button className="btn small" onClick={keepMine}>Keep mine</button>
          </span>
        )}
      </div>
      <div className={`editor-host ${busy ? "locked" : ""}`} ref={host} />
    </div>
  );
}
