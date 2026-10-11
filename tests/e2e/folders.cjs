/* Connected folders: subfolder import, updates, live monitoring, changes while closed, removal. */
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { flags, runDir, makeEpub, launch, waitApi, getJson, ask, report } = require("./harness.cjs");

const dir = runDir("folders");
const dataDir = path.join(dir, "library");
const source = path.join(dir, "My Books");
const fixture = path.join(source, "Research", "Orchid.epub");
const other = path.join(source, "Other.epub");
fs.mkdirSync(path.dirname(fixture), { recursive: true });
const errors = [];

/** Waits until `count` documents are ready, nothing is pending, and some EPUB chapter 2 contains `value`. */
async function waitLibrary(page, value, count = 1) {
  await waitApi(
    page,
    async ({ value, count }) => {
      const docs = await fetch("/api/documents").then((r) => r.json());
      const folders = await fetch("/api/folders").then((r) => r.json());
      if (docs.length !== count || docs.some((d) => d.status !== "ready") || folders.some((f) => f.files.some((x) => x.pending_id)))
        return false;
      for (const doc of docs.filter((d) => d.format === "epub")) {
        const section = await fetch(`/api/documents/${doc.id}/sections/2`).then((r) => r.json());
        if (section.text.includes(value)) return true;
      }
      return false;
    },
    { value, count },
  );
}

async function askBudget(page, value) {
  const answer = await ask(page, "Orchid 計劃預算是多少港元？請引用文件。");
  assert.ok(answer.replaceAll(",", "").includes(value), answer);
  await page.locator(".citation").first().click();
  await page.getByTestId("sources").getByRole("button", { name: /章節|chapter/i }).first().click();
  await page.getByRole("dialog").getByText(value, { exact: false }).first().waitFor();
  assert.equal(await page.locator("iframe").count(), 0);
  await page.screenshot({ path: path.join(dir, `chapter-${value}.png`) });
  await page.keyboard.press("Escape");
}

(async () => {
  makeEpub(fixture, "4200");
  let session = await launch(dataDir, errors);
  let { page } = session;
  try {
    await session.chooseFolder(source);
    await page.getByTestId("open-library").click();
    await page.getByTestId("connect-folder").click();
    await waitLibrary(page, "4200");
    const table = page.getByTestId("documents");
    await page.getByPlaceholder(/搜尋文件|Search documents/).fill("nothing matches");
    await table.getByText(/沒有符合名稱|No documents match/).waitFor();
    await page.getByPlaceholder(/搜尋文件|Search documents/).fill("orchid");
    await table.getByText("Orchid.epub").waitFor();
    await page.getByPlaceholder(/搜尋文件|Search documents/).fill("");
    if (flags.live) await askBudget(page, "4200");

    makeEpub(fixture, "7300"); // An update replaces the indexed version.
    await waitLibrary(page, "7300");
    if (flags.live) await askBudget(page, "7300");

    makeEpub(other, "9800"); // Monitoring finds a new file without a manual scan.
    await waitLibrary(page, "9800", 2);
    await page.getByTestId("open-library").click();
    await page.getByRole("tab", { name: /資料夾|Folders/ }).click();
    await page.getByText("My Books", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(dir, "folders.png") });

    const previousOrigin = session.origin;
    await session.close();
    await assert.rejects(fetch(previousOrigin + "/api/health"));
    makeEpub(fixture, "8600"); // Changes while the app is closed are imported after restart.
    session = await launch(dataDir, errors);
    page = session.page;
    await waitLibrary(page, "8600", 2);

    fs.unlinkSync(fixture); // Removing the original keeps the library copy.
    await waitApi(page, () => fetch("/api/folders").then((r) => r.json()).then((f) => f[0].files.some((x) => !x.present)), null, 40000);
    assert.equal((await getJson(page, "/api/documents")).length, 2);

    await page.getByTestId("open-library").click();
    await page.getByRole("tab", { name: /資料夾|Folders/ }).click();
    await page.getByRole("button", { name: /停止連接|Disconnect/ }).click();
    await page.getByText("My Books", { exact: true }).waitFor({ state: "detached" });
    assert.equal((await getJson(page, "/api/documents")).length, 2);
    assert.ok(fs.existsSync(other));
    assert.deepEqual(errors, []);
    report(dir, "folders", { errors });
  } finally {
    await session.close().catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
