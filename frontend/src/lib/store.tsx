import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { I18nProvider, translateServer } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { messages as copy } from "@/i18n/messages";
import { api, chat } from "./api";
import { keys } from "./queries";
import type { Language, Message, Preferences, Scope, Source } from "./types";

export type View = "chat" | "library";

export interface ChatMessage extends Message {
  status?: string;
  error?: string;
  elapsed?: number;
  streaming?: boolean;
}

interface Toast {
  id: number;
  text: string;
}

interface AppState {
  ready: boolean;
  language: Language;
  setLanguage(language: Language): Promise<void>;
  view: View;
  setView(view: View): void;
  scope: Scope;
  changeScope(values: Partial<Scope>): boolean;
  conversationId: string | null;
  messages: ChatMessage[];
  busy: boolean;
  newChat(): void;
  openConversation(id: string): Promise<void>;
  ask(question: string): Promise<void>;
  stop(): void;
  sources: { list: Source[]; focus: number | null } | null;
  showSources(list: Source[], focus?: number | null): void;
  hideSources(): void;
  viewing: Source | null;
  openSource(source: Source | null): void;
  toasts: Toast[];
  notify(text: string): void;
  report(error: unknown): void;
}

const Context = createContext<AppState | null>(null);
export const useApp = () => useContext(Context)!;

const defaultScope: Scope = { category_id: null, document_ids: null, reading_mode: "standard" };
const column = { "zh-Hant": 0, en: 1, ja: 2 } as const;

export function AppProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [ready, setReady] = useState(false);
  const [language, setLanguageState] = useState<Language>("zh-Hant");
  const [view, setView] = useState<View>("chat");
  const [scope, setScope] = useState<Scope>(defaultScope);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<AppState["sources"]>(null);
  const [viewing, setViewing] = useState<Source | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const controller = useRef<AbortController | null>(null);
  const preferenceWrite = useRef(Promise.resolve<unknown>(undefined));
  const languageRef = useRef(language);
  languageRef.current = language;

  const text = useCallback(
    (key: MessageKey) => copy[key][column[languageRef.current]],
    [],
  );
  const notify = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, text: message }]);
    setTimeout(() => setToasts((list) => list.filter((toast) => toast.id !== id)), 5000);
  }, []);
  const report = useCallback(
    (error: unknown) => notify(translateServer(error instanceof Error ? error.message : String(error), languageRef.current)),
    [notify],
  );

  useEffect(() => {
    api<Preferences>("/preferences")
      .then((preferences) => {
        setLanguageState(preferences.language);
        setScope({ ...defaultScope, ...preferences.scope });
      })
      .catch(report)
      .finally(() => setReady(true));
  }, [report]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const saveScope = useCallback(
    (next: Scope) => {
      preferenceWrite.current = preferenceWrite.current
        .catch(() => undefined)
        .then(() => api("/preferences", { method: "PATCH", body: { scope: next } }))
        .catch(report);
      return preferenceWrite.current;
    },
    [report],
  );

  const resetChat = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    setSources(null);
  }, []);

  const newChat = useCallback(() => {
    if (busy) return notify(text("scope.busy"));
    resetChat();
    setView("chat");
  }, [busy, notify, resetChat, text]);

  const changeScope = useCallback(
    (values: Partial<Scope>) => {
      if (busy) {
        notify(text("scope.busy"));
        return false;
      }
      const next = { ...scope, ...values };
      setScope(next);
      if (conversationId) resetChat();
      saveScope(next);
      return true;
    },
    [busy, scope, conversationId, notify, resetChat, saveScope, text],
  );

  const setLanguage = useCallback(
    async (next: Language) => {
      if (busy) return notify(text("scope.busy"));
      await api("/preferences", { method: "PATCH", body: { language: next } });
      setLanguageState(next);
    },
    [busy, notify, text],
  );

  const openConversation = useCallback(
    async (id: string) => {
      if (busy) return notify(text("scope.busy"));
      try {
        const [history, saved] = await Promise.all([
          api<Message[]>(`/conversations/${id}`),
          api<Scope>(`/conversations/${id}/scope`),
        ]);
        setScope(saved);
        await saveScope(saved);
        setConversationId(id);
        setMessages(history);
        const last = [...history].reverse().find((item) => item.role === "assistant");
        setSources(last?.sources.length ? { list: last.sources, focus: null } : null);
        setView("chat");
      } catch (error) {
        report(error);
      }
    },
    [busy, notify, report, saveScope, text],
  );

  const update = (patch: Partial<ChatMessage>) =>
    setMessages((list) => [...list.slice(0, -1), { ...list[list.length - 1], ...patch }]);

  const ask = useCallback(
    async (question: string) => {
      if (busy) return;
      controller.current = new AbortController();
      setBusy(true);
      setMessages((list) => [
        ...list,
        { role: "user", content: question, sources: [] },
        { role: "assistant", content: "", sources: [], streaming: true, status: "正在搜尋文件…" },
      ]);
      let answer = "";
      let finished = false;
      try {
        for await (const event of chat(
          { question, ...scope, language: languageRef.current, conversation_id: conversationId },
          controller.current.signal,
        )) {
          if (event.type === "status") update({ status: event.message });
          else if (event.type === "sources") {
            setConversationId(event.conversation_id);
            update({ sources: event.sources });
            client.invalidateQueries({ queryKey: keys.conversations });
          } else if (event.type === "delta") {
            answer += event.text;
            update({ content: answer, status: undefined });
          } else if (event.type === "error") throw new Error(event.message);
          else if (event.type === "done") {
            finished = true;
            update({ elapsed: event.elapsed, streaming: false });
          }
        }
        if (!finished) throw new Error(text("answer.disconnected"));
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === "AbortError";
        update({
          streaming: false,
          status: undefined,
          error: aborted ? text("answer.stopped") : translateServer((error as Error).message, languageRef.current),
        });
      } finally {
        setBusy(false);
        controller.current = null;
        client.invalidateQueries({ queryKey: keys.conversations });
        client.invalidateQueries({ queryKey: keys.models });
      }
    },
    [busy, scope, conversationId, client, text],
  );

  const value = useMemo<AppState>(
    () => ({
      ready,
      language,
      setLanguage,
      view,
      setView,
      scope,
      changeScope,
      conversationId,
      messages,
      busy,
      newChat,
      openConversation,
      ask,
      stop: () => controller.current?.abort(),
      sources,
      showSources: (list, focus = null) => setSources({ list, focus }),
      hideSources: () => setSources(null),
      viewing,
      openSource: setViewing,
      toasts,
      notify,
      report,
    }),
    [ready, language, setLanguage, view, scope, changeScope, conversationId, messages, busy, newChat, openConversation, ask, sources, viewing, toasts, notify, report],
  );

  return (
    <Context.Provider value={value}>
      <I18nProvider language={language}>{children}</I18nProvider>
    </Context.Provider>
  );
}
