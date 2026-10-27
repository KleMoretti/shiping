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
