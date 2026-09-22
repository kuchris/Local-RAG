const { packager } = require("@electron/packager");
const path = require("node:path");
const fs = require("node:fs");
const root = path.resolve(__dirname, "..");
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
    /^\/(data|artifacts|tests|dist|\.git|\.venv|__pycache__|\.pytest_cache)(\/|$)/,
    /__pycache__/,
  ],
  prune: true,
})
  .then((paths) => console.log(paths.join("\n")))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
