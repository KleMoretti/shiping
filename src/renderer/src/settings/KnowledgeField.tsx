import { cn } from '@/lib/utils'
import type { AppMode } from '@/lib/store/settings'
import { formatChars, knowledgeUsage, useKnowledgeDocs } from '@/lib/knowledge'
import { Field } from './components'

/** A mode's share of the 资料库, with the way to it; the material itself is managed there */
export function KnowledgeField({ mode, onOpen }: { mode: AppMode; onOpen: () => void }) {
  const [docs] = useKnowledgeDocs()
  const usage = docs && knowledgeUsage(docs, mode)

  return (
    <Field
      label="参考资料"
      note="按当前问题在本机检索，最多发送 6 个相关文件的完整正文；没有命中时不带资料"
    >
      <button
        className={cn(
          'max-w-60 shrink-0 truncate text-xs transition-colors cursor-pointer hover:underline',
          'text-blue-700'
        )}
        onClick={onOpen}
      >
        {!usage
          ? ''
          : usage.count > 0
            ? `${usage.count} 份可检索 · ${formatChars(usage.chars)}`
            : '未使用，去资料库添加'}
      </button>
    </Field>
  )
}
