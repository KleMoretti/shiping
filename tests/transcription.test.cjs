const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const load = require('./load-source.cjs')

test('both modes send the selected speech model; older settings keep Fun-ASR', () => {
  const { TRANSCRIPTION_MODELS, resolveTranscriptionModel } = load('src/shared/transcription.ts')
  assert.equal(resolveTranscriptionModel(undefined), 'fun-asr-realtime')
  assert.equal(resolveTranscriptionModel('unsupported'), 'fun-asr-realtime')
  for (const purpose of ['screenshot', 'conversation']) {
    for (const model of TRANSCRIPTION_MODELS) {
      const handlers = new Map()
      let socket
      class Socket extends EventEmitter {
        static OPEN = 1
        static CONNECTING = 0
        readyState = 1
        sent = []
        constructor() {
          super()
          socket = this
        }
        send(data) {
          this.sent.push(JSON.parse(data))
        }
        close() {}
      }
      load('src/main/transcription.ts', {
        electron: { ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} } },
        ws: Socket,
        './settings': { settings: { transcriptionModel: model.id } }
      })
      handlers.get('start-transcription')(null, 'test-key', { purpose, maxSentenceSilence: 800 })
      socket.emit('open')
      assert.equal(socket.sent[0].payload.model, model.id)
      assert.equal(socket.sent[0].payload.parameters.sample_rate, 16000)
      assert.equal(socket.sent[0].payload.parameters.max_sentence_silence, 800)
      handlers.get('stop-transcription')()
    }
  }
})
