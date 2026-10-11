import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

function stored(): Theme {
  try {
    const value = localStorage.getItem("theme");
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

const media = window.matchMedia("(prefers-color-scheme: dark)");
function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
}
apply(stored());

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(stored);
  useEffect(() => {
    apply(theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* per-viewer convenience only */
    }
    const listener = () => apply(theme);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [theme]);
  return [theme, setTheme] as const;
}
