const { test } = require('node:test')
const assert = require('node:assert/strict')
const load = require('./load-source.cjs')

test('retrieval chooses at most six distinct relevant files and preserves full text beyond 6000 chars', () => {
  const { KnowledgeSearchIndex } = load('src/main/knowledge-search.ts')
  const index = new KnowledgeSearchIndex()
  const full =
    '# Redis 缓存穿透\n' + '缓存穿透采用布隆过滤器和空值缓存。\n'.repeat(500) + '文件结尾保留标记'
  for (let i = 0; i < 9; i++) {
    index.set({ id: `redis-${i}`, name: `Redis-${i}`, modes: ['conversation'] }, full)
  }
  index.set({ id: 'other', name: '旅行', modes: ['conversation'] }, '海边日落与摄影')
  index.set({ id: 'hidden', name: 'Redis', modes: [] }, 'Redis 缓存穿透')
  const hits = index.search('conversation', 'Redis 缓存穿透如何处理')
  assert.equal(hits.length, 6)
  assert.equal(new Set(hits.map((hit) => hit.docId)).size, 6)
  assert.ok(hits.every((hit) => hit.text === full && hit.text.length > 6000))
  assert.ok(hits.every((hit) => hit.docId.startsWith('redis-')))
  assert.deepEqual(index.search('screenshot', 'Redis'), [])
  assert.deepEqual(index.search('conversation', '天文学星系'), [])
  index.set({ id: 'redis-0', name: 'Redis-0', modes: [] }, full)
  assert.ok(index.search('conversation', 'Redis').every((hit) => hit.docId !== 'redis-0'))
  index.delete('redis-1')
  assert.ok(index.search('conversation', 'Redis').every((hit) => hit.docId !== 'redis-1'))
})
