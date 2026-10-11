import type { Language, Scope, Source } from "./types";

export class ApiError extends Error {}

export async function api<T = unknown>(
  url: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const init: RequestInit = { method: options.method };
  if (options.body instanceof FormData) init.body = options.body;
  else if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers = { "Content-Type": "application/json" };
  }
  const response = await fetch("/api" + url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      typeof data.detail === "string" ? data.detail : "設定或請求格式不正確。",
    );
  return data as T;
}

export type ChatEvent =
  | { type: "status"; message: string }
  | { type: "sources"; sources: Source[]; conversation_id: string }
  | { type: "delta"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; elapsed: number };

/** Streams NDJSON events from /api/chat. */
export async function* chat(
  body: Scope & {
    question: string;
    language: Language;
    conversation_id: string | null;
  },
  signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(error.detail || "無法開始問答");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) yield JSON.parse(line) as ChatEvent;
  }
}
