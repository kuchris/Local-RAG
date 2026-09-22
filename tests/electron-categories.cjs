const { _electron: electron, chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const runDir = path.join(root, "artifacts", `categories-${Date.now()}`);
fs.mkdirSync(runDir, { recursive: true });
const packaged = process.argv.includes("--packaged");
const live = process.argv.includes("--live");
let app, page;
const errors = [];
const result = { packaged, live };
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
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForLoadState("networkidle");
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.setBackgroundThrottling(false);
    win.hide();
  });
}
async function api(url, method = "GET", body) {
  return page.evaluate(
    async ({ url, method, body }) => {
      const response = await fetch("/api" + url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(data));
      return data;
    },
    { url, method, body },
  );
}
async function until(predicate, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Condition timed out");
}
async function language(value) {
  await page.locator("#language").selectOption(value);
  await page.waitForFunction(
    (value) => document.documentElement.lang === value,
    value,
  );
}
async function screenshot(name) {
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
  fs.writeFileSync(
    path.join(runDir, name + ".png"),
    Buffer.from(png, "base64"),
  );
}
async function assertEnglish(selector) {
  const remaining = await page.locator(selector).evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT),
      found = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest("#language,script,style")) continue;
      if (/[\u3400-\u9fff]/.test(node.textContent))
        found.push(node.textContent.trim());
    }
    return found;
  });
  assert.deepEqual(remaining, []);
}
(async () => {
  try {
    await launch();
    await language("en");
    await assertEnglish("body");
    await page.locator("#settings-button").click();
    await page.locator("#settings-dialog").waitFor({ state: "visible" });
    await assertEnglish("#settings-dialog");
    assert.equal(await page.locator("[name=model]").inputValue(), "qwen3.5-9b");
    await page.locator("#settings-dialog .close-dialog").click();
    await screenshot("english-empty");
    const fixtures = ["Novel-A.epub", "Novel-B.epub"].map((name) =>
      path.join(runDir, name),
    );
    execFileSync(path.join(root, ".venv", "Scripts", "python.exe"), [
      "-c",
      `
import io, zipfile
from pathlib import Path
import sys
for file,item in zip(sys.argv[1:], ['silver key','red compass']):
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as book:
        book.writestr('mimetype','application/epub+zip')
        book.writestr('META-INF/container.xml','<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>')
        book.writestr('book.opf','<package><manifest><item id="one" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>')
        book.writestr('chapter.xhtml',f'<html><body><h1>Chapter One</h1><p>Mira stood at the east gate. Orchid gave her a {item}. Mira placed the {item} in her pocket before walking home. This chapter does not describe her final destination or the ending.</p></body></html>')
    Path(file).write_bytes(output.getvalue())
`,
      ...fixtures,
    ]);
    await page.locator("#file-input").setInputFiles(fixtures);
    await until(async () => {
      const docs = await api("/documents");
      return docs.length === 2 && docs.every((d) => d.status === "ready");
    });
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".document-select:not(:disabled)").length ===
        2,
    );
    const docs = await api("/documents");
    const bookA = docs.find((d) => d.name === "Novel-A.epub");
    const bookB = docs.find((d) => d.name === "Novel-B.epub");
    await page.locator("#manage-categories").click();
    await page.locator("#category-form input").fill("Series A");
    await page.locator("#category-form button").click();
    await page.locator(".category-row").waitFor();
    const category = (await api("/categories"))[0];
    await page.locator("#categories-dialog .close-dialog").click();
    await page
      .locator(".document")
      .filter({ has: page.locator(".doc-name", { hasText: "Novel-A.epub" }) })
      .locator(".document-check")
      .check();
    await page.locator("#assign-category").selectOption(category.id);
    await page.locator("#apply-category").click();
    await until(
      async () =>
        (await api("/documents")).find((d) => d.id === bookA.id).category_id ===
        category.id,
    );
    await page.waitForFunction(
      (id) => document.querySelector("#category-scope").value === id,
      category.id,
    );
    await page.locator("#category-scope").selectOption(category.id);
    await page.locator("#reading-mode").selectOption("fiction");
    await until(async () => {
      const p = await api("/preferences");
      return (
        p.scope.reading_mode === "fiction" &&
        p.scope.document_ids === null &&
        p.scope.category_id === category.id
      );
    });
    assert.equal(await page.locator(".document").count(), 1);
    await screenshot("category-fiction-en");
    await page.locator("#clear-selection").click();
    await page.locator("#question").fill("What did Orchid give Mira?");
    await page.locator("#send").click();
    assert.equal(await page.locator(".message").count(), 0);
    assert.match(
      await page.locator("#toast").textContent(),
      /No processed documents/,
    );
    await page.locator("#category-scope").selectOption(category.id);
    if (live) {
      await page.locator("#send").click();
      await page
        .locator(".message.assistant .message-footer")
        .waitFor({ timeout: 180000 });
      await page.locator("#send").waitFor({ state: "visible" });
      result.answer = await page
        .locator(".message.assistant .message-content")
        .textContent();
      assert.match(result.answer, /silver key/i);
      assert.doesNotMatch(result.answer, /red compass/i);
      const conversations = await api("/conversations");
      result.conversation = conversations[0].id;
      const messages = await api("/conversations/" + result.conversation);
      assert.ok(messages[1].sources.length);
      assert.ok(messages[1].sources.every((s) => s.document_id === bookA.id));
      await page.locator(".citation").first().click();
      await page.waitForFunction(() =>
        document.querySelector("#epub-text").textContent.includes("silver key"),
      );
      await page.locator("#pdf-dialog .close-dialog").click();
      await screenshot("fiction-answer-en");
      await page.locator("#all-docs").click();
      assert.equal(await page.locator(".message").count(), 0);
      await page.locator(".conversation > button").first().click();
      await page.waitForFunction(
        () => document.querySelectorAll(".message").length === 2,
      );
      assert.equal(
        await page.locator("#category-scope").inputValue(),
        category.id,
      );
      assert.equal(await page.locator("#reading-mode").inputValue(), "fiction");
      await page.locator("#new-chat").click();
    }
    await page.locator("#all-docs").click();
    await page.locator("#select-visible").click();
    await page.waitForFunction(
      () => document.querySelectorAll(".document-check:checked").length === 2,
    );
    await page.locator("#assign-category").selectOption(category.id);
    await page.locator("#apply-category").click();
    await until(async () =>
      (await api("/documents")).every((d) => d.category_id === category.id),
    );
    await page.locator("#manage-categories").click();
    await page.locator(".category-row input").fill("Favorite novels");
    await page.locator(".category-row [type=submit]").click();
    await until(
      async () => (await api("/categories"))[0].name === "Favorite novels",
    );
    await screenshot("manage-categories-en");
    await page.locator("#categories-dialog .close-dialog").click();
    await language("ja");
    assert.equal(
      await page.locator("#question").getAttribute("placeholder"),
      "文書について質問…",
    );
    await screenshot("japanese");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1000, 700),
    );
    const overflow = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      composer: document.querySelector("#send").getBoundingClientRect().bottom,
      height: innerHeight,
    }));
    assert.ok(overflow.width <= overflow.viewport, JSON.stringify(overflow));
    assert.ok(overflow.composer <= overflow.height, JSON.stringify(overflow));
    // Hidden Electron windows stop painting after resize on Windows. Render the
    // same authenticated UI in headless Chromium for the compact screenshot.
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 1000, height: 700 },
      });
      const cookies = await app.evaluate(({ session }) =>
        session.defaultSession.cookies.get({}),
      );
      await context.addCookies(
        cookies.map((cookie) => ({
          name: cookie.name,
          value: cookie.value,
          url: page.url(),
          httpOnly: true,
          sameSite: "Strict",
        })),
      );
      const compact = await context.newPage();
      await compact.goto(page.url());
      await compact.waitForFunction(
        () =>
          document.documentElement.lang === "ja" &&
          document.querySelectorAll(".document-check:checked").length === 2,
      );
      await compact.screenshot({
        path: path.join(runDir, "japanese-compact.png"),
      });
      await compact.locator("#settings-button").click();
      await compact.locator("#settings-dialog").waitFor({ state: "visible" });
      await compact.screenshot({
        path: path.join(runDir, "japanese-settings.png"),
      });
    } finally {
      await browser.close();
    }
    const saved = await api("/preferences");
    await app.close();
    app = null;
    await launch();
    assert.equal(await page.locator("#language").inputValue(), "ja");
    assert.deepEqual((await api("/preferences")).scope, saved.scope);
    assert.equal(await page.locator(".document-check:checked").count(), 2);
    await language("zh-Hant");
    await screenshot("traditional-chinese");
    assert.equal(
      await page.locator("#question").getAttribute("placeholder"),
      "向你的文件提問…",
    );
    await page.locator("#manage-categories").click();
    await page.locator(".category-row [type=button]").click();
    await until(async () => (await api("/categories")).length === 0);
    const kept = await api("/documents");
    assert.equal(kept.length, 2);
    assert.ok(
      kept.every((d) => d.status === "ready" && d.category_id === null),
    );
    assert.equal(kept.find((d) => d.id === bookB.id).chunks, bookB.chunks);
    assert.deepEqual(errors, []);
    result.checks = [
      "three languages",
      "empty scope blocked",
      "category isolation",
      "multi-select and assignment",
      "rename/delete preserves indexes",
      "restart preferences",
      "compact viewport",
      ...(live
        ? [
            "live Qwen answer",
            "chapter citation",
            "conversation restores scope",
          ]
        : []),
    ];
    fs.writeFileSync(
      path.join(runDir, "result.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify({ ok: true, runDir, ...result }, null, 2));
  } catch (error) {
    if (page) await screenshot("failure").catch(() => {});
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (app) await app.close();
  }
})();
