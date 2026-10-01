// 不常变化的数据（账户、套餐、系统镜像、SSH 密钥）在会话内缓存，退出登录时清空。
import { api, enc } from "@/lib/api"
import { asList, flattenImages, pick, specText, type ImageOption, type Plan } from "@/lib/alice"

const cache = new Map<string, Promise<unknown>>()

export function clearCache() {
  cache.clear()
}

function once<T>(key: string, loader: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    cache.set(
      key,
      loader().catch((err) => {
        cache.delete(key)
        throw err
      })
    )
  }
  return cache.get(key) as Promise<T>
}

// /api/overview：账户信息和 EVO 权限各自带一个 ok 标记（其中一个失败不影响另一个）。
export interface Overview {
  profile?: { ok: boolean; data?: unknown; error?: string }
  permissions?: { ok: boolean; data?: unknown; error?: string }
}

export function getOverview({ force = false } = {}): Promise<Overview> {
  if (force) cache.delete("overview")
  return once("overview", async () => (await api<Overview>("GET", "/api/overview")).data as Overview)
}

export async function getPermissions(): Promise<unknown> {
  try {
    const o = await getOverview()
    return o.permissions && o.permissions.ok ? o.permissions.data : null
  } catch {
    return null
  }
}

export function getPlans(): Promise<Plan[]> {
  return once("plans", async () =>
    asList((await api("GET", "/api/plans")).data)
      .map((p): Plan | null => {
        const id = pick(p, "id", "product_id", "plan_id")
        if (id === undefined) return null
        return { id: String(id), name: String(pick(p, "name", "title", "plan_name") || `套餐 #${id}`), specs: specText(p), stock: pick(p, "stock") }
      })
      .filter((p): p is Plan => p !== null)
  )
}

export function getImages(planId: string): Promise<ImageOption[]> {
  return once(`images:${planId}`, async () => flattenImages((await api("GET", `/api/plans/${enc(planId)}/os-images`)).data))
}

export interface SshKey {
  id: string
  name: string
}

export function getSshKeys(): Promise<SshKey[]> {
  return once("sshKeys", async () =>
    asList((await api("GET", "/api/ssh-keys")).data)
      .map((k): SshKey | null => {
        const id = pick(k, "id", "key_id", "ssh_key_id")
        return id === undefined ? null : { id: String(id), name: String(pick(k, "name", "title", "label", "comment") || `密钥 #${id}`) }
      })
      .filter((k): k is SshKey => k !== null)
  )
}
