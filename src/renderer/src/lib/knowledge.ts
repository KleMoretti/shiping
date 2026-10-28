import { useEffect, useState } from 'react'
import type { AppMode } from '../../../shared/api-profile'
import { type KnowledgeDoc, type KnowledgeImportResult } from '../../../shared/knowledge'

export type { KnowledgeDoc, KnowledgeImportResult }

/**
 * The 资料库 list, fetched from main (which owns it) on mount; null until it
 * arrives. The setter is for what the page itself changed.
 */
export function useKnowledgeDocs() {
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null)
  useEffect(() => {
    let alive = true
    window.api.listKnowledge().then((list) => {
      if (alive) setDocs(list)
    })
    return () => {
      alive = false
    }
  }, [])
  return [docs, setDocs] as const
}

/** How much local material a mode can search, not the size of a request. */
export function knowledgeUsage(docs: KnowledgeDoc[], mode: AppMode) {
  const used = docs.filter((doc) => doc.modes.includes(mode))
  const chars = used.reduce((sum, doc) => sum + doc.chars, 0)
  return { count: used.length, chars }
}

/** 860 字 / 3,210 字 / 1.2 万字 */
export function formatChars(chars: number): string {
  if (chars < 10000) return `${chars.toLocaleString()} 字`
  return `${(chars / 10000).toFixed(1).replace(/\.0$/, '')} 万字`
}

/** 约 9,000 token: the estimate is rough, so it is rounded to the hundred */
export function formatTokens(tokens: number): string {
  const rounded = tokens < 1000 ? tokens : Math.round(tokens / 100) * 100
  return `约 ${rounded.toLocaleString()} token`
}
