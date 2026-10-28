import type { AppMode } from '../shared/api-profile'
import { KNOWLEDGE_RETRIEVAL_LIMIT, type KnowledgeDoc } from '../shared/knowledge'

const STOP_WORDS = new Set(
  '什么 如何 怎么 为什么 哪些 介绍 一下 这个 那个 可以 进行 我们 你们 他们 的 是 和 与 了 吗 呢 the a an is are of to in and for'.split(
    ' '
  )
)
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })

/** Word segmentation plus Han bigrams keeps technical names and Chinese compounds searchable. */
function terms(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase()
  const result = [...segmenter.segment(normalized)]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment)
  for (const match of normalized.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    for (let i = 0; i < match[0].length - 1; i++) result.push(match[0].slice(i, i + 2))
  }
  return result.filter((term) => !STOP_WORDS.has(term))
}

function splitText(text: string): string[] {
  const chunks: string[] = []
  for (let start = 0; start < text.length; ) {
    let end = Math.min(start + 1000, text.length)
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n', end)
      if (boundary > start + 600) end = boundary
    }
    chunks.push(text.slice(start, end))
    if (end === text.length) break
    start = end - 150
  }
  return chunks
}

interface Chunk {
  frequencies: Map<string, number>
  length: number
}

interface IndexedDoc {
  doc: KnowledgeDoc
  text: string
  titleTerms: Set<string>
  chunks: Chunk[]
}

export interface KnowledgeHit {
  docId: string
  name: string
  source?: string
  text: string
}

/** In-memory lexical index rebuilt from the saved text snapshots on startup. */
export class KnowledgeSearchIndex {
  private documents = new Map<string, IndexedDoc>()

  set(doc: KnowledgeDoc, text: string): void {
    this.documents.set(doc.id, {
      doc: { ...doc },
      text,
      titleTerms: new Set(terms(`${doc.name} ${doc.source ?? ''}`)),
      chunks: splitText(text).map((text) => {
        const tokens = terms(text)
        const frequencies = new Map<string, number>()
        for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
        return { frequencies, length: tokens.length }
      })
    })
  }

  delete(id: string): void {
    this.documents.delete(id)
  }

  search(mode: AppMode, query: string): KnowledgeHit[] {
    const queryTerms = [...new Set(terms(query.slice(0, 2000)))]
    if (!queryTerms.length) return []
    const docs = [...this.documents.values()].filter(({ doc }) => doc.modes.includes(mode))
    const chunks = docs.flatMap((entry) => entry.chunks.map((chunk) => ({ entry, chunk })))
    const count = chunks.length
    if (!count) return []
    const average = chunks.reduce((sum, { chunk }) => sum + chunk.length, 0) / count || 1
    const documentFrequency = new Map(
      queryTerms.map((term) => [
        term,
        chunks.filter(
          ({ entry, chunk }) => entry.titleTerms.has(term) || chunk.frequencies.has(term)
        ).length
      ])
    )
    const ranked = chunks
      .map(({ entry, chunk }) => {
        let score = 0
        for (const term of queryTerms) {
          const frequency =
            (chunk.frequencies.get(term) ?? 0) + (entry.titleTerms.has(term) ? 2 : 0)
          if (!frequency) continue
          const df = documentFrequency.get(term) ?? 0
          const idf = Math.log(1 + (count - df + 0.5) / (df + 0.5))
          score +=
            (idf * frequency * 2.2) / (frequency + 1.2 * (0.25 + (0.75 * chunk.length) / average))
        }
        return { entry, chunk, score }
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)

    const hits: KnowledgeHit[] = []
    const selected = new Set<string>()
    for (const {
      entry: { doc, text }
    } of ranked) {
      if (hits.length >= KNOWLEDGE_RETRIEVAL_LIMIT) break
      if (selected.has(doc.id)) continue
      hits.push({ docId: doc.id, name: doc.name, source: doc.source, text })
      selected.add(doc.id)
    }
    return hits
  }
}
