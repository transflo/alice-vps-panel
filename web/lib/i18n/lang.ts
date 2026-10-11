// 支持的界面语言。默认简体中文（与现有行为一致）。

export type Lang = "zh-CN" | "zh-TW" | "en" | "ru" | "es" | "ja" | "ko" | "fr" | "de";

export const DEFAULT_LANG: Lang = "zh-CN";

export const LOCALES: { id: Lang; label: string }[] = [
  { id: "zh-CN", label: "简体中文" },
  { id: "zh-TW", label: "繁體中文" },
  { id: "en", label: "English" },
  { id: "ru", label: "Русский" },
  { id: "es", label: "Español" },
  { id: "ja", label: "日本語" },
  { id: "ko", label: "한국어" },
  { id: "fr", label: "Français" },
  { id: "de", label: "Deutsch" },
];

const IDS: Lang[] = LOCALES.map((l) => l.id);

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (IDS as string[]).includes(v);
}

// 浏览器语言 → 界面语言：大小写/下划线归一，未命中回退默认。
export function normalizeLang(raw: string | null | undefined): Lang {
  if (!raw) return DEFAULT_LANG;
  const s = String(raw).trim().replace(/_/g, "-").toLowerCase();
  if (s.startsWith("zh")) {
    if (/^(zh-(hk|tw|mo)|zh-hant)/.test(s)) return "zh-TW";
    return "zh-CN";
  }
  const base = s.split("-")[0];
  const hit = IDS.find((id) => id.toLowerCase() === s || id.toLowerCase().split("-")[0] === base);
  return hit ?? DEFAULT_LANG;
}

export const STORAGE_KEY = "alice-lang";
