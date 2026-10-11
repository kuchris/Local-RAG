import { BookOpen, Check, ChevronDown, FileText, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@/i18n";
import { useCategories, useDocuments } from "@/lib/queries";
import { categoryName, inCategory, scopeLabel } from "@/lib/scope";
import { useApp } from "@/lib/store";
import { UNCATEGORIZED } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Checkbox, Popover, PopoverContent, PopoverTrigger } from "./ui/misc";

export function ScopePicker() {
  const t = useT();
  const app = useApp();
  const documents = useDocuments().data ?? [];
  const categories = useCategories().data ?? [];
  const [filter, setFilter] = useState("");
  const { scope } = app;
  const pool = inCategory(documents, scope.category_id);
  const visible = useMemo(
    () => pool.filter((d) => d.name.toLocaleLowerCase().includes(filter.toLocaleLowerCase())),
    [pool, filter],
  );
  const selected = new Set(scope.document_ids ?? []);

  const groups = [
    { id: null, name: t("scope.all"), count: documents.length },
    { id: UNCATEGORIZED, name: t("scope.uncategorized"), count: documents.filter((d) => !d.category_id).length },
    ...categories.map((c) => ({ id: c.id, name: c.name, count: c.count })),
  ];
  if (scope.category_id && !groups.some((g) => g.id === scope.category_id))
    groups.push({ id: scope.category_id, name: categoryName(scope.category_id, categories, t), count: 0 });

  function toggle(id: string, on: boolean) {
    const ids = new Set(scope.document_ids ?? []);
    if (on) ids.add(id);
    else ids.delete(id);
    app.changeScope({ document_ids: [...ids] });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="scope-trigger"
          className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-8 max-w-64 items-center gap-1.5 rounded-lg px-2 text-xs font-medium"
        >
          <BookOpen className="size-3.5 shrink-0" />
          <span className="truncate">{scopeLabel(scope, documents, categories, t)}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="flex h-[min(26rem,70vh)] w-[min(36rem,calc(100vw-2rem))] overflow-hidden">
        <div className="bg-sidebar w-44 shrink-0 overflow-y-auto border-r p-1.5">
          <div className="text-muted-foreground px-2 pt-1.5 pb-1 text-xs font-medium">{t("scope.categories")}</div>
          {groups.map((group) => {
            const active = scope.category_id === group.id;
            return (
              <button
                key={group.id ?? "all"}
                disabled={app.busy}
                onClick={() => app.changeScope({ category_id: group.id, document_ids: null })}
                className={cn(
                  "hover:bg-muted flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                  active && "bg-muted font-medium",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="text-muted-foreground text-xs">{group.count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t("scope.filter")}
                className="placeholder:text-muted-foreground h-8 w-full rounded-md bg-transparent pr-2 pl-8 text-sm outline-none"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            <button
              disabled={app.busy}
              onClick={() => app.changeScope({ document_ids: null })}
              className="hover:bg-muted flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm"
            >
              <span className="flex size-4 items-center justify-center">
                {scope.document_ids === null && <Check className="size-4" />}
              </span>
              <span className="font-medium">{t("scope.whole", { count: pool.length })}</span>
            </button>
            {visible.map((doc) => (
              <label
                key={doc.id}
                className={cn(
                  "hover:bg-muted flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
                  doc.status !== "ready" && "opacity-60",
                )}
                title={doc.name}
              >
                <Checkbox
                  checked={selected.has(doc.id)}
                  disabled={app.busy}
                  onCheckedChange={(value) => toggle(doc.id, value === true)}
                />
                <FileText className="text-muted-foreground size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{doc.name}</span>
              </label>
            ))}
            {!visible.length && <p className="text-muted-foreground px-2 py-3 text-xs">{t("library.noMatches")}</p>}
          </div>
          <div className="text-muted-foreground flex items-center justify-between gap-2 border-t px-3 py-2 text-xs">
            <span>{t("scope.newChatNote")}</span>
            <span className="flex shrink-0 gap-3">
              <button
                className="hover:text-foreground"
                disabled={app.busy}
                onClick={() => app.changeScope({ document_ids: visible.map((d) => d.id) })}
              >
                {t("scope.selectVisible")}
              </button>
              <button className="hover:text-foreground" disabled={app.busy} onClick={() => app.changeScope({ document_ids: [] })}>
                {t("scope.clear")}
              </button>
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
