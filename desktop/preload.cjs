const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  chooseDocuments: (language) =>
    ipcRenderer.invoke("choose-documents", language),
  chooseFolder: (language) => ipcRenderer.invoke("choose-folder", language),
});
