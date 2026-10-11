import { ArrowUpRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { sourceLocation } from "@/lib/scope";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

export function SourcesPanel() {
  const t = useT();
  const app = useApp();
  const list = useRef<HTMLDivElement>(null);
  const focus = app.sources?.focus ?? null;

  useEffect(() => {
    if (focus !== null) list.current?.querySelector(`[data-source="${focus}"]`)?.scrollIntoView({ block: "nearest" });
  }, [focus, app.sources]);

  if (!app.sources) return null;
  return (
    <aside className="bg-sidebar flex w-80 shrink-0 flex-col border-l xl:w-[22rem]" data-testid="sources">
      <div className="flex h-12 shrink-0 items-center justify-between px-4">
        <span className="text-sm font-semibold">
          {t("sources.title")} <span className="text-muted-foreground font-normal">{app.sources.list.length}</span>
        </span>
        <Button variant="ghost" size="iconSm" onClick={app.hideSources} aria-label={t("sources.close")} title={t("sources.close")}>
          <X />
        </Button>
      </div>
      <div ref={list} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {app.sources.list.map((source) => (
          <article
            key={source.id}
            data-source={source.id}
            className={cn("bg-background rounded-xl border p-3 transition-colors", focus === source.id && "border-accent ring-accent/30 ring-2")}
          >
            <div className="flex items-start gap-2">
              <span className="bg-accent-soft text-accent flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-semibold">
                {source.id}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" title={source.name}>
                  {source.name}
                </div>
                <div className="text-muted-foreground text-xs">{sourceLocation(source, t)}</div>
              </div>
            </div>
            <p className="text-muted-foreground mt-2 line-clamp-[8] text-[13px] leading-relaxed whitespace-pre-wrap">{source.text}</p>
            <div className="mt-2 flex items-center justify-between">
              <button
                className="text-accent flex items-center gap-1 text-xs font-medium hover:underline"
                onClick={() => app.openSource(source)}
              >
                {source.format === "epub" ? t("sources.openEpub") : t("sources.openPdf")}
                <ArrowUpRight className="size-3.5" />
              </button>
              <span className="text-muted-foreground text-[11px]" title={t("sources.score", { score: source.score })}>
                {source.score.toFixed(2)}
              </span>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}

export function SourceViewer() {
  const t = useT();
  const app = useApp();
  const source = app.viewing;
  const [chapter, setChapter] = useState<string>("");

  useEffect(() => {
    if (!source || source.format !== "epub") return;
    let current = true;
    setChapter(t("sources.loadingChapter"));
    api<{ text: string }>(`/documents/${source.document_id}/sections/${source.page}`)
      .then((section) => current && setChapter(section.text))
      .catch((error: Error) => current && setChapter(t.server(error.message)));
    return () => {
      current = false;
    };
  }, [source, t]);

  return (
    <Dialog
      open={!!source}
      onOpenChange={(open) => !open && app.openSource(null)}
      title={source ? `${source.name} · ${sourceLocation(source, t)}` : ""}
      className="h-[88vh] max-w-5xl"
    >
      {source &&
        (source.format === "epub" ? (
          <div className="mx-auto max-w-2xl text-[15px] leading-8 whitespace-pre-wrap">{chapter}</div>
        ) : (
          <iframe
            key={`${source.document_id}-${source.page}`}
            title={source.name}
            src={`/api/documents/${source.document_id}/pdf#page=${source.page}`}
            className="h-full min-h-[70vh] w-full rounded-lg border"
          />
        ))}
    </Dialog>
  );
}
