const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { flags, runDir, makePdf, launch, waitApi, getJson, ask, report } = require("./harness.cjs");

const dir = runDir("smoke");
const dataDir = path.join(dir, "library");
const fixture = path.join(dir, "Fictional-timers.pdf");
makePdf(fixture);
const errors = [];

(async () => {
  let session = await launch(dataDir, errors);
  let { page } = session;
  try {
    if (!flags.browser) assert.equal(await page.evaluate(() => typeof window.require), "undefined");
    assert.equal((await fetch(session.origin + "/api/health")).status, 401);
    await page.screenshot({ path: path.join(dir, "01-welcome.png") });

    await page.getByTestId("file-input").setInputFiles(fixture);
    await page.getByTestId("open-library").click();
    await page.getByTestId("documents").getByText("Fictional-timers.pdf").waitFor();
    await waitApi(page, () => fetch("/api/documents").then((r) => r.json()).then((d) => d[0]?.status === "ready"), null, 240000);
    const docs = await getJson(page, "/api/documents");
    assert.equal(docs.length, 1);
    assert.ok(docs[0].pages > 0 && docs[0].chunks > 0, JSON.stringify(docs));

    // Re-importing the same bytes is detected as a duplicate.
    await page.getByTestId("file-input").setInputFiles(fixture);
    await page.getByRole("status").getByText("Fictional-timers.pdf").waitFor();
    assert.equal((await getJson(page, "/api/documents")).length, 1);

    // Selecting a document in the library narrows the question scope.
    await page.getByRole("checkbox", { name: "Fictional-timers.pdf" }).click();
    await page.getByTestId("selection-bar").getByRole("button").first().click();
    await page.getByTestId("scope-trigger").getByText("Fictional-timers.pdf").waitFor();
    await waitApi(page, (id) => fetch("/api/preferences").then((r) => r.json()).then((p) => p.scope.document_ids?.[0] === id), docs[0].id, 5000);

    await page.getByRole("button", { name: /設定|Settings/ }).last().click();
    await page.getByRole("tab", { name: /回答|Answers/ }).click();
    await page.getByRole("spinbutton").first().fill("4");
    await page.getByTestId("save-settings").click();
    await page.getByTestId("save-settings").waitFor({ state: "detached" });
    assert.equal((await getJson(page, "/api/settings")).top_k, 4);

    if (flags.live) {
      const answer = await ask(page, "What delays were measured for Timer A and Timer B? Include uncertainties and cite the source.");
      for (const value of ["7.4", "12.8", "0.3", "0.5"]) assert.ok(answer.includes(value), answer);
      assert.ok((await page.locator(".citation").count()) > 0, "Missing citations");
      await page.screenshot({ path: path.join(dir, "02-answer.png") });
      await page.locator(".citation").first().click();
      await page.getByTestId("sources").getByRole("button", { name: /PDF/ }).first().click();
      assert.ok((await page.locator("iframe").getAttribute("src")).includes("#page="));
      await page.screenshot({ path: path.join(dir, "03-pdf.png") });
      await page.keyboard.press("Escape");
      fs.writeFileSync(path.join(dir, "answer.txt"), answer);
      const chinese = await ask(page, "文件中 Timer A 和 Timer B 的延遲各是多少？請附上誤差值及引用。");
      for (const value of ["7.4", "12.8", "0.3", "0.5"]) assert.ok(chinese.includes(value), chinese);
      fs.writeFileSync(path.join(dir, "answer-zh.txt"), chinese);
    }

    const previousOrigin = session.origin;
    await session.close();
    await assert.rejects(fetch(previousOrigin + "/api/health"));
    session = await launch(dataDir, errors);
    page = session.page;
    assert.equal((await getJson(page, "/api/settings")).top_k, 4);
    if (flags.live) {
      await page.getByTestId("conversations").getByRole("button").first().click();
      await page.locator(".citation").first().waitFor();
    }

    await page.getByTestId("open-library").click();
    await page.getByRole("checkbox", { name: "Fictional-timers.pdf" }).click();
    await page.getByTestId("selection-bar").getByRole("button", { name: /刪除|Delete/ }).click();
    await page.getByTestId("confirm-delete").click();
    await page.getByTestId("documents").getByText("Fictional-timers.pdf").waitFor({ state: "detached" });
    assert.equal((await getJson(page, "/api/documents")).length, 0);
    await session.close();
    session = await launch(dataDir, errors);
    assert.equal((await getJson(session.page, "/api/documents")).length, 0);
    assert.deepEqual(errors, []);
    report(dir, "smoke", { errors });
  } finally {
    await session.close().catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
