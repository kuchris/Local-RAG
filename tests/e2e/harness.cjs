/* Launches the app for end-to-end tests.
 *   default      Electron (development checkout)
 *   --packaged   the portable build in dist/
 *   --browser    Python backend + headless Chromium, for machines where Electron cannot start
 * --live additionally checks generated answers (needs models in models/).
 */
const { _electron: electron, chromium } = require("playwright");
const { spawn, execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..", "..");
const python = path.join(root, ".venv", "Scripts", "python.exe");
const flags = {
  live: process.argv.includes("--live"),
  packaged: process.argv.includes("--packaged"),
  browser: process.argv.includes("--browser"),
};

function runDir(name) {
  const dir = path.join(root, "artifacts", `${name}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function makePdf(file) {
  execFileSync(python, [path.join(root, "tests", "make_demo_pdf.py"), file]);
}

function makeEpub(file, value) {
  execFileSync(python, [path.join(root, "tests", "test_epub_folders.py"), file, value], {
    env: { ...process.env, PYTHONPATH: root },
  });
}

async function startBackend(dataDir, token) {
  const backend = spawn(python, ["-u", "-m", "backend.server", "--data-dir", dataDir], {
    cwd: root,
    env: { ...process.env, PYTHONUTF8: "1", LOCAL_RAG_TOKEN: token },
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });
  const port = await new Promise((resolve, reject) => {
    let buffer = "";
    backend.stdout.on("data", (data) => {
      buffer += data;
      const match = /\{"port": (\d+)\}/.exec(buffer);
      if (match) resolve(Number(match[1]));
    });
    backend.once("exit", (code) => reject(new Error(`Backend exited: ${code}`)));
  });
  return { backend, origin: `http://127.0.0.1:${port}` };
}

/** Returns { page, origin, chooseFolder(folder), resize(width, height), close() }; page errors go to `errors`. */
async function launch(dataDir, errors) {
  if (!fs.existsSync(path.join(root, "frontend", "dist", "index.html")))
    throw new Error("Run `npm run build:ui` first.");
  let page, origin, close, chooseFolder, resize;
  if (flags.browser) {
    const token = crypto.randomBytes(16).toString("hex");
    const server = await startBackend(dataDir, token);
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await context.addCookies([{ name: "rag_session", value: token, url: server.origin }]);
    let folder = null;
    await context.exposeFunction("__chosenFolder", () => folder);
    // Stand-in for the Electron preload: the same API calls main.cjs makes after a native dialog.
    await context.addInitScript(() => {
      window.desktop = {
        chooseDocuments: async () => [],
        chooseFolder: async () => {
          const chosen = await window.__chosenFolder();
          if (!chosen) return null;
          const response = await fetch("/api/folders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: chosen }),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.detail);
          return data;
        },
      };
    });
    page = await context.newPage();
    origin = server.origin;
    await page.goto(origin);
    chooseFolder = async (value) => {
      folder = value;
    };
    resize = (width, height) => page.setViewportSize({ width, height });
    close = async () => {
      await fetch(origin + "/api/shutdown", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      await browser.close();
      server.backend.kill();
      await new Promise((resolve) => server.backend.once("exit", resolve));
    };
  } else {
    const app = await electron.launch({
      ...(flags.packaged
        ? { executablePath: path.join(root, "dist", "Local-RAG-win32-x64", "Local-RAG.exe"), args: [] }
        : { args: [root] }),
      env: { ...process.env, LOCAL_RAG_DATA_DIR: dataDir },
    });
    page = await app.firstWindow();
    origin = new URL(page.url()).origin;
    chooseFolder = (folder) =>
      app.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      }, folder);
    resize = (width, height) =>
      app.evaluate(({ BrowserWindow }, [width, height]) => BrowserWindow.getAllWindows()[0].setContentSize(width, height), [width, height]);
    close = () => app.close();
  }
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByTestId("model-status").or(page.getByTestId("sidebar")).first().waitFor();
  return { page, origin, chooseFolder, resize, close };
}

/** Polls a function evaluated in the page (with access to the authenticated API) until it is truthy. */
async function waitApi(page, predicate, arg, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, arg)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`API state did not reach the expected condition within ${timeout} ms`);
}

const getJson = (page, url) => page.evaluate((url) => fetch(url).then((r) => r.json()), url);

/** Asks a question in a new chat and returns the answer text once it finishes. */
async function ask(page, question, timeout = 240000) {
  await page.getByTestId("new-chat").click();
  await page.getByTestId("question").fill(question);
  await page.getByTestId("send").click();
  const answer = page.getByTestId("answer").last();
  await answer.getByTestId("show-sources").waitFor({ timeout });
  return answer.locator(".answer").textContent();
}

function report(dir, name, data) {
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify({ name, ...flags, ...data }, null, 2));
  console.log(JSON.stringify({ passed: true, name, ...flags, artifacts: dir }));
}

module.exports = { root, flags, runDir, makePdf, makeEpub, launch, waitApi, getJson, ask, report };
