import { AlertCircle, FolderPlus, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Checkbox, Progress, Tabs } from "@/components/ui/misc";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { useImports } from "@/lib/imports";
import { useCategories, useDocuments, useFolders, useRefreshLibrary } from "@/lib/queries";
import { categoryName, inCategory } from "@/lib/scope";
import { useApp } from "@/lib/store";
import { UNCATEGORIZED, type Document, type Folder } from "@/lib/types";
import { cn, folderName } from "@/lib/utils";

export function LibraryView() {
  const t = useT();
  const imports = useImports();
  const [tab, setTab] = useState("documents");
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 px-6">
        <h1 className="text-sm font-semibold">{t("nav.library")}</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={imports.connectFolder} data-testid="connect-folder">
            <FolderPlus />
            {t("library.connectFolder")}
          </Button>
          <Button size="sm" variant="primary" onClick={imports.addFiles} data-testid="add-files">
            <Plus />
            {t("library.addFiles")}
          </Button>
        </div>
      </header>
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="min-h-0 flex-1 px-6"
        tabs={[
          { value: "documents", label: t("library.tabDocuments"), content: <DocumentsTab /> },
          { value: "folders", label: t("library.tabFolders"), content: <FoldersTab /> },
          { value: "categories", label: t("library.tabCategories"), content: <CategoriesTab /> },
        ]}
      />
    </div>
  );
}

function statusOf(doc: Document, t: ReturnType<typeof useT>) {
  if (doc.status === "ready") return t("library.statusReady");
  if (doc.status === "error") return t("library.statusError");
  if (doc.status === "queued") return t("library.statusQueued");
  return doc.error ? t.server(doc.error) : t("library.statusProcessing", { progress: doc.progress });
}

function DocumentsTab() {
  const t = useT();
  const app = useApp();
  const refresh = useRefreshLibrary();
  const documents = useDocuments().data ?? [];
  const categories = useCategories().data ?? [];
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<Document[] | null>(null);

  const visible = useMemo(
    () =>
      inCategory(documents, category || null).filter((d) =>
        d.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
      ),
    [documents, category, filter],
  );
  const chosen = documents.filter((d) => selected.has(d.id));
  const allVisible = visible.length > 0 && visible.every((d) => selected.has(d.id));

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function move(target: string) {
    try {
      await api("/document-categories", {
        method: "PUT",
        body: { document_ids: chosen.map((d) => d.id), category_id: target || null },
      });
      await refresh();
      app.notify(t("library.categoryUpdated"));
    } catch (error) {
      app.report(error);
    }
  }

  async function retry(id: string) {
    try {
      await api(`/documents/${id}/retry`, { method: "POST" });
      await refresh();
    } catch (error) {
      app.report(error);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    if (app.busy) return app.notify(t("scope.busy"));
    for (const doc of deleting) {
      try {
        await api(`/documents/${doc.id}`, { method: "DELETE" });
        toggle(doc.id, false);
      } catch (error) {
        app.report(error);
      }
    }
    setDeleting(null);
    await refresh();
    if (app.conversationId) await app.openConversation(app.conversationId);
    app.notify(t("library.deleted"));
  }

  function ask() {
    if (app.changeScope({ category_id: null, document_ids: chosen.map((d) => d.id) })) app.setView("chat");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 py-3">
        <div className="relative w-64">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("library.search")} className="pl-8" />
        </div>
        <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} className="w-48" aria-label={t("library.colCategory")}>
          <option value="">{t("library.allCategories")}</option>
          <option value={UNCATEGORIZED}>{t("scope.uncategorized")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.count})
            </option>
          ))}
        </NativeSelect>
        {chosen.length > 0 && (
          <div className="bg-muted ml-auto flex items-center gap-2 rounded-lg py-1 pr-1 pl-3 text-sm" data-testid="selection-bar">
            <span className="font-medium">{t("library.selected", { count: chosen.length })}</span>
            <NativeSelect
              value="__"
              onChange={(e) => move(e.target.value)}
              className="bg-background h-8 w-40"
              aria-label={t("library.moveTo")}
              data-testid="move-to"
            >
              <option value="__" disabled>
                {t("library.moveTo")}
              </option>
              <option value="">{t("scope.uncategorized")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <Button size="sm" onClick={ask} className="bg-background">
              {t("library.askSelected")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={() => setDeleting(chosen.filter((d) => !["queued", "processing"].includes(d.status)))}
            >
              <Trash2 />
              {t("library.delete")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              {t("library.clearSelection")}
            </Button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border" data-testid="documents">
        {!documents.length ? (
          <p className="text-muted-foreground p-10 text-center text-sm">{t("library.empty")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-sidebar text-muted-foreground sticky top-0 z-10 text-left text-xs">
              <tr className="border-b">
                <th className="w-10 py-2.5 pl-4">
                  <Checkbox
                    checked={allVisible ? true : visible.some((d) => selected.has(d.id)) ? "indeterminate" : false}
                    onCheckedChange={(on) => visible.forEach((d) => toggle(d.id, on === true))}
                    aria-label={t("library.selectAll")}
                  />
                </th>
                <th className="py-2.5 font-medium">{t("library.colName")}</th>
                <th className="w-48 py-2.5 font-medium">{t("library.colStatus")}</th>
                <th className="w-40 py-2.5 font-medium">{t("library.colCategory")}</th>
                <th className="w-44 py-2.5 font-medium">{t("library.colSize")}</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {visible.map((doc) => (
                <tr key={doc.id} className={cn("group hover:bg-muted/50 border-b last:border-0", selected.has(doc.id) && "bg-muted/60")}>
                  <td className="py-2.5 pl-4">
                    <Checkbox checked={selected.has(doc.id)} onCheckedChange={(on) => toggle(doc.id, on === true)} aria-label={doc.name} />
                  </td>
                  <td className="max-w-0 py-2.5 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground rounded border px-1 text-[10px] font-medium uppercase">{doc.format}</span>
                      <span className="truncate" title={doc.name}>
                        {doc.name}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-4">
                    {doc.status === "error" ? (
                      <div className="flex items-center gap-2">
                        <span className="text-danger flex min-w-0 items-center gap-1" title={t.server(doc.error ?? "")}>
                          <AlertCircle className="size-3.5 shrink-0" />
                          <span className="truncate">{t("library.statusError")}</span>
                        </span>
                        <button className="text-accent text-xs font-medium hover:underline" onClick={() => retry(doc.id)}>
                          {t("library.retry")}
                        </button>
                      </div>
                    ) : doc.status === "ready" ? (
                      <span className="text-muted-foreground">{statusOf(doc, t)}</span>
                    ) : (
                      <div className="space-y-1">
                        <div className="text-muted-foreground truncate text-xs">{statusOf(doc, t)}</div>
                        <Progress value={doc.progress} />
                      </div>
                    )}
                  </td>
                  <td className="text-muted-foreground max-w-0 truncate py-2.5 pr-4">
                    {categoryName(doc.category_id ?? UNCATEGORIZED, categories, t)}
                  </td>
                  <td className="text-muted-foreground py-2.5 pr-4">
                    {doc.status === "ready" &&
                      t(doc.format === "epub" ? "library.sections" : "library.pages", { pages: doc.pages, chunks: doc.chunks })}
                  </td>
                  <td className="pr-2">
                    {!["queued", "processing"].includes(doc.status) && (
                      <button
                        className="text-muted-foreground hover:text-danger invisible rounded-md p-1.5 group-hover:visible"
                        aria-label={t("library.delete")}
                        title={t("library.delete")}
                        onClick={() => setDeleting([doc])}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {documents.length > 0 && !visible.length && (
          <p className="text-muted-foreground p-8 text-center text-sm">{t("library.noMatches")}</p>
        )}
      </div>
      <div className="h-4 shrink-0" />
      <Dialog
        open={!!deleting?.length}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={
          deleting?.length === 1
            ? t("library.deleteTitle", { name: deleting[0].name })
            : t("library.deleteManyTitle", { count: deleting?.length ?? 0 })
        }
        description={t("library.deleteBody")}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>{t("library.cancel")}</Button>
            <Button variant="danger" onClick={confirmDelete} data-testid="confirm-delete">
              {t("library.delete")}
            </Button>
          </>
        }
      />
    </div>
  );
}

function folderStatus(folder: Folder, t: ReturnType<typeof useT>) {
  const errors = folder.files.filter((f) => f.error || f.status === "error");
  const pending = folder.files.filter((f) => f.status === "queued" || f.status === "processing");
  if (folder.error) return { tone: "error", text: t("folders.inaccessible"), errors };
  if (errors.length) return { tone: "error", text: t("folders.errors", { count: errors.length }), errors };
  if (pending.length) return { tone: "busy", text: t("folders.pending", { count: pending.length }), errors };
  if (folder.scanning) return { tone: "busy", text: t("folders.scanning"), errors };
  return { tone: "ok", text: t("folders.ok", { count: folder.files.filter((f) => f.document_id).length }), errors };
}

function FoldersTab() {
  const t = useT();
  const app = useApp();
  const imports = useImports();
  const refresh = useRefreshLibrary();
  const folders = useFolders().data ?? [];

  async function scan() {
    try {
      await api("/folders/scan", { method: "POST" });
      app.notify(t("folders.scanQueued"));
    } catch (error) {
      app.report(error);
    }
  }

  async function disconnect(id: string) {
    try {
      await api(`/folders/${id}`, { method: "DELETE" });
      await refresh();
      app.notify(t("folders.disconnected"));
    } catch (error) {
      app.report(error);
    }
  }

  if (!folders.length)
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="text-muted-foreground max-w-md text-sm">{t("folders.empty")}</p>
        <Button onClick={imports.connectFolder}>
          <FolderPlus />
          {t("library.connectFolder")}
        </Button>
      </div>
    );

  return (
    <div className="h-full overflow-y-auto py-3">
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={scan}>
          <RefreshCw />
          {t("folders.scan")}
        </Button>
      </div>
      <div className="space-y-3 pb-4">
        {folders.map((folder) => {
          const status = folderStatus(folder, t);
          const missing = folder.files.filter((f) => !f.present).length;
          return (
            <section key={folder.id} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="font-medium">{folderName(folder.path)}</h3>
                  <p className="text-muted-foreground truncate text-xs" title={folder.path}>
                    {folder.path}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => disconnect(folder.id)} title={t("folders.disconnectNote")}>
                  {t("folders.disconnect")}
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      status.tone === "ok" ? "bg-emerald-500" : status.tone === "busy" ? "bg-amber-500" : "bg-danger",
                    )}
                  />
                  {status.text}
                </span>
                {folder.last_scan && (
                  <span className="text-muted-foreground text-xs">
                    {t("folders.lastScan", { time: new Date(folder.last_scan * 1000).toLocaleTimeString() })}
                  </span>
                )}
              </div>
              {folder.error && <p className="text-danger mt-2 text-xs">{t.server(folder.error)}</p>}
              {missing > 0 && <p className="text-muted-foreground mt-2 text-xs">{t("folders.missing", { count: missing })}</p>}
              {status.errors.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {status.errors.map((file) => {
                    const id = file.pending_id || file.document_id;
                    return (
                      <li key={file.path} className="bg-muted flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-xs">
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{file.path}</span>
                          <span className="text-danger">{t.server(file.error || file.import_error || "")}</span>
                        </span>
                        {file.status === "error" && id && (
                          <button
                            className="text-accent shrink-0 font-medium hover:underline"
                            onClick={() => api(`/documents/${id}/retry`, { method: "POST" }).then(refresh).catch(app.report)}
                          >
                            {t("library.retry")}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function CategoriesTab() {
  const t = useT();
  const app = useApp();
  const refresh = useRefreshLibrary();
  const categories = useCategories().data ?? [];
  const [name, setName] = useState("");

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await refresh();
    } catch (error) {
      app.report(error);
    }
  }

  return (
    <div className="h-full max-w-2xl overflow-y-auto py-4">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => api("/categories", { method: "POST", body: { name } })).then(() => setName(""));
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("categories.new")} maxLength={80} required />
        <Button type="submit" variant="primary">
          {t("categories.add")}
        </Button>
      </form>
      <p className="text-muted-foreground mt-2 text-xs">{t("categories.note")}</p>
      <div className="mt-4 divide-y rounded-xl border">
        {categories.map((category) => (
          <CategoryRow
            key={category.id + category.name}
            name={category.name}
            count={category.count}
            onRename={(value) => run(() => api(`/categories/${category.id}`, { method: "PUT", body: { name: value } }))}
            onRemove={() => {
              if (app.busy) return app.notify(t("scope.busy"));
              run(async () => {
                await api(`/categories/${category.id}`, { method: "DELETE" });
                if (app.scope.category_id === category.id) app.changeScope({ category_id: UNCATEGORIZED, document_ids: null });
              });
            }}
          />
        ))}
        {!categories.length && <p className="text-muted-foreground p-6 text-center text-sm">{t("categories.empty")}</p>}
      </div>
    </div>
  );
}

function CategoryRow({ name, count, onRename, onRemove }: { name: string; count: number; onRename(value: string): void; onRemove(): void }) {
  const t = useT();
  const [value, setValue] = useState(name);
  return (
    <form
      className="flex items-center gap-2 px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault();
        onRename(value);
      }}
    >
      <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={80} required className="border-transparent hover:border-input" />
      <span className="text-muted-foreground w-20 shrink-0 text-right text-xs">{t("categories.count", { count })}</span>
      {value !== name && (
        <Button size="sm" type="submit">
          {t("categories.rename")}
        </Button>
      )}
      <Button size="sm" variant="ghost" className="text-danger" onClick={onRemove}>
        {t("categories.remove")}
      </Button>
    </form>
  );
}
