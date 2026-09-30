import { useEffect, useState } from "react";
import type { Settings } from "./settings";

function usePrefersDark(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const listener = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);
  return dark;
}

/** The theme in effect: the setting, or the system appearance. */
export function useTheme(settings: Settings): "dark" | "light" {
  const prefersDark = usePrefersDark();
  return settings.theme === "system" ? (prefersDark ? "dark" : "light") : settings.theme;
}
