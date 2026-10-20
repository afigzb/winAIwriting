import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerWritingIpc } from "./writing-files.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const smoke = process.argv.includes("--writing-smoke");
const smokeDirectory = process.env.WINAI_WRITING_SMOKE_DIR;
app.setName("winAIwriting");
if (smoke && (!smokeDirectory || !path.isAbsolute(smokeDirectory)))
  throw new Error("Smoke tests require an explicit absolute data directory");
app.setPath(
  "userData",
  smoke ? smokeDirectory : path.join(app.getPath("appData"), "winAIwriting"),
);
let window = null;
registerWritingIpc({ ipcMain, dialog, getWindow: () => window });
async function open() {
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 650,
    title: "winAIwriting",
    show: false,
    webPreferences: {
      preload: path.join(directory, "writing-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.once("ready-to-show", () => {
    if (!smoke) window?.show();
  });
  window.once("closed", () => {
    window = null;
  });
  await window.loadFile(path.join(directory, "ui/writing.html"));
  if (smoke) {
    const result = await window.webContents.executeJavaScript(
      `({ title: document.title, bridge: typeof window.winAIWriting?.open, root: !!document.querySelector('.writing-shell') })`,
    );
    console.log(JSON.stringify(result));
    app.exit(result.bridge === "function" && result.root ? 0 : 1);
  }
}
// Let the ESM entry finish loading before waiting for Electron's ready event.
app.whenReady().then(open).catch(error => {
  console.error(error);
  app.exit(1);
});
app.on("activate", () => {
  if (!window) void open();
});
app.on("window-all-closed", () => app.quit());
