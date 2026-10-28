const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const load = require('./load-source.cjs')

test('batch picker is parented, persists multiple documents and continues after a failed file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiping-knowledge-'))
  const previousWindow = global.mainWindow
  const parent = { isDestroyed: () => false }
  const handlers = new Map()
  let cancelled = false
  global.mainWindow = parent
  try {
    load('src/main/knowledge.ts', {
      electron: {
        app: { getPath: () => dir },
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
        dialog: {
          showOpenDialog: async (window, options) => {
            assert.equal(window, parent)
            assert.ok(options.properties.includes('multiSelections'))
            return { canceled: cancelled, filePaths: ['resume.md', 'broken.pdf', 'notes.txt'] }
          }
        }
      },
      './knowledge-parse': {
        normalizeText: (text) => text.trim(),
        extractFileText: async (file) => {
          if (file === 'broken.pdf') throw new Error('无法读取 PDF')
          return `正文 ${file}`
        }
      }
    })
    const result = await handlers.get('knowledge:pick-files')()
    assert.deepEqual(
      result.added.map((doc) => doc.name),
      ['resume', 'notes']
    )
    assert.deepEqual(result.failed, [{ name: 'broken.pdf', error: '无法读取 PDF' }])
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'knowledge/index.json'), 'utf8'))
    assert.equal(saved.length, 2)
    for (const doc of saved) {
      assert.match(fs.readFileSync(path.join(dir, 'knowledge', `${doc.id}.txt`), 'utf8'), /正文/)
    }
    const dropped = await handlers.get('knowledge:import-files')(null, ['drop1.md', 'drop2.txt'])
    assert.equal(dropped.added.length, 2)
    assert.equal(handlers.get('knowledge:list')().length, 4)
    cancelled = true
    assert.equal(await handlers.get('knowledge:pick-files')(), null)
  } finally {
    global.mainWindow = previousWindow
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('folder indexing scans subfolders, refreshes modified/deleted files, and retains individual material', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiping-folder-'))
  const root = path.join(dir, 'material')
  fs.mkdirSync(path.join(root, 'nested'), { recursive: true })
  fs.mkdirSync(path.join(root, '.git'))
  fs.writeFileSync(path.join(root, 'nested', 'Redis.md'), 'Redis 缓存穿透，使用布隆过滤器。')
  fs.writeFileSync(path.join(root, 'other.txt'), '旅行摄影风景。')
  fs.writeFileSync(path.join(root, '.git', 'secret.md'), '不要索引此目录')
  fs.writeFileSync(path.join(root, 'ignored.png'), 'unsupported')
  const handlers = new Map()
  try {
    const mocks = {
      electron: {
        app: { getPath: () => path.join(dir, 'user') },
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
        dialog: {
          showOpenDialog: async (...args) => {
            assert.ok(args.at(-1).properties.includes('openDirectory'))
            return { canceled: false, filePaths: [root] }
          }
        }
      }
    }
    const knowledge = load('src/main/knowledge.ts', mocks)
    const manual = await handlers.get('knowledge:create')(null, '个人经历', 'Java 后端开发经历')
    const result = await handlers.get('knowledge:pick-folder')()
    assert.equal(result.added.length, 2)
    assert.equal(result.failed.length, 0)
    assert.ok(knowledge.getKnowledgePrompt('conversation', 'Redis').includes('布隆过滤器'))
    assert.ok(!knowledge.getKnowledgePrompt('conversation', 'Redis').includes('旅行摄影'))
    assert.equal(knowledge.getKnowledgePrompt('conversation', '天文学星系'), '')
    const redis = result.added.find((doc) => doc.name === 'Redis')
    await handlers.get('knowledge:update')(null, redis.id, { modes: ['conversation'] })
    assert.equal(knowledge.getKnowledgePrompt('screenshot', 'Redis'), '')
    fs.writeFileSync(
      path.join(root, 'nested', 'Redis.md'),
      'Redis 缓存穿透改为使用空值缓存，更新后保留此内容。'
    )
    fs.unlinkSync(path.join(root, 'other.txt'))
    fs.writeFileSync(path.join(root, 'MySQL.txt'), 'MySQL 事务隔离级别')
    const refreshed = await handlers.get('knowledge:refresh-folder')(null, result.folder.id)
    assert.equal(refreshed.updated.length, 1)
    assert.deepEqual(refreshed.updated[0].modes, ['conversation'])
    assert.equal(refreshed.added.length, 1)
    assert.equal(refreshed.removedIds.length, 1)
    assert.match(knowledge.getKnowledgePrompt('conversation', 'Redis'), /更新后保留此内容/)
    assert.doesNotMatch(knowledge.getKnowledgePrompt('conversation', 'Redis'), /布隆过滤器/)
    const restarted = load('src/main/knowledge.ts', mocks)
    assert.equal(handlers.get('knowledge:folders')().length, 1)
    assert.match(restarted.getKnowledgePrompt('conversation', 'Redis'), /更新后保留此内容/)
    await handlers.get('knowledge:remove-folder')(null, result.folder.id)
    assert.equal(handlers.get('knowledge:list')().length, 1)
    assert.equal(handlers.get('knowledge:list')()[0].id, manual.id)
    assert.ok(fs.existsSync(path.join(root, 'nested', 'Redis.md')))
    assert.equal(restarted.getKnowledgePrompt('conversation', 'Redis'), '')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
