import { FileUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Sidebar } from "@/components/Sidebar";
import { SourcesPanel, SourceViewer } from "@/components/SourcesPanel";
import { useT } from "@/i18n";
import { useImports } from "@/lib/imports";
import { useApp } from "@/lib/store";
import { ChatView } from "@/views/ChatView";
import { LibraryView } from "@/views/LibraryView";

export function App() {
  const app = useApp();
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1100);
  const [settings, setSettings] = useState(false);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        app.newChat();
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [app]);

  if (!app.ready) return null;
  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} onSettings={() => setSettings(true)} />
      <main className="flex min-w-0 flex-1">
        {app.view === "chat" ? <ChatView /> : <LibraryView />}
        {app.view === "chat" && <SourcesPanel />}
      </main>
      <SourceViewer />
      <SettingsDialog open={settings} onOpenChange={setSettings} />
      <DropOverlay />
      <FileInput />
      <Toaster />
    </div>
  );
}

function DropOverlay() {
  const t = useT();
  const { upload } = useImports();
  const [visible, setVisible] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const files = (event: DragEvent) => event.dataTransfer?.types.includes("Files");
    const enter = (event: DragEvent) => {
      event.preventDefault();
      if (files(event)) {
        depth.current++;
        setVisible(true);
      }
    };
    const over = (event: DragEvent) => event.preventDefault();
    const leave = (event: DragEvent) => {
      event.preventDefault();
      if (--depth.current <= 0) setVisible(false);
    };
    const drop = (event: DragEvent) => {
      event.preventDefault();
      depth.current = 0;
      setVisible(false);
      if (event.dataTransfer?.files.length) upload(event.dataTransfer.files);
    };
    document.addEventListener("dragenter", enter);
    document.addEventListener("dragover", over);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragenter", enter);
      document.removeEventListener("dragover", over);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
    };
  });

  if (!visible) return null;
  return (
    <div className="bg-background/80 pointer-events-none fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
      <div className="border-ring flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-16 py-12">
        <FileUp className="text-muted-foreground size-8" />
        <p className="font-medium">{t("library.dropTitle")}</p>
        <p className="text-muted-foreground text-sm">{t("library.dropHint")}</p>
      </div>
    </div>
  );
}

/** Upload target outside Electron (browser dev mode) and for automated tests. */
function FileInput() {
  const { upload } = useImports();
  return (
    <input
      id="file-input"
      data-testid="file-input"
      type="file"
      multiple
      accept=".pdf,.epub"
      hidden
      onChange={(event) => {
        upload([...(event.target.files ?? [])]);
        event.target.value = "";
      }}
    />
  );
}

function Toaster() {
  const { toasts } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" role="status">
      {toasts.map((toast) => (
        <div key={toast.id} className="bg-primary text-primary-foreground max-w-md rounded-lg px-4 py-2.5 text-sm shadow-lg">
          {toast.text}
        </div>
      ))}
    </div>
  );
}
