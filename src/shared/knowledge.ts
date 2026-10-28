import type { AppMode } from './api-profile'

/**
 * 资料库: one piece of reference material the user brought (a resume, prepared
 * Q&A, notes). Main keeps the list and each text on disk, and puts the ones a
 * mode uses in front of that mode's system prompt.
 */
export interface KnowledgeDoc {
  id: string
  name: string
  /** File name it was imported from; absent for pasted text */
  source?: string
  /** Full path of that file, for 「重新导入」 */
  sourcePath?: string
  /** Folder index this file belongs to; absent for individually imported material. */
  folderId?: string
  sourceMtimeMs?: number
  sourceSize?: number
  chars: number
  /** Rough estimate, see `estimateTokens` */
  tokens: number
  /** Modes whose requests carry it; empty means it is kept but not sent */
  modes: AppMode[]
  updatedAt: number
}

export type KnowledgePatch = Partial<Pick<KnowledgeDoc, 'name' | 'modes'>> & { text?: string }

export interface KnowledgeImportResult {
  added: KnowledgeDoc[]
  failed: { name: string; error: string }[]
}

export interface KnowledgeFolder {
  id: string
  name: string
  path: string
  updatedAt: number
}

export interface KnowledgeFolderResult extends KnowledgeImportResult {
  folder: KnowledgeFolder
  updated: KnowledgeDoc[]
  removedIds: string[]
}

/** Retrieve at most six relevant files, without truncating their contents. */
export const KNOWLEDGE_RETRIEVAL_LIMIT = 6

/** File types the importer reads */
export const KNOWLEDGE_EXTENSIONS = ['pdf', 'docx', 'md', 'markdown', 'txt']

const CJK = /[\u3000-\u303f\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g

/**
 * Tokens `text` roughly costs: about 0.7 per Chinese character and one per 3.5
 * other characters, near what DeepSeek / Qwen / GPT tokenisers give
 */
export function estimateTokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0
  return Math.ceil(cjk * 0.7 + (text.length - cjk) / 3.5)
}
