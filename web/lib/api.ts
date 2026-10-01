// 面板后端接口。修改类请求都带 X-Panel 头（后端据此防 CSRF）。

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
    throw new Error("无法连接面板服务")
  }
  let data: (ApiResponse<T> & { error?: string }) | null = null
  try {
    data = await res.json()
  } catch {
    /* 非 JSON 响应 */
  }
  if (res.status === 401 && path !== "/api/login") {
    onUnauthorized()
    throw new Error("登录已失效，请重新登录")
  }
  if (!res.ok) throw new Error((data && data.error) || `请求失败（HTTP ${res.status}）`)
  return data as ApiResponse<T>
}
