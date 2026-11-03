// The bridge between the renderer and main.js. The renderer has no Node access.
const { contextBridge, ipcRenderer } = require("electron");

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
});
