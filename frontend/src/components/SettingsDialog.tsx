import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { languages, useT } from "@/i18n";
import { api } from "@/lib/api";
import { keys, useDocuments, useHealth, useModels, useReindex, useSettings } from "@/lib/queries";
import { useApp } from "@/lib/store";
import { useTheme, type Theme } from "@/lib/theme";
import type { Language, ModelEntry, ReindexState, Settings } from "@/lib/types";
import { formatSize } from "@/lib/utils";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input, Label, NativeSelect } from "./ui/input";
import { Progress, Tabs } from "./ui/misc";

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const t = useT();
  const app = useApp();
  const client = useQueryClient();
  const saved = useSettings().data;
  const models = useModels().data;
  const documents = useDocuments().data ?? [];
  const dataDir = useHealth().data?.data_dir;
  const reindex = useReindex();
  const rebuilding = reindex.data?.status === "running";
  const [theme, setTheme] = useTheme();
  const [form, setForm] = useState<Settings | null>(null);
  const [tab, setTab] = useState("models");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && saved) {
      setForm(saved);
      setError("");
    }
  }, [open, saved]);
  useEffect(() => {
    if (open) setTab("models");
  }, [open]);

  if (!form) return null;
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm({ ...form, [key]: value });
  const catalog = models?.catalog ?? [];
  const answers = catalog.filter((m) => m.type === "llm");
  const embeddings = catalog.filter((m) => m.type === "embedding");
  // With documents, a different embedding model is applied by rebuilding the index, not by saving.
  const needsReindex = documents.length > 0 && !!saved && form.embedding_model !== saved.embedding_model;

  async function save() {
    try {
      await api("/settings", { method: "PUT", body: needsReindex ? { ...form, embedding_model: saved!.embedding_model } : form });
      await Promise.all([
        client.invalidateQueries({ queryKey: keys.settings }),
        client.invalidateQueries({ queryKey: keys.models }),
      ]);
      onOpenChange(false);
      app.notify(t("settings.saved"));
    } catch (problem) {
      setError(t.server((problem as Error).message));
    }
  }

  async function rebuild() {
    try {
      // Seed the "running" state so polling sees the transition even if the rebuild finishes at once.
      client.setQueryData(keys.reindex, await api<ReindexState>("/reindex", { method: "POST", body: { embedding_model: form!.embedding_model } }));
      await client.invalidateQueries({ queryKey: keys.reindex });
    } catch (problem) {
      setError(t.server((problem as Error).message));
    }
  }

  const option = (model: ModelEntry) =>
    [model.id, formatSize(model.size), model.vision && t("settings.vision"), model.loaded && t("settings.loaded")]
      .filter(Boolean)
      .join(" · ");
  const ensure = (list: ModelEntry[], id: string) =>
    list.some((m) => m.id === id) ? null : <option value={id}>{`${id} ${t("settings.missing")}`}</option>;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("settings.title")}
      className="h-[min(36rem,85vh)] max-w-xl"
      footer={
        <>
          {error && <p className="text-danger mr-auto self-center text-xs">{error}</p>}
          <Button onClick={() => onOpenChange(false)}>{t("library.cancel")}</Button>
          <Button variant="primary" onClick={save} data-testid="save-settings">
            {t("settings.save")}
          </Button>
        </>
      }
    >
      <Tabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          {
            value: "models",
            label: t("settings.tabModels"),
            content: (
              <div className="space-y-5 pt-4">
                {!models?.online && <p className="text-danger text-sm">{t("status.noServer")}</p>}
                {models?.error && <p className="text-danger text-sm">{t.server(models.error)}</p>}
                {models?.online && !catalog.length && <p className="text-danger text-sm">{t("settings.noModels")}</p>}
                <Label>{t("settings.answerModel")}</Label>
                <NativeSelect value={form.model} onChange={(e) => set("model", e.target.value)} className="-mt-3" data-testid="answer-model">
                  {ensure(answers, form.model)}
                  {answers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {option(m)}
                    </option>
                  ))}
                </NativeSelect>
                <Label>{t("settings.embeddingModel")}</Label>
                <NativeSelect
                  value={form.embedding_model}
                  onChange={(e) => set("embedding_model", e.target.value)}
                  disabled={rebuilding}
                  className="-mt-3"
                  data-testid="embedding-model"
                >
                  {ensure(embeddings, form.embedding_model)}
                  {embeddings.map((m) => (
                    <option key={m.id} value={m.id}>
                      {option(m)}
                    </option>
                  ))}
                </NativeSelect>
                {rebuilding && reindex.data && (
                  <div className="bg-muted -mt-2 space-y-2 rounded-lg p-3 text-sm" data-testid="reindex-progress">
                    <div>{t("settings.reindexing", { done: reindex.data.done, total: reindex.data.total })}</div>
                    <Progress value={(100 * reindex.data.done) / Math.max(1, reindex.data.total)} />
                  </div>
                )}
                {!rebuilding && reindex.data?.status === "error" && (
                  <p className="text-danger -mt-2 text-xs">{t("settings.reindexFailed", { error: t.server(reindex.data.error ?? "") })}</p>
                )}
                {!rebuilding && needsReindex && (
                  <div className="bg-muted -mt-2 space-y-3 rounded-lg p-3">
                    <p className="text-muted-foreground text-xs leading-relaxed">{t("settings.reindexNote", { count: documents.length })}</p>
                    <Button size="sm" variant="primary" onClick={rebuild} data-testid="reindex">
                      {t("settings.reindex")}
                    </Button>
                  </div>
                )}
                <Label>{t("settings.idle")}</Label>
                <NativeSelect
                  value={String(form.embedding_idle_unload)}
                  onChange={(e) => set("embedding_idle_unload", e.target.value === "true")}
                  className="-mt-3"
                >
                  <option value="true">{t("settings.idleRelease")}</option>
                  <option value="false">{t("settings.idleKeep")}</option>
                </NativeSelect>
                <p className="text-muted-foreground text-xs leading-relaxed">{t("settings.modelsHint")}</p>
              </div>
            ),
          },
          {
            value: "answers",
            label: t("settings.tabAnswers"),
            content: (
              <div className="grid grid-cols-2 gap-4 pt-4">
                <NumberField label={t("settings.topK")} value={form.top_k} min={1} max={6} onChange={(v) => set("top_k", v)} />
                <NumberField label={t("settings.maxTokens")} value={form.max_tokens} min={100} max={2000} step={100} onChange={(v) => set("max_tokens", v)} />
                <NumberField label={t("settings.temperature")} value={form.temperature} min={0} max={1} step={0.1} onChange={(v) => set("temperature", v)} />
              </div>
            ),
          },
          {
            value: "general",
            label: t("settings.tabGeneral"),
            content: (
              <div className="space-y-5 pt-4">
                <Label>{t("settings.language")}</Label>
                <NativeSelect
                  value={app.language}
                  onChange={(e) => app.setLanguage(e.target.value as Language).catch(app.report)}
                  className="-mt-3"
                  data-testid="language"
                >
                  {languages.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </NativeSelect>
                <Label>{t("settings.theme")}</Label>
                <NativeSelect value={theme} onChange={(e) => setTheme(e.target.value as Theme)} className="-mt-3">
                  <option value="system">{t("settings.themeSystem")}</option>
                  <option value="light">{t("settings.themeLight")}</option>
                  <option value="dark">{t("settings.themeDark")}</option>
                </NativeSelect>
                <Label>{t("settings.dataDir")}</Label>
                <code className="bg-muted -mt-3 block rounded-lg px-3 py-2 text-xs break-all">{dataDir}</code>
              </div>
            ),
          },
        ]}
      />
    </Dialog>
  );
}

function NumberField({
  label,
  value,
  onChange,
  ...limits
}: {
  label: string;
  value: number;
  onChange(value: number): void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <Input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} {...limits} />
    </label>
  );
}
