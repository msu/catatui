// The bridge between the renderer and main.js. The renderer has no Node access.
const { contextBridge, ipcRenderer, webUtils } = require("electron");

const on = (channel) => (fn) => {
  const listener = (_e, data) => fn(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("catatui", {
  // catatui (pi RPC)
  command: (cmd) => ipcRenderer.invoke("rpc-command", cmd),
  respond: (response) => ipcRenderer.send("ui-response", response),
  start: () => ipcRenderer.invoke("start"),
  onEvent: on("rpc-event"),
  onStderr: on("rpc-stderr"),
  onExit: on("rpc-exit"),
  // sign-in
  info: () => ipcRenderer.invoke("info"),
  signInSso: () => ipcRenderer.invoke("sign-in-sso"),
  signInCancel: () => ipcRenderer.send("sign-in-cancel"),
  signInKey: (key) => ipcRenderer.invoke("sign-in-key", key),
  signOut: () => ipcRenderer.invoke("sign-out"),
  onSignInUrl: on("sign-in-url"),
  openExternal: (url) => ipcRenderer.send("open-external", url),
  gitHubState: () => ipcRenderer.invoke("github-state"),
  gitHubTokenPage: () => ipcRenderer.send("github-token-page"),
  gitHubSignIn: (token) => ipcRenderer.invoke("github-sign-in", token),
  gitHubSignOut: () => ipcRenderer.invoke("github-sign-out"),
  // projects and sessions
  listProjects: () => ipcRenderer.invoke("list-projects"),
  listSessions: () => ipcRenderer.invoke("list-sessions"),
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  openProject: (path, sessionPath) => ipcRenderer.invoke("open-project", path, sessionPath),
  // Windows: open a folder (and a session) in a new window. Another window can ask this one to open a session.
  openInWindow: (path, sessionPath) => ipcRenderer.invoke("open-in-window", path, sessionPath),
  onOpenSession: on("open-session"),
  renameSession: (path, title) => ipcRenderer.invoke("rename-session", path, title),
  deleteSession: (path) => ipcRenderer.invoke("delete-session", path),
  redactSession: (target) => ipcRenderer.invoke("redact-session", target),
  // The side panel: a whole file, and a project file as a file:// URL for the web preview.
  fileRead: (path) => ipcRenderer.invoke("file-read", path),
  suggest: (text, context) => ipcRenderer.invoke("suggest", text, context),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  setSetting: (key, value) => ipcRenderer.invoke("set-setting", key, value),
  fileUrl: (path) => ipcRenderer.invoke("file-url", path),
  chatMenu: (text) => ipcRenderer.invoke("chat-menu", text),
  newChat: () => ipcRenderer.invoke("new-chat"),
  advising: () => ipcRenderer.invoke("advising"),
  classes: (code) => ipcRenderer.invoke("classes", code),
  classInfo: () => ipcRenderer.invoke("class-info"),
  linkClassProject: (path) => ipcRenderer.invoke("link-class-project", path),
  onTitlesUpdated: on("titles-updated"),
  widgetFrame: (html) => ipcRenderer.invoke("widget-frame", html),
  listFolders: (path) => ipcRenderer.invoke("list-folders", path),
  makeFolder: (parent, name) => ipcRenderer.invoke("make-folder", parent, name),
  // changed files
  changedFiles: () => ipcRenderer.invoke("changed-files"),
  fileTree: () => ipcRenderer.invoke("file-tree"),
  fileView: (path) => ipcRenderer.invoke("file-view", path),
  filePreview: (path) => ipcRenderer.invoke("file-preview", path),
  // A file dragged from Finder or Explorer: its full path, then the path in the project (or an error).
  pathForFile: (file) => webUtils.getPathForFile(file),
  projectPath: (full) => ipcRenderer.invoke("project-path", full),
  fileMenu: (path, opts) => ipcRenderer.invoke("file-menu", path, opts),
  // After a roll back from the file menu, the tree and the file cards read the files again.
  onFilesChanged: on("files-changed"),
  openPath: (path) => ipcRenderer.send("open-path", path),
  // The application menu: the renderer sends its state, and gets the menu actions.
  menuState: (st) => ipcRenderer.send("menu-state", st),
  onMenu: on("menu"),
});
