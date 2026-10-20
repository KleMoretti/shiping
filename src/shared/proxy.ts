export interface ProxySettings {
  mode: 'system' | 'direct' | 'custom'
  url: string
}

export const DEFAULT_PROXY: ProxySettings = { mode: 'system', url: '' }

/** Validate on both sides of IPC. Never include the rejected input in errors. */
export function normalizeProxySettings(value: unknown): ProxySettings {
  if (value === undefined) return { ...DEFAULT_PROXY }
  if (!value || typeof value !== 'object') throw new Error('代理设置无效')
  const { mode, url } = value as Partial<ProxySettings>
  if (mode === 'system' || mode === 'direct') return { mode, url: '' }
  if (mode !== 'custom') throw new Error('代理模式无效')
  let parsed: URL
  try {
    parsed = new URL(typeof url === 'string' ? url.trim() : '')
  } catch {
    throw new Error('请输入完整代理地址，例如 http://127.0.0.1:20808')
  }
  if (
    !['http:', 'https:', 'socks5:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    !/^[\w.\-[\]:]+$/.test(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname && parsed.pathname !== '/') ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol === 'socks5:' && !parsed.port)
  ) {
    throw new Error('代理须为 HTTP、HTTPS 或 SOCKS5 地址，不支持账号密码、路径或查询参数')
  }
  return { mode, url: `${parsed.protocol}//${parsed.host}` }
}

/** Test the same /models endpoint as the model picker, without generating tokens. */
export function modelsURL(baseURL: string): string {
  let url: URL
  try {
    url = new URL(baseURL.trim() || 'https://api.openai.com/v1')
  } catch {
    throw new Error('API 地址无效')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('API 地址须为 HTTP 或 HTTPS，不能包含账号密码、查询参数或片段')
  }
  return `${url.href.replace(/\/+$/, '')}/models`
}

export interface ProxyDetection {
  route: string
  error?: string
}

export interface ProxyTestResult {
  reachable: boolean
  ok: boolean
  route: string
  elapsedMs: number
  status?: number
  message: string
}
