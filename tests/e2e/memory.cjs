/* Embedding idle release with real llama-server processes. Needs models in models/. */
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { runDir, makeEpub, launch, waitApi, getJson, ask, report } = require("./harness.cjs");

const dir = runDir("memory");
const dataDir = path.join(dir, "library");
const fixture = path.join(dir, "Orchid.epub");
makeEpub(fixture, "4200");
const errors = [];

/** Command lines of running llama-server processes (the model path shows the role). */
const servers = () =>
  execFileSync(
    "powershell",
    ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\" | ForEach-Object { $_.CommandLine }"],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

async function loaded(page, type) {
  const [models, settings] = await Promise.all([getJson(page, "/api/models"), getJson(page, "/api/settings")]);
  const id = type === "embedding" ? settings.embedding_model : settings.model;
  return models.catalog.find((m) => m.id === id)?.loaded === true;
}

async function until(page, type, expected, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await loaded(page, type)) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${type} model did not become ${expected ? "loaded" : "released"}`);
}

async function setIdleRelease(page, release) {
  await page.getByRole("button", { name: /設定|Settings/ }).last().click();
  await page.locator("select").filter({ has: page.locator('option[value="false"]') }).selectOption(String(release));
  await page.getByTestId("save-settings").click();
  await page.getByTestId("save-settings").waitFor({ state: "detached" });
}

(async () => {
  assert.deepEqual(servers(), [], "Close other llama-server processes first");
  let session = await launch(dataDir, errors);
  let { page } = session;
  try {
    await page.getByTestId("file-input").setInputFiles(fixture);
    await waitApi(page, () => fetch("/api/documents").then((r) => r.json()).then((d) => d[0]?.status === "ready"), null, 120000);
    assert.ok(await loaded(page, "embedding"));
    await until(page, "embedding", false, 45000);
    assert.deepEqual(servers(), []);

    const answer = await ask(page, "Orchid 計劃預算是多少港元？請引用文件。");
    assert.ok(answer.replaceAll(",", "").includes("4200"), answer);
    assert.ok(await loaded(page, "embedding"), "Search reloads the embedding model");
    assert.ok(await loaded(page, "chat"));
    await until(page, "embedding", false, 45000);
    assert.ok(await loaded(page, "chat"), "Idle release leaves the answer model loaded");

    await setIdleRelease(page, false);
    await ask(page, "Orchid 計劃預算是多少？");
    await new Promise((resolve) => setTimeout(resolve, 35000));
    assert.ok(await loaded(page, "embedding"), "Keep-loaded preference is honored");

    await session.close();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.deepEqual(servers(), [], "Closing the app stops every llama-server");
    session = await launch(dataDir, errors);
    page = session.page;
    assert.equal((await getJson(page, "/api/settings")).embedding_idle_unload, false);
    assert.deepEqual(errors, []);
    report(dir, "memory", { answer, errors });
  } finally {
    await session.close().catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
