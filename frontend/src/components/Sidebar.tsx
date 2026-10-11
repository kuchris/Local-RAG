import { useQueryClient } from "@tanstack/react-query";
import { Library, PanelLeftClose, PanelLeftOpen, Search, Settings, SquarePen, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { keys, useConversations, useDocuments, useModels, useReindex, useSettings } from "@/lib/queries";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export function Sidebar({ collapsed, onToggle, onSettings }: { collapsed: boolean; onToggle(): void; onSettings(): void }) {
  const t = useT();
  const app = useApp();
  const client = useQueryClient();
  const conversations = useConversations().data ?? [];
  const documents = useDocuments().data ?? [];
  const [filter, setFilter] = useState("");
  const visible = useMemo(
    () => conversations.filter((c) => c.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase())),
    [conversations, filter],
  );

  if (collapsed)
    return (
      <aside className="bg-sidebar flex w-14 shrink-0 flex-col items-center gap-1 border-r py-3">
        <Button variant="ghost" size="icon" onClick={onToggle} aria-label={t("nav.expand")} title={t("nav.expand")}>
          <PanelLeftOpen />
        </Button>
        <Button variant="ghost" size="icon" onClick={app.newChat} aria-label={t("nav.newChat")} title={t("nav.newChat")}>
          <SquarePen />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => app.setView("library")}
          aria-label={t("nav.library")}
          title={t("nav.library")}
          className={cn(app.view === "library" && "bg-muted")}
        >
          <Library />
        </Button>
        <div className="flex-1" />
        <ModelDot />
        <Button variant="ghost" size="icon" onClick={onSettings} aria-label={t("nav.settings")} title={t("nav.settings")}>
          <Settings />
        </Button>
      </aside>
    );

  async function remove(id: string) {
    if (app.busy) return;
    try {
      await api(`/conversations/${id}`, { method: "DELETE" });
      if (app.conversationId === id) app.newChat();
      await client.invalidateQueries({ queryKey: keys.conversations });
    } catch (error) {
      app.report(error);
    }
  }

  return (
    <aside className="bg-sidebar flex w-64 shrink-0 flex-col border-r" data-testid="sidebar">
      <div className="flex h-12 items-center justify-between px-3">
        <span className="pl-1 text-sm font-semibold tracking-tight">Local RAG</span>
        <Button variant="ghost" size="iconSm" onClick={onToggle} aria-label={t("nav.collapse")} title={t("nav.collapse")}>
          <PanelLeftClose />
        </Button>
      </div>
      <nav className="space-y-0.5 px-2">
        <NavItem icon={<SquarePen />} label={t("nav.newChat")} onClick={app.newChat} shortcut="Ctrl N" testId="new-chat" />
        <NavItem
          icon={<Library />}
          label={t("nav.library")}
          active={app.view === "library"}
          onClick={() => app.setView("library")}
          badge={documents.length || undefined}
          testId="open-library"
        />
      </nav>
      <div className="mt-4 px-3">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("nav.searchChats")}
            className="bg-background placeholder:text-muted-foreground focus:border-ring h-8 w-full rounded-lg border pr-2 pl-8 text-sm outline-none"
          />
        </div>
      </div>
      <div className="text-muted-foreground mt-4 px-5 pb-1 text-xs font-medium">{t("nav.recent")}</div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2" data-testid="conversations">
        {visible.map((conversation) => (
          <div
            key={conversation.id}
            className={cn(
              "group hover:bg-muted relative flex items-center rounded-lg",
              app.conversationId === conversation.id && app.view === "chat" && "bg-muted",
            )}
          >
            <button
              className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm"
              title={conversation.title}
              onClick={() => app.openConversation(conversation.id)}
            >
              {conversation.title}
            </button>
            <button
              className="text-muted-foreground hover:text-danger mr-1 hidden rounded-md p-1.5 group-hover:block"
              aria-label={t("nav.deleteChat")}
              title={t("nav.deleteChat")}
              onClick={() => remove(conversation.id)}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        {!visible.length && (
          <p className="text-muted-foreground px-3 py-2 text-xs">
            {conversations.length ? t("nav.noMatches") : t("nav.noChats")}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1 border-t p-2">
        <ModelStatus />
        <Button variant="ghost" size="icon" onClick={onSettings} aria-label={t("nav.settings")} title={t("nav.settings")}>
          <Settings />
        </Button>
      </div>
    </aside>
  );
}

function NavItem({
  icon,
  label,
  onClick,
  active,
  badge,
  shortcut,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  onClick(): void;
  active?: boolean;
  badge?: number;
  shortcut?: string;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "hover:bg-muted flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm [&_svg]:size-4",
        active && "bg-muted font-medium",
      )}
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {badge !== undefined && <span className="text-muted-foreground text-xs">{badge}</span>}
      {shortcut && <kbd className="text-muted-foreground font-sans text-[11px]">{shortcut}</kbd>}
    </button>
  );
}

function useModelState() {
  const t = useT();
  const models = useModels().data;
  const settings = useSettings().data;
  const reindex = useReindex().data;
  if (reindex?.status === "running") {
    const percent = Math.round((100 * reindex.done) / Math.max(1, reindex.total));
    return { tone: "busy" as const, label: t("status.reindexing", { percent }), title: reindex.model ?? "" };
  }
  if (!models || !settings) return { tone: "idle" as const, label: "…", title: "" };
  if (!models.online) return { tone: "error" as const, label: t("status.noServer"), title: t.server(models.error ?? "") };
  if (!models.configured_available || models.error)
    return { tone: "error" as const, label: t("status.noModel"), title: t.server(models.error ?? "") };
  const loaded = models.catalog.find((m) => m.id === settings.model)?.loaded;
  return {
    tone: loaded ? ("ok" as const) : ("idle" as const),
    label: settings.model,
    title: loaded ? t("status.loaded") : t("status.idle"),
  };
}

const tones = { ok: "bg-emerald-500", idle: "bg-zinc-400", busy: "bg-amber-500", error: "bg-danger" };

function ModelStatus() {
  const state = useModelState();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-2 text-xs" title={state.title} data-testid="model-status">
      <span className={cn("size-2 shrink-0 rounded-full", tones[state.tone])} />
      <span className="text-muted-foreground truncate">{state.label}</span>
    </div>
  );
}

function ModelDot() {
  const state = useModelState();
  return (
    <span className="flex size-8 items-center justify-center" title={`${state.label} · ${state.title}`}>
      <span className={cn("size-2 rounded-full", tones[state.tone])} />
    </span>
  );
}

