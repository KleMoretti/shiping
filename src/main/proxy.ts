import { session, type Session } from 'electron'
import { createHash } from 'node:crypto'
import {
  modelsURL,
  normalizeProxySettings,
  type ProxyDetection,
  type ProxyTestResult
} from '../shared/proxy'
import type { ApiProfile } from '../shared/api-profile'
import { buildRequestHeaders } from '../shared/request-headers'

// Immutable, in-memory API sessions keep tests and edited settings away from
// active streams, browser cookies, updates and the OS-wide proxy configuration.
const sessions = new Map<string, Promise<Session>>()

export function getProxySession(value: unknown): Promise<Session> {
  const proxy = normalizeProxySettings(value)
  const key = JSON.stringify(proxy)
  let pending = sessions.get(key)
  if (!pending) {
    const id = createHash('sha256').update(key).digest('hex')
    const ses = session.fromPartition(`shiping-api-${id}`, { cache: false })
    pending = ses
      .setProxy(
        proxy.mode === 'custom'
          ? { mode: 'fixed_servers', proxyRules: proxy.url }
          : { mode: proxy.mode }
      )
      .then(() => ses)
    sessions.set(key, pending)
    pending.catch(() => sessions.delete(key))
  }
  return pending
}

export async function fetchWithProxy(
  proxy: unknown,
  input: Parameters<typeof fetch>[0],
  init?: RequestInit
): Promise<Response> {
  const target = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url
  if (!['http:', 'https:'].includes(new URL(target).protocol)) {
    throw new Error('API 请求仅支持 HTTP 或 HTTPS')
  }
  const ses = await getProxySession(proxy)
  return ses.fetch(input instanceof URL ? input.href : input, { ...init, credentials: 'omit' })
}

/** Bound PAC resolution as well as the HTTP request, not just time to headers. */
async function timed<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('请求超时')
      error.name = 'TimeoutError'
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  try {
    return await Promise.race([work(controller.signal), deadline])
  } finally {
    clearTimeout(timer!)
  }
}

function networkError(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : ''
  if (/timeout|timed.out/i.test(text)) return '请求超时，请检查代理是否运行及当前线路'
  if (/proxy|socks|tunnel/i.test(text))
    return '代理连接失败，请检查协议、地址和端口；不支持需要认证的代理'
  if (/cert|ssl/i.test(text)) return 'TLS 证书验证失败，请检查证书或代理配置'
  if (/name.not.resolved|dns/i.test(text)) return '域名解析失败，请检查 API 地址或代理 DNS'
  return '无法连接，请检查 API 地址、网络及代理配置'
}

export async function detectSystemProxy(baseURL: string): Promise<ProxyDetection> {
  try {
    return await timed(async () => {
      const ses = await getProxySession({ mode: 'system' })
      await ses.forceReloadProxyConfig()
      return { route: await ses.resolveProxy(modelsURL(baseURL)) }
    }, 10_000)
  } catch (error) {
    return { route: '', error: networkError(error) }
  }
}

function httpMessage(status: number): string {
  if (status >= 200 && status < 300) return '网络连接正常，模型列表接口可访问'
  if (status === 401) return '网络已连通；API Key 无效或未填写'
  if (status === 403) return '网络已连通；请检查 API 权限或网关访问限制'
  if (status === 404) return '网络已连通；该地址没有模型列表接口，请确认 API Base URL'
  if (status === 407) return '代理要求身份认证，当前不支持此类代理'
  return `已收到 HTTP ${status}，请检查服务端或网关状态`
}

export async function testProxyConnection(
  value: unknown,
  profile: Partial<Pick<ApiProfile, 'apiBaseURL' | 'apiKey' | 'apiHeaders'>>,
  timeoutMs = 10_000
): Promise<ProxyTestResult> {
  const started = Date.now()
  let route = ''
  try {
    const proxy = normalizeProxySettings(value)
    const url = modelsURL(profile.apiBaseURL ?? '')
    return await timed(async (signal) => {
      const ses = await getProxySession(proxy)
      route = await ses.resolveProxy(url)
      const response = await fetchWithProxy(proxy, url, {
        headers: buildRequestHeaders(profile.apiKey ?? '', profile.apiHeaders),
        signal
      })
      // The test needs only headers; do not retain or display server error bodies.
      void response.body?.cancel().catch(() => {})
      return {
        reachable: true,
        ok: response.ok,
        route,
        status: response.status,
        elapsedMs: Date.now() - started,
        message: httpMessage(response.status)
      }
    }, timeoutMs)
  } catch (error) {
    return {
      reachable: false,
      ok: false,
      route,
      elapsedMs: Date.now() - started,
      message: networkError(error)
    }
  }
}
