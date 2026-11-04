const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lolTool", {
  getState: () => ipcRenderer.invoke("get-state"),
  setSettings: (patch) => ipcRenderer.invoke("set-settings", patch),
  reapply: () => ipcRenderer.invoke("reapply"),
  hover: (type, championId) => ipcRenderer.invoke("hover", type, championId),
  chooseRunes: (idx) => ipcRenderer.invoke("choose-runes", idx),
  chooseBuild: (idx) => ipcRenderer.invoke("choose-build", idx),
  onState: (cb) => ipcRenderer.on("state", (_e, s) => cb(s)),
});
