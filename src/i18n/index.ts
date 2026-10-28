import { createContext, useContext } from "react";
import { forWindows, platform, type Platform } from "../platform";
import { de } from "./de";
import { en, type MessageKey } from "./en";

export type Language = "en" | "de";
export type { MessageKey };

const catalogs: Record<Language, Record<MessageKey, string>> = { en, de };

export function systemLanguage(): Language {
  const langs = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
  return langs.some((l) => l?.toLowerCase().startsWith("de")) ? "de" : "en";
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const windowsCatalogs: Partial<Record<Language, Record<MessageKey, string>>> = {};

/** The texts as Windows reads them: Strg+F instead of ⌘F, Explorer instead of Finder. */
function windowsCatalog(lang: Language): Record<MessageKey, string> {
  const done = windowsCatalogs[lang];
  if (done) return done;
  const out = { ...en, ...catalogs[lang] };
  for (const key of Object.keys(out) as MessageKey[]) out[key] = forWindows(out[key], lang);
  return (windowsCatalogs[lang] = out);
}

export function translator(lang: Language, os: Platform = platform): Translate {
  const catalog = os === "windows" ? windowsCatalog(lang) : catalogs[lang];
  const numbers = new Intl.NumberFormat(lang);
  return (key, vars) => {
    const text = catalog[key] ?? en[key] ?? key;
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => {
      const v = vars[name];
      if (v === undefined) return `{${name}}`;
      return typeof v === "number" ? numbers.format(v) : v;
    });
  };
}

export const I18nContext = createContext<{ t: Translate; lang: Language }>({ t: translator("en"), lang: "en" });

export function useI18n(): { t: Translate; lang: Language } {
  return useContext(I18nContext);
}
