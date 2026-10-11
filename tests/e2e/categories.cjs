/* Categories, scope rules, fiction mode, the three interface languages and the compact window. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { root, flags, runDir, launch, waitApi, getJson, report } = require("./harness.cjs");

const dir = runDir("categories");
const dataDir = path.join(dir, "library");
const fixtures = ["Novel-A.epub", "Novel-B.epub"].map((name) => path.join(dir, name));
execFileSync(path.join(root, ".venv", "Scripts", "python.exe"), [
  "-c",
  `
import io, sys, zipfile
from pathlib import Path
for file, item in zip(sys.argv[1:], ['silver key', 'red compass']):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as book:
        book.writestr('mimetype', 'application/epub+zip')
        book.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>')
        book.writestr('book.opf', '<package><manifest><item id="one" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>')
        book.writestr('chapter.xhtml', f'<html><body><h1>Chapter One</h1><p>Mira stood at the east gate. Orchid gave her a {item}. Mira placed the {item} in her pocket before walking home. This chapter does not describe her final destination or the ending.</p></body></html>')
    Path(file).write_bytes(output.getvalue())
`,
  ...fixtures,
]);
const errors = [];
const result = {};

async function setLanguage(page, value) {
  await page.getByRole("button", { name: /設定|Settings/ }).last().click();
  await page.getByRole("tab").nth(2).click();
  await page.getByTestId("language").selectOption(value);
  await page.waitForFunction((value) => document.documentElement.lang === value, value);
  await page.keyboard.press("Escape");
}

/** No CJK text may remain in English UI copy (document names here are ASCII). */
async function assertEnglish(locator) {
  const remaining = await locator.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const found = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest("[data-testid=language],script,style")) continue;
      if (/[぀-ヿ㐀-鿿]/.test(node.textContent)) found.push(node.textContent.trim());
    }
    return found;
  });
  assert.deepEqual(remaining, []);
}

async function chooseScope(page, name) {
  await page.getByTestId("scope-trigger").click();
  await page.getByRole("dialog").getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.keyboard.press("Escape");
}

(async () => {
  let session = await launch(dataDir, errors);
  let { page } = session;
  try {
    await setLanguage(page, "en");
    await assertEnglish(page.locator("body"));
    await page.getByRole("button", { name: "Settings" }).last().click();
    await assertEnglish(page.getByRole("dialog"));
    assert.equal(await page.getByTestId("answer-model").inputValue(), "Qwen3.5-9B-Q4_K_M");
    await page.keyboard.press("Escape");

    await page.getByTestId("file-input").setInputFiles(fixtures);
    await waitApi(page, () => fetch("/api/documents").then((r) => r.json()).then((d) => d.length === 2 && d.every((x) => x.status === "ready")));
    const docs = await getJson(page, "/api/documents");
    const bookA = docs.find((d) => d.name === "Novel-A.epub");
    const bookB = docs.find((d) => d.name === "Novel-B.epub");

    await page.getByTestId("open-library").click();
    await page.getByRole("tab", { name: "Categories" }).click();
    await page.getByPlaceholder("New category name").fill("Series A");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await waitApi(page, () => fetch("/api/categories").then((r) => r.json()).then((c) => c.length === 1));
    const category = (await getJson(page, "/api/categories"))[0];
    await page.getByRole("tab", { name: "Documents" }).click();
    await page.getByRole("checkbox", { name: "Novel-A.epub" }).click();
    await page.getByTestId("move-to").selectOption(category.id);
    await waitApi(page, ([doc, id]) => fetch("/api/documents").then((r) => r.json()).then((d) => d.find((x) => x.id === doc).category_id === id), [bookA.id, category.id]);
    await assertEnglish(page.locator("body"));

    await page.getByTestId("new-chat").click();
    await chooseScope(page, "Series A");
    await page.getByRole("radio", { name: "Fiction" }).click();
    await waitApi(page, (id) =>
      fetch("/api/preferences").then((r) => r.json()).then((p) => p.scope.reading_mode === "fiction" && p.scope.document_ids === null && p.scope.category_id === id),
      category.id,
    );
    await page.screenshot({ path: path.join(dir, "category-fiction-en.png") });

    // An empty selection never expands to every document.
    await page.getByTestId("scope-trigger").click();
    await page.getByRole("dialog").getByRole("button", { name: "Clear" }).click();
    await page.keyboard.press("Escape");
    await page.getByTestId("question").fill("What did Orchid give Mira?");
    await page.getByTestId("send").click();
    await page.getByRole("status").getByText(/No processed documents/).waitFor();
    assert.equal(await page.getByTestId("answer").count(), 0);
    await chooseScope(page, "Series A");

    if (flags.live) {
      await page.getByTestId("send").click();
      await page.getByTestId("show-sources").waitFor({ timeout: 180000 });
      result.answer = await page.getByTestId("answer").locator(".answer").textContent();
      assert.match(result.answer, /silver key/i);
      assert.doesNotMatch(result.answer, /red compass/i);
      const conversation = (await getJson(page, "/api/conversations"))[0].id;
      const messages = await getJson(page, "/api/conversations/" + conversation);
      assert.ok(messages[1].sources.length);
      assert.ok(messages[1].sources.every((s) => s.document_id === bookA.id));
      await page.locator(".citation").first().click();
      await page.getByTestId("sources").getByRole("button", { name: "Open chapter" }).first().click();
      await page.getByRole("dialog").getByText(/silver key/).first().waitFor();
      await page.keyboard.press("Escape");
      await page.screenshot({ path: path.join(dir, "fiction-answer-en.png") });
      // Changing scope starts a new chat; reopening the chat restores its scope.
      await chooseScope(page, "All documents");
      assert.equal(await page.getByTestId("answer").count(), 0);
      await page.getByTestId("conversations").getByRole("button").first().click();
      await page.getByTestId("answer").waitFor();
      const scope = (await getJson(page, "/api/preferences")).scope;
      assert.equal(scope.category_id, category.id);
      assert.equal(scope.reading_mode, "fiction");
    }

    await page.getByTestId("open-library").click();
    await page.getByRole("checkbox", { name: "Select all" }).click();
    await page.getByTestId("move-to").selectOption(category.id);
    await waitApi(page, (id) => fetch("/api/documents").then((r) => r.json()).then((d) => d.every((x) => x.category_id === id)), category.id);
    await page.getByRole("tab", { name: "Categories" }).click();
    await page.locator("form input[value='Series A']").fill("Favorite novels");
    await page.getByRole("button", { name: "Rename" }).click();
    await waitApi(page, () => fetch("/api/categories").then((r) => r.json()).then((c) => c[0].name === "Favorite novels"));
    await page.screenshot({ path: path.join(dir, "categories-en.png") });

    await setLanguage(page, "ja");
    await page.getByTestId("new-chat").click();
    assert.equal(await page.getByTestId("question").getAttribute("placeholder"), "文書に質問…");
    await session.resize(1000, 700);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      composer: document.querySelector("[data-testid=composer]").getBoundingClientRect().bottom,
      height: innerHeight,
    }));
    assert.ok(overflow.width <= overflow.viewport, JSON.stringify(overflow));
    assert.ok(overflow.composer <= overflow.height, JSON.stringify(overflow));
    await page.screenshot({ path: path.join(dir, "japanese-compact.png") });

    const saved = await getJson(page, "/api/preferences");
    await session.close();
    session = await launch(dataDir, errors);
    page = session.page;
    await page.waitForFunction(() => document.documentElement.lang === "ja");
    assert.deepEqual((await getJson(page, "/api/preferences")).scope, saved.scope);
    await setLanguage(page, "zh-Hant");
    assert.equal(await page.getByTestId("question").getAttribute("placeholder"), "詢問你的文件…");
    await page.getByTestId("open-library").click();
    await page.getByRole("tab", { name: "分類" }).click();
    await page.getByRole("button", { name: "移除" }).click();
    await waitApi(page, () => fetch("/api/categories").then((r) => r.json()).then((c) => c.length === 0));
    const kept = await getJson(page, "/api/documents");
    assert.equal(kept.length, 2);
    assert.ok(kept.every((d) => d.status === "ready" && d.category_id === null));
    assert.equal(kept.find((d) => d.id === bookB.id).chunks, bookB.chunks);
    assert.deepEqual(errors, []);
    report(dir, "categories", { ...result, errors });
  } finally {
    await session.close().catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
