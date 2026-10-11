import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Category, Conversation, Document, Folder, ModelStatus, Settings } from "./types";

export const keys = {
  documents: ["documents"],
  categories: ["categories"],
  folders: ["folders"],
  conversations: ["conversations"],
  models: ["models"],
  settings: ["settings"],
  health: ["health"],
} as const;

export const useDocuments = () =>
  useQuery({ queryKey: keys.documents, queryFn: () => api<Document[]>("/documents"), refetchInterval: 1800 });
export const useCategories = () =>
  useQuery({ queryKey: keys.categories, queryFn: () => api<Category[]>("/categories"), refetchInterval: 5000 });
export const useFolders = () =>
  useQuery({ queryKey: keys.folders, queryFn: () => api<Folder[]>("/folders"), refetchInterval: 2500 });
export const useConversations = () =>
  useQuery({ queryKey: keys.conversations, queryFn: () => api<Conversation[]>("/conversations") });
export const useModels = () =>
  useQuery({ queryKey: keys.models, queryFn: () => api<ModelStatus>("/models"), refetchInterval: 5000 });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api<Settings>("/settings") });
export const useHealth = () =>
  useQuery({ queryKey: keys.health, queryFn: () => api<{ data_dir: string }>("/health") });

/** Refetch the library after a mutation (documents and category counts move together). */
export function useRefreshLibrary() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.documents }),
      client.invalidateQueries({ queryKey: keys.categories }),
      client.invalidateQueries({ queryKey: keys.folders }),
    ]);
}
