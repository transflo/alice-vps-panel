// 不常变化的数据（账户、套餐、系统镜像、SSH 密钥）在会话内缓存，退出登录时清空。
import { api, enc } from './api.js';
import { asList, flattenImages, pick, specText } from './utils.js';

const cache = new Map();

export function clearCache() {
  cache.clear();
}

function once(key, loader) {
  if (!cache.has(key)) {
    cache.set(key, loader().catch((err) => {
      cache.delete(key);
      throw err;
    }));
  }
  return cache.get(key);
}

export function getOverview({ force = false } = {}) {
  if (force) cache.delete('overview');
  return once('overview', async () => (await api('GET', '/api/overview')).data);
}

export async function getPermissions() {
  try {
    const o = await getOverview();
    return o.permissions && o.permissions.ok ? o.permissions.data : null;
  } catch {
    return null;
  }
}

export function getPlans() {
  return once('plans', async () => asList((await api('GET', '/api/plans')).data)
    .map((p) => {
      const id = pick(p, 'id', 'product_id', 'plan_id');
      if (id === undefined) return null;
      return { id: String(id), name: pick(p, 'name', 'title', 'plan_name') || `套餐 #${id}`, specs: specText(p), stock: pick(p, 'stock') };
    })
    .filter(Boolean));
}

export function getImages(planId) {
  return once(`images:${planId}`, async () => flattenImages((await api('GET', `/api/plans/${enc(planId)}/os-images`)).data));
}

export function getSshKeys() {
  return once('sshKeys', async () => asList((await api('GET', '/api/ssh-keys')).data)
    .map((k) => {
      const id = pick(k, 'id', 'key_id', 'ssh_key_id');
      return id === undefined ? null : { id: String(id), name: pick(k, 'name', 'title', 'label', 'comment') || `密钥 #${id}` };
    })
    .filter(Boolean));
}
