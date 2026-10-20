import { settings } from './settings'
import { fetchWithProxy } from './proxy'

/** One transport for chat streams, model lists and thinking-off retries. */
export const apiFetch: typeof fetch = (input, init) =>
  fetchWithProxy(settings.networkProxy, input, init)
