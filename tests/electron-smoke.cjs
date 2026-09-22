const { _electron: electron } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const runDir = path.join(root, "artifacts", `electron-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const fixture = path.join(runDir, "Fictional-timers.pdf");
execFileSync(path.join(root, ".venv", "Scripts", "python.exe"), [
  path.join(root, "tests", "make_demo_pdf.py"),
  fixture,
]);
const live = process.argv.includes("--live");
const packaged = process.argv.includes("--packaged");
const errors = [];
let app, page, origin;
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
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForLoadState("networkidle");
  await page.locator("#model-status").waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setBackgroundThrottling(false);
    win.hide();
  });
  origin = new URL(page.url()).origin;
}
async function screenshot(options) {
  const png = await app.evaluate(async ({ BrowserWindow }) =>
    (
      await BrowserWindow.getAllWindows()[0].webContents.capturePage(
        undefined,
        { stayHidden: true, stayAwake: true },
      )
    )
      .toPNG()
      .toString("base64"),
  );
  fs.writeFileSync(options.path, Buffer.from(png, "base64"));
}
async function main() {
  try {
    await launch();
    assert.equal(await page.evaluate(() => typeof window.require), "undefined");
    assert.equal((await fetch(origin + "/api/health")).status, 401);
    await screenshot({ path: path.join(runDir, "01-welcome.png") });
    await page.locator("#file-input").setInputFiles(fixture);
    await page.waitForFunction(
      () => document.querySelector(".doc-meta")?.textContent.includes("個段落"),
      null,
      { timeout: 240000 },
    );
    const docs = await page.evaluate(() =>
      fetch("/api/documents").then((r) => r.json()),
    );
    assert.equal(docs.length, 1);
    assert.equal(docs[0].status, "ready");
    assert.ok(docs[0].pages > 0);
    await page.locator("#file-input").setInputFiles(fixture);
    await page.waitForFunction(() =>
      document.querySelector("#toast").textContent.includes("已在文件庫"),
    );
    await page.locator(".document-select").click();
    assert.equal(await page.locator("#scope-name").textContent(), docs[0].name);
    await page.locator("#settings-button").click();
    await page.locator('input[name="top_k"]').fill("4");
    await page.locator('#settings-form button[type="submit"]').click();
    await page.locator("#settings-dialog").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() =>
        fetch("/api/settings")
          .then((r) => r.json())
          .then((s) => s.top_k),
      ),
      4,
    );
    if (live) {
      await page
        .locator("#question")
        .fill(
          "What delays were measured for Timer A and Timer B? Include uncertainties and cite the source.",
        );
      await page.locator("#send").click();
      await page
        .locator(".message.assistant .message-footer")
        .waitFor({ timeout: 240000 });
      const answer = await page
        .locator(".message.assistant .message-content")
        .textContent();
      assert.ok(answer.includes("7.4") && answer.includes("12.8"), answer);
      assert.ok(answer.includes("0.3") && answer.includes("0.5"), answer);
      assert.ok(
        (await page.locator(".citation").count()) > 0,
        "Missing citations",
      );
      await screenshot({ path: path.join(runDir, "02-answer.png") });
      await page.locator(".citation").first().click();
      await page.locator("#pdf-dialog").waitFor({ state: "visible" });
      assert.ok(
        (await page.locator("#pdf-viewer").getAttribute("src")).includes(
          "#page=",
        ),
      );
      await page.waitForTimeout(1500);
      await screenshot({ path: path.join(runDir, "03-pdf.png") });
      await page.locator("#pdf-dialog .close-dialog").click();
      fs.writeFileSync(path.join(runDir, "answer.txt"), answer);
      await page.locator("#new-chat").click();
      await page
        .locator("#question")
        .fill("文件中 Timer A 和 Timer B 的延遲各是多少？請附上誤差值及引用。");
      await page.locator("#send").click();
      await page
        .locator(".message.assistant .message-footer")
        .waitFor({ timeout: 90000 });
      const chineseAnswer = await page
        .locator(".message.assistant .message-content")
        .textContent();
      assert.ok(
        ["7.4", "12.8", "0.3", "0.5"].every((value) =>
          chineseAnswer.includes(value),
        ),
        chineseAnswer,
      );
      assert.ok((await page.locator(".citation").count()) > 0);
      await screenshot({ path: path.join(runDir, "04-chinese-answer.png") });
      fs.writeFileSync(path.join(runDir, "answer-zh.txt"), chineseAnswer);
    } else await screenshot({ path: path.join(runDir, "02-imported.png") });
    const previousOrigin = origin;
    await app.close();
    app = null;
    await assert.rejects(fetch(previousOrigin + "/api/health"));
    await launch();
    await page.waitForFunction(
      () => document.querySelectorAll(".document").length === 1,
    );
    assert.equal(
      await page.evaluate(() =>
        fetch("/api/settings")
          .then((r) => r.json())
          .then((s) => s.top_k),
      ),
      4,
    );
    if (live) {
      await page.locator(".conversation>button").first().click();
      await page.locator(".message.assistant .citation").first().waitFor();
    }
    await page.locator(".document").hover();
    await page.locator(".doc-delete").click();
    await page.locator("#confirm-delete").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".document").length === 0,
    );
    assert.equal(
      (await page.evaluate(() => fetch("/api/documents").then((r) => r.json())))
        .length,
      0,
    );
    await app.close();
    app = null;
    await launch();
    assert.equal(
      (await page.evaluate(() => fetch("/api/documents").then((r) => r.json())))
        .length,
      0,
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(runDir, "result.json"),
      JSON.stringify(
        {
          live,
          packaged,
          passed: true,
          checks: [
            "sandbox",
            "loopback auth",
            "generated PDF extraction + real embedding",
            "duplicate",
            "scope",
            "settings",
            "restart persistence",
            "delete persistence",
            "backend shutdown",
            ...(live
              ? [
                  "real Qwen answer",
                  "citation",
                  "PDF preview",
                  "chat persistence",
                  "Chinese-to-English retrieval and grounded answer",
                ]
              : []),
          ],
          errors,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ passed: true, live, artifacts: runDir }));
  } finally {
    if (app) await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
