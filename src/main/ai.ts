import { generateText, streamText, type ModelMessage, type TextStreamPart, type ToolSet } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { settings, getModeProfile } from './settings'
import { DEFAULT_API_BASE_URL, type ApiProfile, type AppMode } from '../shared/api-profile'
import { buildRequestHeaders } from '../shared/request-headers'
import { createThinkingOffFetch } from './thinking'
import { apiFetch } from './api-fetch'
import { getKnowledgePrompt, hasKnowledge } from './knowledge'
import type { StreamChunk } from './stream'

// The system prompts are fully managed by the renderer (prompt scenes in the
// settings store, one active scene per mode) and synced here via
// updateAppSettings on app startup. The mode's 资料库 material goes first
function getSystemPrompt(mode: AppMode, knowledge: string, extra?: string) {
  const prompt = mode === 'screenshot' ? settings.customPrompt : settings.conversationPrompt
  return [knowledge, prompt, extra].filter(Boolean).join('\n\n') || undefined
}

function userText(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

/** Only the current question and limited textual context become a local search query. */
async function retrievalQuery(
  messages: ModelMessage[],
  model: ReturnType<ReturnType<typeof createOpenAICompatible>['chatModel']>,
  abortSignal?: AbortSignal
): Promise<string> {
  const users = messages.filter((message) => message.role === 'user')
  const latest = users.at(-1)
  if (!latest) return ''
  const text = userText(latest)
  const contextual =
    text.length < 30 && /继续|再说|展开|详细|为什么|具体|这个|那个|它|上述|刚才|换个/.test(text)
  const focus = contextual ? users.slice(-2) : [latest]
  if (
    focus.some(
      (message) =>
        typeof message.content !== 'string' && message.content.some((part) => part.type === 'image')
    )
  ) {
    // No documents are sent for this image-to-query pass. This works with vision
    // providers that support plain chat but not tool calling.
    const { text } = await generateText({
      model,
      system:
        '读取截图和用户问题，提取用于搜索本地资料的关键主题、项目名、技术名词。只输出最多 12 个关键词，可补充常见中英文同义词；不要回答问题，不要输出推理过程。',
      messages: focus,
      maxOutputTokens: 512,
      abortSignal
    })
    return text.slice(0, 1000)
  }
  return focus.map(userText).join('\n').slice(-2000)
}

/** Tell the user once that the active model ignores the profile's 「关闭思考」 */
function reportThinkingRefused(model: string) {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('thinking-unsupported', model)
}

function createProvider(profile: ApiProfile) {
  // The app only ever talks OpenAI-compatible chat-completions; this provider
  // also surfaces thinking models' reasoning (`reasoning_content` / `reasoning`
  // deltas) as reasoning stream parts, which @ai-sdk/openai drops. It has no
  // default base URL, so an empty one means OpenAI here as everywhere else
  return createOpenAICompatible({
    name: 'shiping',
    baseURL: profile.apiBaseURL.trim() || DEFAULT_API_BASE_URL,
    apiKey: profile.apiKey,
    headers: buildRequestHeaders(profile.apiKey, profile.apiHeaders),
    fetch: profile.disableThinking
      ? createThinkingOffFetch(profile.apiBaseURL, reportThinkingRefused, apiFetch)
      : apiFetch
  })
}

function getModel(profile: ApiProfile) {
  const fallbackModel = profile.apiBaseURL.includes('siliconflow')
    ? 'Qwen/Qwen3-VL-32B-Instruct'
    : 'gpt-5-mini'
  return profile.model || fallbackModel
}

/**
 * One chunk at a time, tagged reasoning or answer text, so callers can route
 * them to their own events. Other stream parts (tool calls, sources, …) are
 * not produced with the plain chat setup and are dropped here.
 */
async function* streamChunks(
  fullStream: AsyncIterable<TextStreamPart<ToolSet>>
): AsyncIterable<StreamChunk> {
  for await (const event of fullStream) {
    if (event.type === 'reasoning-delta') yield { kind: 'reasoning', delta: event.text }
    else if (event.type === 'text-delta') yield { kind: 'text', delta: event.text }
  }
}

async function* streamWith(
  mode: AppMode,
  messages: ModelMessage[],
  abortSignal: AbortSignal | undefined,
  extraSystem?: string,
  queryText?: string
) {
  if (abortSignal?.aborted) return
  const profile = getModeProfile(mode)
  const openai = createProvider(profile)
  const model = openai.chatModel(getModel(profile))
  let knowledge = ''
  if (hasKnowledge(mode)) {
    const query = queryText ?? (await retrievalQuery(messages, model, abortSignal))
    if (abortSignal?.aborted) return
    knowledge = getKnowledgePrompt(mode, query)
  }

  const { fullStream } = streamText({
    model,
    system: getSystemPrompt(mode, knowledge, extraSystem),
    messages,
    abortSignal,
    onError: (err) => {
      throw err.error ?? err
    }
  })
  yield* streamChunks(fullStream)
}

export function getSolutionStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  return streamWith('screenshot', messages, abortSignal)
}

export function getFollowUpStream(
  messages: ModelMessage[],
  userQuestion: string,
  abortSignal?: AbortSignal
) {
  // Add the user's follow-up question to the conversation
  const updatedMessages: ModelMessage[] = [
    ...messages,
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: userQuestion
        }
      ]
    }
  ]
  return streamWith('screenshot', updatedMessages, abortSignal)
}

export function getGeneralStream(messages: ModelMessage[], abortSignal?: AbortSignal) {
  return streamWith(
    'screenshot',
    messages,
    abortSignal,
    '注意：如果有多张截图，请结合所有截图内容进行完整分析，不要遗漏任何部分。'
  )
}

/** 对话模式: a hint for what the other side just said, with the conversation profile */
export function getHintStream(
  messages: ModelMessage[],
  abortSignal?: AbortSignal,
  question?: string
) {
  return streamWith('conversation', messages, abortSignal, undefined, question)
}
