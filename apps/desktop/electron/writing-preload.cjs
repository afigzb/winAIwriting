const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("winAIWriting", {
  open: () => ipcRenderer.invoke("winai:project-open"),
  save: (files, token) =>
    ipcRenderer.invoke("winai:project-save", files, token),
});
