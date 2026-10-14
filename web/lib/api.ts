// 面板后端接口。修改类请求都带 X-Panel 头（后端据此防 CSRF）。
// 错误信息跟随界面语言：LangProvider 挂载时调用 setApiLang 同步当前语言。

import { t } from "@/lib/i18n"
import { DEFAULT_LANG, type Lang } from "@/lib/i18n/lang"

let apiLang: Lang = DEFAULT_LANG;

export function setApiLang(lang: Lang) {
  apiLang = lang;
}

let onUnauthorized: () => void = () => {}

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

export const enc = encodeURIComponent

export interface ApiResponse<T = unknown> {
  data?: T
  [key: string]: unknown
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Panel": "1" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error(t(apiLang, "api.fetchFailed"))
  }
  let data: (ApiResponse<T> & { error?: string }) | null = null
  try {
    data = await res.json()
  } catch {
    /* 非 JSON 响应 */
  }
  if (res.status === 401 && path !== "/api/login") {
    onUnauthorized()
    throw new Error(t(apiLang, "api.unauthorized"))
  }
  if (!res.ok) throw new Error((data && data.error) || t(apiLang, "api.http", { status: res.status }))
  return data as ApiResponse<T>
}
