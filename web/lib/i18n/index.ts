import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { ja } from "./ja";
import { ko } from "./ko";
import { ru } from "./ru";
import { zhCN, type Dict, type DictKey } from "./zh-CN";
import { zhTW } from "./zh-TW";
import type { Lang } from "./lang";

const DICTS: Record<Lang, Dict> = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
  ru,
  es,
  ja,
  ko,
  fr,
  de,
};

export type { Dict, DictKey };
export type { Lang };

// t(lang, key, params)：缺键回退简体中文，再缺回退 key 本身（永不抛错）。
export function t(lang: Lang, key: DictKey, params?: Record<string, string | number>): string {
  const dict = DICTS[lang] ?? zhCN;
  let s: string = dict[key] ?? zhCN[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}
