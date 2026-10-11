import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Language } from "@/lib/types";
import { legacyCopy } from "./legacy";
import { messages, type MessageKey } from "./messages";

type Values = Record<string, string | number>;
const column = { "zh-Hant": 0, en: 1, ja: 2 } as const;

function fill(template: string, values: Values = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

// Backend messages arrive in Traditional Chinese; templates with {placeholders} match by pattern.
const exact = new Map(legacyCopy.map((row) => [row[0], row]));
const patterns = legacyCopy
  .filter((row) => row[0].includes("{"))
  .map((row) => {
    const keys: string[] = [];
    const source = row[0]
      .split(/(\{\w+\})/)
      .map((part) => {
        if (/^\{\w+\}$/.test(part)) {
          keys.push(part.slice(1, -1));
          return "([\\s\\S]*?)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    return { row, keys, regex: new RegExp("^" + source + "$") };
  });

export function translateServer(message: string, language: Language) {
  if (language === "zh-Hant" || !message) return message;
  const row = exact.get(message);
  if (row) return row[column[language]];
  for (const pattern of patterns) {
    const match = pattern.regex.exec(message);
    if (match)
      return fill(pattern.row[column[language]], Object.fromEntries(pattern.keys.map((key, i) => [key, match[i + 1]])));
  }
  return message;
}

export interface Translator {
  (key: MessageKey, values?: Values): string;
  server(message: string): string;
  language: Language;
}

function translator(language: Language): Translator {
  const t = ((key: MessageKey, values?: Values) => fill(messages[key][column[language]], values)) as Translator;
  t.server = (message: string) => translateServer(message, language);
  t.language = language;
  return t;
}

const Context = createContext<Translator>(translator("zh-Hant"));

export function I18nProvider({ language, children }: { language: Language; children: ReactNode }) {
  const value = useMemo(() => translator(language), [language]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useT = () => useContext(Context);

export const languages: { value: Language; label: string }[] = [
  { value: "zh-Hant", label: "繁體中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
];
