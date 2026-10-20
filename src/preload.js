const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lolTool", {
  getState: () => ipcRenderer.invoke("get-state"),
  setSettings: (patch) => ipcRenderer.invoke("set-settings", patch),
  reapply: () => ipcRenderer.invoke("reapply"),
  onState: (cb) => ipcRenderer.on("state", (_e, s) => cb(s)),
});
