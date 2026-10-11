const { packager } = require("@electron/packager");
const path = require("node:path");
const fs = require("node:fs");
const root = path.resolve(__dirname, "..");
if (!fs.existsSync(path.join(root, "bin", "llama", "llama-server.exe"))) {
  throw new Error("Run setup.ps1 first to download llama.cpp into bin\llama.");
}
if (!fs.existsSync(path.join(root, "runtime", "python.exe"))) {
  throw new Error(
    "Run .venv\\Scripts\\python.exe scripts\\prepare_runtime.py first.",
  );
}
packager({
  dir: root,
  name: "Local-RAG",
  platform: "win32",
  arch: "x64",
  out: path.join(root, "dist"),
  overwrite: true,
  asar: false,
  ignore: [
    // The Electron main process only needs built-in modules; the UI is bundled into frontend/dist.
    /^\/(data|models|artifacts|tests|dist|docs|node_modules|\.claude|\.git|\.venv|__pycache__|\.pytest_cache)(\/|$)/,
    /^\/frontend\/(?!dist(\/|$))/,
    /__pycache__/,
  ],
  prune: true,
})
  .then((paths) => console.log(paths.join("\n")))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
