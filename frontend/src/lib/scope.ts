import type { Translator } from "@/i18n";
import { UNCATEGORIZED, type Category, type Document, type Scope, type Source } from "./types";

export function inCategory(documents: Document[], categoryId: string | null) {
  return documents.filter((d) =>
    !categoryId ? true : categoryId === UNCATEGORIZED ? !d.category_id : d.category_id === categoryId,
  );
}

export function scopedDocuments(documents: Document[], scope: Scope) {
  return inCategory(documents, scope.category_id).filter(
    (d) => scope.document_ids === null || scope.document_ids.includes(d.id),
  );
}

export function categoryName(id: string | null, categories: Category[], t: Translator) {
  if (!id) return t("scope.all");
  if (id === UNCATEGORIZED) return t("scope.uncategorized");
  return categories.find((c) => c.id === id)?.name ?? t("scope.missingCategory");
}

export function scopeLabel(scope: Scope, documents: Document[], categories: Category[], t: Translator) {
  const ids = scope.document_ids;
  if (ids === null) return categoryName(scope.category_id, categories, t);
  if (!ids.length) return t("scope.none");
  if (ids.length === 1) return documents.find((d) => d.id === ids[0])?.name ?? t("scope.missingDoc");
  return t("scope.selected", { count: ids.length });
}

export function sourceLocation(source: Source, t: Translator) {
  return source.format === "epub"
    ? source.location || t("sources.section", { page: source.page })
    : t("sources.page", { page: source.page });
}
