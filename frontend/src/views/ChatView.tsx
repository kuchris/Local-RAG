import { ArrowUp, Check, Copy, FileText, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ScopePicker } from "@/components/ScopePicker";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/misc";
import { useT } from "@/i18n";
import { renderAnswer } from "@/lib/markdown";
import { useCategories, useDocuments } from "@/lib/queries";
import { scopeLabel, scopedDocuments, sourceLocation } from "@/lib/scope";
import { useApp, type ChatMessage } from "@/lib/store";
import type { ReadingMode } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ChatView() {
  const t = useT();
  const app = useApp();
  const documents = useDocuments().data;
  const categories = useCategories().data ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (node && pinned.current) node.scrollTop = node.scrollHeight;
  }, [app.messages]);

  const empty = !app.messages.length;
  const noDocuments = documents !== undefined && !documents.length;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center px-5">
        <span className="text-muted-foreground truncate text-sm">
          {scopeLabel(app.scope, documents ?? [], categories, t)}
          {app.scope.reading_mode === "fiction" && ` · ${t("mode.fiction")}`}
        </span>
      </header>
      <div
        ref={scroller}
        onScroll={(event) => {
          const node = event.currentTarget;
          pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="messages"
      >
        {empty ? (
          <EmptyState noDocuments={noDocuments} />
        ) : (
          <div className="mx-auto max-w-3xl space-y-8 px-5 pt-4 pb-10">
            {app.messages.map((message, index) => (
              <MessageView key={message.id ?? `local-${index}`} message={message} />
            ))}
          </div>
        )}
      </div>
      <Composer />
    </div>
  );
}

function EmptyState({ noDocuments }: { noDocuments: boolean }) {
  const t = useT();
  const app = useApp();
  if (noDocuments)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("chat.noDocsTitle")}</h1>
        <p className="text-muted-foreground max-w-md text-sm">{t("chat.noDocsHint")}</p>
        <Button variant="primary" className="mt-2" onClick={() => app.setView("library")}>
          {t("chat.openLibrary")}
        </Button>
      </div>
    );
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t("chat.emptyTitle")}</h1>
      <p className="text-muted-foreground max-w-md text-sm">{t("chat.emptyHint")}</p>
      <div className="mt-4 flex max-w-2xl flex-wrap justify-center gap-2">
        {(["chat.suggestSummary", "chat.suggestConcept"] as const).map((key) => (
          <button
            key={key}
            onClick={() => window.dispatchEvent(new CustomEvent("compose", { detail: t(key) }))}
            className="hover:bg-muted rounded-xl border px-4 py-2.5 text-left text-sm"
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageView({ message }: { message: ChatMessage }) {
  if (message.role === "user")
    return (
      <div className="flex justify-end">
        <div className="bg-muted max-w-[85%] rounded-2xl px-4 py-2.5 whitespace-pre-wrap">{message.content}</div>
      </div>
    );
  return <AnswerView message={message} />;
}

function AnswerView({ message }: { message: ChatMessage }) {
  const t = useT();
  const app = useApp();
  const body = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (body.current) renderAnswer(body.current, message.content, message.sources, (s) => `${s.name} · ${sourceLocation(s, t)}`);
  }, [message.content, message.sources, t]);

  return (
    <div className="group" data-testid="answer">
      <div
        ref={body}
        className="answer"
        onClick={(event) => {
          const id = (event.target as HTMLElement).closest<HTMLElement>("[data-cite]")?.dataset.cite;
          if (id) app.showSources(message.sources, Number(id));
        }}
      />
      {message.status && (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <span className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span key={i} className="thinking-dot bg-muted-foreground size-1.5 rounded-full" style={{ animationDelay: `${i * 0.2}s` }} />
            ))}
          </span>
          {t.server(message.status)}
        </div>
      )}
      {message.error && (
        <p className={cn("text-danger text-sm", message.content && "mt-3")} role="alert">
          {message.error}
        </p>
      )}
      {!message.streaming && !message.error && message.content && (
        <div className="text-muted-foreground mt-2 flex items-center gap-1 text-xs">
          {message.sources.length > 0 && (
            <button
              className="hover:bg-muted hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1"
              onClick={() => app.showSources(message.sources)}
              data-testid="show-sources"
            >
              <FileText className="size-3.5" />
              {message.sources.length === 1 ? t("answer.source") : t("answer.sources", { count: message.sources.length })}
            </button>
          )}
          <button
            className="hover:bg-muted hover:text-foreground flex items-center gap-1.5 rounded-md px-2 py-1 opacity-0 group-hover:opacity-100 focus:opacity-100"
            onClick={() => {
              navigator.clipboard.writeText(message.content).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? t("answer.copied") : t("answer.copy")}
          </button>
          {message.elapsed !== undefined && <span className="px-2">{t("answer.seconds", { seconds: message.elapsed.toFixed(1) })}</span>}
        </div>
      )}
    </div>
  );
}

function Composer() {
  const t = useT();
  const app = useApp();
  const documents = useDocuments().data ?? [];
  const [question, setQuestion] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const listener = (event: Event) => {
      setQuestion((event as CustomEvent<string>).detail);
      input.current?.focus();
    };
    window.addEventListener("compose", listener);
    return () => window.removeEventListener("compose", listener);
  }, []);

  useEffect(() => {
    if (!app.busy) input.current?.focus();
  }, [app.busy, app.conversationId]);

  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = Math.min(node.scrollHeight, 220) + "px";
  }, [question]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = question.trim();
    if (!text || app.busy) return;
    if (!scopedDocuments(documents, app.scope).some((d) => d.status === "ready")) return app.notify(t("scope.noReady"));
    setQuestion("");
    app.ask(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="shrink-0 px-5 pb-3">
      <form
        onSubmit={submit}
        className="bg-background focus-within:border-ring mx-auto max-w-3xl rounded-2xl border shadow-sm transition-colors"
        data-testid="composer"
      >
        <textarea
          ref={input}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={1500}
          disabled={app.busy}
          placeholder={t("composer.placeholder")}
          className="placeholder:text-muted-foreground block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 outline-none disabled:opacity-60"
          data-testid="question"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <ScopePicker />
          <Segmented<ReadingMode>
            label={t("mode.label")}
            value={app.scope.reading_mode}
            disabled={app.busy}
            onChange={(reading_mode) => app.changeScope({ reading_mode })}
            options={[
              { value: "standard", label: t("mode.standard") },
              { value: "fiction", label: t("mode.fiction") },
            ]}
          />
          <div className="flex-1" />
          {app.busy ? (
            <Button variant="primary" size="icon" className="rounded-full" onClick={app.stop} aria-label={t("composer.stop")} title={t("composer.stop")} data-testid="stop">
              <Square className="size-3! fill-current" />
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              size="icon"
              className="rounded-full"
              disabled={!question.trim()}
              aria-label={t("composer.send")}
              title={t("composer.send")}
              data-testid="send"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </form>
      <p className="text-muted-foreground mx-auto mt-2 max-w-3xl text-center text-xs">
        {app.scope.reading_mode === "fiction" ? t("mode.fictionNote") : t("composer.disclaimer")}
      </p>
    </div>
  );
}
