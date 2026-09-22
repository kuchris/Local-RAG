const { app, BrowserWindow, ipcMain, dialog, session } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

let backend,
  origin,
  quitting = false;
const root = path.resolve(__dirname, "..");
if (process.env.LOCAL_RAG_DATA_DIR)
  app.setPath(
    "userData",
    path.join(process.env.LOCAL_RAG_DATA_DIR, "electron-profile"),
  );
const token = crypto.randomBytes(32).toString("hex");
const dataDir =
  process.env.LOCAL_RAG_DATA_DIR ||
  path.join(app.getPath("userData"), "library");

async function startBackend() {
  const bundled = path.join(root, "runtime", "python.exe");
  const development = path.join(root, ".venv", "Scripts", "python.exe");
  const python =
    process.env.LOCAL_RAG_PYTHON ||
    ((app.isPackaged || !fs.existsSync(development)) && fs.existsSync(bundled)
      ? bundled
      : path.join(root, ".venv", "Scripts", "python.exe"));
  if (!fs.existsSync(python))
    throw new Error(
      "找不到 Python 環境。請先執行 setup.ps1，或設定 LOCAL_RAG_PYTHON。",
    );
  fs.mkdirSync(dataDir, { recursive: true });
  const log = fs.createWriteStream(path.join(dataDir, "backend.log"), {
    flags: "a",
  });
  backend = spawn(
    python,
    ["-u", "-m", "backend.server", "--data-dir", dataDir],
    {
      cwd: root,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: "1", LOCAL_RAG_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  backend.stderr.pipe(log);
  backend.once("exit", (code) => {
    log.end();
    if (!quitting && origin) {
      dialog.showErrorBox(
        "Local RAG backend 已停止",
        `請重新啟動 app。錯誤代碼：${code}\n日誌：${path.join(dataDir, "backend.log")}`,
      );
      app.quit();
    }
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Python backend 啟動逾時。請查看 backend.log。")),
      30000,
    );
    let buffer = "";
    backend.stdout.on("data", (data) => {
      buffer += data.toString();
      for (const line of buffer.split("\n").slice(0, -1)) {
        try {
          const value = JSON.parse(line);
          if (value.port) {
            clearTimeout(timeout);
            resolve(value.port);
          }
        } catch {}
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
    });
    backend.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    backend.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Backend exited: ${code}`));
    });
  });
  origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(origin + "/api/health", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Backend health check failed");
}

function validSender(event) {
  return event.senderFrame?.url.startsWith(origin + "/");
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 700,
    title: "Local RAG · 私人閱讀室",
    backgroundColor: "#f6f5f0",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(origin + "/")) event.preventDefault();
  });
  await win.loadURL(origin);
  win.show();
  win.focus();
}

if (!app.requestSingleInstanceLock() && !process.env.LOCAL_RAG_DATA_DIR)
  app.quit();
else
  app.whenReady().then(async () => {
    try {
      await startBackend();
      await session.defaultSession.cookies.set({
        url: origin,
        name: "rag_session",
        value: token,
        httpOnly: true,
        sameSite: "strict",
        path: "/",
      });
      session.defaultSession.setPermissionRequestHandler(
        (_wc, _permission, callback) => callback(false),
      );
      ipcMain.handle("choose-documents", async (event, language) => {
        if (!validSender(event)) throw new Error("Invalid sender");
        const result = await dialog.showOpenDialog({
          properties: ["openFile", "multiSelections"],
          filters: [
            {
              name:
                language === "en"
                  ? "PDF / EPUB documents"
                  : language === "ja"
                    ? "PDF / EPUB 文書"
                    : "PDF / EPUB 文件",
              extensions: ["pdf", "epub"],
            },
          ],
        });
        if (result.canceled) return [];
        const results = [];
        for (const filename of result.filePaths) {
          if (fs.statSync(filename).size > 50 * 1024 * 1024)
            throw new Error("每份文件上限為 50 MB。");
          const form = new FormData();
          form.append(
            "file",
            new Blob([await fs.promises.readFile(filename)]),
            path.basename(filename),
          );
          const response = await fetch(origin + "/api/documents", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.detail || "匯入失敗");
          results.push(data);
        }
        return results;
      });
      ipcMain.handle("choose-folder", async (event, language) => {
        if (!validSender(event)) throw new Error("Invalid sender");
        const result = await dialog.showOpenDialog({
          title:
            language === "en"
              ? "Connect a document folder (including subfolders)"
              : language === "ja"
                ? "文書フォルダーを接続（サブフォルダーも含む）"
                : "連接文件資料夾（包含子資料夾）",
          properties: ["openDirectory"],
        });
        if (result.canceled) return null;
        const response = await fetch(origin + "/api/folders", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ path: result.filePaths[0] }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || "連接資料夾失敗");
        return data;
      });
      await createWindow();
    } catch (error) {
      dialog.showErrorBox("Local RAG 無法啟動", error.message);
      app.quit();
    }
  });
app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    win.show();
    win.restore();
    win.focus();
  }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  (async () => {
    try {
      if (origin)
        await fetch(origin + "/api/release-embedding", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(5000),
        });
    } catch {
    } finally {
      backend?.kill();
      app.quit();
    }
  })();
});
