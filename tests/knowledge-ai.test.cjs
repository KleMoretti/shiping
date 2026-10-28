const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./load-source.cjs')

test('text questions search locally; image questions extract keywords without any documents in that request', async () => {
  const planning = [],
    requests = [],
    queries = []
  const controller = new AbortController()
  const profile = { apiBaseURL: 'https://example.com/v1', apiKey: '', model: 'fixture' }
  const ai = load('src/main/ai.ts', {
    './settings': {
      settings: { customPrompt: '场景', conversationPrompt: '对话场景' },
      getModeProfile: () => profile
    },
    './api-fetch': { apiFetch: async () => new Response('{}') },
    './knowledge': {
      hasKnowledge: () => true,
      getKnowledgePrompt: (mode, query) => {
        queries.push({ mode, query })
        return query.includes('Redis') ? '选中的 Redis 文件全文' : ''
      }
    },
    ai: {
      generateText: async (options) => {
        planning.push(options)
        return { text: 'Redis 缓存穿透' }
      },
      streamText: (options) => {
        requests.push(options)
        return { fullStream: [{ type: 'text-delta', text: '回答' }] }
      }
    },
    '@ai-sdk/openai-compatible': { createOpenAICompatible: () => ({ chatModel: () => ({}) }) }
  })
  const drain = async (stream) => {
    const output = []
    for await (const part of stream) output.push(part)
    return output
  }
  await drain(ai.getHintStream([{ role: 'user', content: 'Redis 缓存穿透？' }], controller.signal))
  assert.equal(planning.length, 0)
  assert.match(requests[0].system, /选中的 Redis 文件全文/)
  await drain(
    ai.getFollowUpStream([{ role: 'user', content: 'Redis' }], '天文学星系', controller.signal)
  )
  assert.doesNotMatch(requests[1].system, /选中的/)
  const image = {
    role: 'user',
    content: [
      { type: 'text', text: '请分析截图' },
      { type: 'image', image: 'data:image/png;base64,fixture' }
    ]
  }
  await drain(ai.getSolutionStream([image], controller.signal))
  assert.equal(planning.length, 1)
  assert.deepEqual(planning[0].messages, [image])
  assert.doesNotMatch(planning[0].system, /选中的 Redis 文件全文/)
  assert.equal(planning[0].abortSignal, controller.signal)
  assert.equal(requests[2].abortSignal, controller.signal)
  assert.equal(queries[2].query, 'Redis 缓存穿透')
  assert.match(requests[2].system, /选中的 Redis 文件全文/)
  controller.abort()
  await drain(ai.getSolutionStream([image], controller.signal))
  assert.equal(requests.length, 3)
})
