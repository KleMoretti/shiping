import { useEffect, useRef, useState } from 'react'
import { Network, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useSettingsStore } from '@/lib/store/settings'
import { SettingsCard, Field } from '../components'
import {
  DEFAULT_PROXY,
  normalizeProxySettings,
  type ProxySettings,
  type ProxyDetection,
  type ProxyTestResult
} from '../../../../shared/proxy'

export function NetworkSection() {
  const { networkProxy, apiBaseURL, apiKey, apiHeaders, updateSetting } = useSettingsStore()
  const [draft, setDraft] = useState<ProxySettings>(networkProxy)
  const [detection, setDetection] = useState<ProxyDetection | null>(null)
  const [result, setResult] = useState<ProxyTestResult | null>(null)
  const [busy, setBusy] = useState<'detect' | 'test' | 'save' | null>(null)
  const [message, setMessage] = useState('')
  const generation = useRef({ value: 0 }).current

  // Discard results when credentials change or the user leaves this section.
  useEffect(() => {
    generation.value++
    setResult(null)
    setDetection(null)
    setBusy(null)
    return () => {
      generation.value++
    }
  }, [apiBaseURL, apiKey, apiHeaders, generation])

  let validation = ''
  try {
    normalizeProxySettings(draft)
  } catch (error) {
    validation = error instanceof Error ? error.message : '代理设置无效'
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(networkProxy)

  function edit(next: ProxySettings) {
    setDraft(next)
    setResult(null)
    setMessage('')
  }

  async function apply(value = draft) {
    const id = ++generation.value
    setBusy('save')
    setMessage('')
    try {
      const normalized = normalizeProxySettings(value)
      await window.api.updateAppSettings({ networkProxy: normalized })
      updateSetting('networkProxy', normalized)
      if (id === generation.value) {
        setDraft(normalized)
        setResult(null)
        setMessage('已保存，下一次 AI 请求和模型列表请求使用此设置')
      }
    } catch {
      if (id === generation.value) setMessage('保存失败，请检查代理地址后重试')
    } finally {
      if (id === generation.value) setBusy(null)
    }
  }

  async function detect() {
    const id = ++generation.value
    setBusy('detect')
    setMessage('')
    try {
      const found = await window.api.detectSystemProxy(apiBaseURL)
      if (id === generation.value) setDetection(found)
    } catch {
      if (id === generation.value) setDetection({ route: '', error: '无法检测系统代理，请重试' })
    } finally {
      if (id === generation.value) setBusy(null)
    }
  }

  async function test() {
    const id = ++generation.value
    setBusy('test')
    setResult(null)
    setMessage('')
    try {
      const tested = await window.api.testProxyConnection(normalizeProxySettings(draft), {
        apiBaseURL,
        apiKey,
        apiHeaders
      })
      if (id === generation.value) setResult(tested)
    } catch {
      if (id === generation.value) setMessage('测试失败，请检查代理设置后重试')
    } finally {
      if (id === generation.value) setBusy(null)
    }
  }

  return (
    <SettingsCard Icon={Network} title="网络代理">
      <div className="space-y-4">
        <p className="text-xs font-light leading-relaxed">
          用于截图问答、对话提示和模型列表；不修改系统代理。语音转录、手机同步和软件更新仍使用各自的网络连接。
        </p>
        <Field label="连接方式">
          <Select
            value={draft.mode}
            disabled={!!busy}
            onValueChange={(mode: ProxySettings['mode']) => edit({ ...draft, mode })}
          >
            <SelectTrigger aria-label="连接方式" className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">自动（跟随系统代理）</SelectItem>
              <SelectItem value="custom">自定义代理</SelectItem>
              <SelectItem value="direct">直连</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {draft.mode === 'custom' && (
          <div className="space-y-2">
            <label htmlFor="proxy-url" className="text-sm font-medium">
              代理地址
            </label>
            <input
              id="proxy-url"
              type="text"
              value={draft.url}
              disabled={!!busy}
              spellCheck={false}
              onChange={(event) => edit({ ...draft, url: event.target.value })}
              aria-invalid={!!validation}
              aria-describedby="proxy-url-note"
              placeholder="http://127.0.0.1:20808"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
            />
            <p id="proxy-url-note" className="text-xs font-light">
              支持
              http://、https://、socks5://，请填写代理客户端实际监听的地址和端口；暂不支持代理账号密码。
            </p>
          </div>
        )}
        {draft.mode === 'system' && (
          <p className="text-xs font-light">
            自动使用系统代理规则（含 PAC），系统端口变化后无需重新填写。
          </p>
        )}
        {draft.mode === 'direct' && (
          <p className="text-xs font-light">忽略系统代理，通过本机网络直接连接 API。</p>
        )}
        {validation && (
          <p role="alert" className="text-xs text-red-700">
            {validation}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={!!busy} onClick={detect}>
            检测系统代理
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy || !!validation} onClick={test}>
            测试连接
          </Button>
          <Button size="sm" disabled={!!busy || !!validation} onClick={() => apply()}>
            保存并应用
          </Button>
          {busy ? (
            <LoaderCircle aria-label="正在处理" className="h-4 w-4 animate-spin" />
          ) : (
            <span className="text-xs opacity-60">{dirty ? '尚未应用' : '已保存'}</span>
          )}
        </div>
        <p className="text-xs font-light">
          测试当前正在编辑的 AI 配置的模型列表接口，最长等待 10
          秒，不生成回答；测试不会保存代理设置。
        </p>

        {detection && (
          <div role="status" className="rounded-md border border-gray-400/50 p-3 text-xs space-y-2">
            <p>
              系统检测：
              {detection.error ||
                (detection.route === 'DIRECT' ? '此 API 地址使用直连' : detection.route)}
            </p>
            {!detection.error && (
              <Button
                size="sm"
                variant="outline"
                disabled={!!busy}
                onClick={() => apply({ ...DEFAULT_PROXY })}
              >
                使用系统代理并应用
              </Button>
            )}
          </div>
        )}
        {result && (
          <div role="status" className="rounded-md border border-gray-400/50 p-3 text-xs space-y-1">
            <p className={result.ok ? 'text-green-700' : 'text-amber-800'}>{result.message}</p>
            <p>
              耗时 {result.elapsedMs} ms{result.status ? ` · HTTP ${result.status}` : ''}
            </p>
            {result.route && <p className="break-all">请求路由：{result.route}</p>}
          </div>
        )}
        {message && (
          <p role="status" className="text-xs">
            {message}
          </p>
        )}
      </div>
    </SettingsCard>
  )
}
