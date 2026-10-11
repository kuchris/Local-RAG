import { useT } from "@/i18n";
import { api } from "./api";
import { useRefreshLibrary } from "./queries";
import { useApp } from "./store";

/** File and folder import actions shared by the library toolbar and the drop overlay. */
export function useImports() {
  const t = useT();
  const app = useApp();
  const refresh = useRefreshLibrary();

  async function upload(files: Iterable<File>) {
    for (const file of files) {
      try {
        const form = new FormData();
        form.append("file", file);
        const result = await api<{ duplicate?: boolean }>("/documents", { method: "POST", body: form });
        app.notify(t(result.duplicate ? "library.duplicate" : "library.queued", { name: file.name }));
      } catch (error) {
        app.report(error);
      }
    }
    await refresh();
  }

  async function addFiles() {
    if (!window.desktop) return document.getElementById("file-input")?.click();
    try {
      const results = await window.desktop.chooseDocuments(app.language);
      if (results.length) app.notify(t(results.every((r) => r.duplicate) ? "library.allDuplicates" : "library.queuedMany"));
      await refresh();
    } catch (error) {
      app.report(error);
    }
  }

  async function connectFolder() {
    if (!window.desktop) return app.notify(t("folders.needDesktop"));
    try {
      if (!(await window.desktop.chooseFolder(app.language))) return;
      app.notify(t("folders.connected"));
      await refresh();
    } catch (error) {
      app.report(error);
    }
  }

  return { upload, addFiles, connectFolder };
}
