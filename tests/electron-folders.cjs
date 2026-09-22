const { _electron: electron } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const runDir = path.join(root, "artifacts", `folders-${Date.now()}`);
const source = path.join(runDir, "My Books");
const nested = path.join(source, "Research");
fs.mkdirSync(nested, { recursive: true });
const fixture = path.join(nested, "Orchid.epub");
const packaged = process.argv.includes("--packaged");
const live = process.argv.includes("--live");
let app, page;
const errors = [];
function writeBook(value) {
  execFileSync(
    path.join(root, ".venv", "Scripts", "python.exe"),
    [path.join(root, "tests", "test_epub_folders.py"), fixture, value],
    { env: { ...process.env, PYTHONPATH: root } },
  );
}
async function launch() {
  app = await electron.launch({
    ...(packaged
      ? {
          executablePath: path.join(
            root,
            "dist",
            "Local-RAG-win32-x64",
            "Local-RAG.exe",
          ),
          args: [],
        }
      : { args: [root] }),
    env: { ...process.env, LOCAL_RAG_DATA_DIR: path.join(runDir, "library") },
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForLoadState("networkidle");
}
async function waitLibrary(value, count = 1) {
  await waitApi(
    async ({ value, count }) => {
      const docs = await fetch("/api/documents").then((r) => r.json());
      const folders = await fetch("/api/folders").then((r) => r.json());
      if (
        docs.length !== count ||
        docs.some((d) => d.status !== "ready") ||
        folders.some((f) => f.files.some((x) => x.pending_id))
      )
        return false;
      for (const doc of docs.filter((d) => d.format === "epub")) {
        const section = await fetch(`/api/documents/${doc.id}/sections/2`).then(
          (r) => r.json(),
        );
        if (section.text.includes(value)) return true;
      }
      return false;
    },
    { value, count },
  );
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".document").length === count &&
      [...document.querySelectorAll(".document-select")].every(
        (button) => !button.disabled,
      ),
    count,
  );
}
async function waitApi(predicate, arg, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate, arg)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    "API state did not reach the expected condition within " + timeout + " ms",
  );
}
async function ask(value) {
  await page.locator("#send").waitFor({ state: "visible" });
  await page.locator("#new-chat").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".message").length === 0,
  );
  await page
    .locator("#question")
    .fill("Orchid 計劃預算是多少港元？請引用文件。");
  await page.locator("#send").click();
  await page
    .locator(".message.assistant .message-footer")
    .waitFor({ timeout: 120000 });
  await page.locator("#send").waitFor({ state: "visible" });
  const answer = await page
    .locator(".message.assistant .message-content")
    .textContent();
  assert.ok(answer.replaceAll(",", "").includes(value), answer);
  await page.locator(".citation").first().click();
  await page.locator("#epub-viewer").waitFor({ state: "visible" });
  await page.waitForFunction(
    (value) => document.querySelector("#epub-text").textContent.includes(value),
    value,
  );
  assert.equal(await page.locator("#pdf-viewer").isVisible(), false);
  await page.screenshot({ path: path.join(runDir, `chapter-${value}.png`) });
  await page.locator("#pdf-dialog .close-dialog").click();
  fs.writeFileSync(path.join(runDir, `answer-${value}.txt`), answer);
}
(async () => {
  try {
    writeBook("4200");
    await launch();
    // Replace only the native chooser, then exercise the actual preload/main IPC and API.
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, source);
    await page.locator("#connect-folder").click();
    await page.locator(".folder-summary").waitFor();
    await waitLibrary("4200");
    await page.locator("#document-search").fill("nothing matches");
    await page.waitForFunction(
      () => document.querySelectorAll(".document").length === 0,
    );
    await page.locator("#document-search").fill("orchid");
    await page.waitForFunction(
      () => document.querySelectorAll(".document").length === 1,
    );
    await page.locator("#document-search").fill("");
    if (live) await ask("4200");
    writeBook("7300");
    await waitLibrary("7300");
    if (live) await ask("7300");
    // Real ongoing monitoring discovers a second new EPUB without clicking Scan.
    const other = path.join(source, "Other.epub");
    execFileSync(
      path.join(root, ".venv", "Scripts", "python.exe"),
      [path.join(root, "tests", "test_epub_folders.py"), other, "9800"],
      { env: { ...process.env, PYTHONPATH: root } },
    );
    await waitLibrary("9800", 2);
    await page.screenshot({ path: path.join(runDir, "library.png") });
    await page.locator("#manage-folders").click();
    await page.locator("#folder-details .folder-detail").waitFor();
    await page.screenshot({ path: path.join(runDir, "folders.png") });
    await page.locator("#folders-dialog .close-dialog").click();
    const previousOrigin = new URL(page.url()).origin;
    await app.close();
    app = null;
    await assert.rejects(fetch(previousOrigin + "/api/health"));
    writeBook("8600"); // Changes while the app is closed are imported after restart.
    await launch();
    await waitLibrary("8600", 2);
    fs.unlinkSync(fixture);
    await waitApi(
      async () =>
        (await fetch("/api/folders").then((r) => r.json()))[0].files.some(
          (f) => !f.present,
        ),
      null,
      40000,
    );
    assert.equal(
      (await page.evaluate(() => fetch("/api/documents").then((r) => r.json())))
        .length,
      2,
    );
    await page.locator("#manage-folders").click();
    await page.getByRole("button", { name: "停止連接（保留文件）" }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".folder-summary").length === 0,
    );
    assert.equal(
      (await page.evaluate(() => fetch("/api/documents").then((r) => r.json())))
        .length,
      2,
    );
    assert.ok(fs.existsSync(other));
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(runDir, "result.json"),
      JSON.stringify(
        {
          passed: true,
          live,
          packaged,
          checks: [
            "native-picker IPC",
            "recursive EPUB import",
            "name search",
            "chapter citation",
            "background add/update",
            "restart catch-up",
            "missing source retained",
            "detach retained",
            "backend shutdown",
            "no page errors",
          ],
        },
        null,
        2,
      ),
    );
    console.log(runDir);
  } catch (error) {
    if (page)
      await page
        .screenshot({ path: path.join(runDir, "failure.png") })
        .catch(() => {});
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (app) await app.close();
  }
})();
