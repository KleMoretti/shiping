import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  FileText,
  FileUp,
  FolderOpen,
  LibraryBig,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { MODE_NAMES } from '@/lib/use-mode-page'
import type { AppMode } from '@/lib/store/settings'
import {
  formatChars,
  knowledgeUsage,
  useKnowledgeDocs,
  type KnowledgeDoc,
  type KnowledgeImportResult
} from '@/lib/knowledge'
import { SettingsCard } from '../components'
import {
  KNOWLEDGE_RETRIEVAL_LIMIT,
  type KnowledgeFolder,
  type KnowledgeFolderResult
} from '../../../../shared/knowledge'

const MODES: { mode: AppMode; label: string }[] = [
  { mode: 'screenshot', label: '截图' },
  { mode: 'conversation', label: '对话' }
]

/** Keep a large batch from flooding the screen with one toast per failure. */
function reportImport(result: KnowledgeImportResult) {
  const { added, failed } = result
  if (added.length === 1) toast.success(`已导入「${added[0].name}」`)
  else if (added.length > 1) toast.success(`已导入 ${added.length} 份资料`)
  if (failed.length > 0) toast.error(`${failed.length} 份资料导入失败，请查看导入结果`)
}

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')

/**
 * 资料库: material the AI should draw on (resume, prepared Q&A, notes). Main
 * keeps it on disk and retrieves relevant files for the modes ticked on it.
 * Files can be picked, indexed from folders, or dropped here.
 */
export function KnowledgeSection() {
  const [docs, setDocs] = useKnowledgeDocs()
  const [editing, setEditing] = useState<KnowledgeDoc | 'new' | null>(null)
  const [deleting, setDeleting] = useState<KnowledgeDoc | null>(null)
  const [folders, setFolders] = useState<KnowledgeFolder[]>([])
  const [deletingFolder, setDeletingFolder] = useState<KnowledgeFolder | null>(null)
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<
    KnowledgeImportResult | KnowledgeFolderResult | null
  >(null)
  const importInFlight = useRef(false)
  // dragenter / dragleave fire for every child crossed; only the outermost pair counts
  const dragDepth = useRef(0)

  useEffect(() => {
    window.api.listKnowledgeFolders().then(setFolders)
  }, [])

  // A file dropped beside the drop zone would otherwise replace the app with the file
  useEffect(() => {
    const block = (e: Event) => e.preventDefault()
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  const replaceDoc = (doc: KnowledgeDoc) =>
    setDocs((list) => list?.map((d) => (d.id === doc.id ? doc : d)) ?? null)

  const handleImport = (result: KnowledgeImportResult | KnowledgeFolderResult | null) => {
    if (!result) return
    if ('folder' in result) {
      const updates = new Map(result.updated.map((doc) => [doc.id, doc]))
      setDocs((list) => [
        ...(list ?? [])
          .filter((doc) => !result.removedIds.includes(doc.id))
          .map((doc) => updates.get(doc.id) ?? doc),
        ...result.added
      ])
      setFolders((list) => [
        ...list.filter((folder) => folder.id !== result.folder.id),
        result.folder
      ])
      toast.success('文件夹索引已刷新')
    } else {
      setDocs((list) => [...(list ?? []), ...result.added])
    }
    setImportResult(result)
    reportImport(result)
  }

  const importBatch = async (
    run: () => Promise<KnowledgeImportResult | KnowledgeFolderResult | null>
  ) => {
    if (importInFlight.current) return
    importInFlight.current = true
    setImporting(true)
    try {
      handleImport(await run())
    } catch (error) {
      toast.error('导入失败', {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      importInFlight.current = false
      setImporting(false)
    }
  }

  const removeFolder = async (folder: KnowledgeFolder) => {
    setDeletingFolder(null)
    await importBatch(async () => {
      await window.api.removeKnowledgeFolder(folder.id)
      setFolders((list) => list.filter((saved) => saved.id !== folder.id))
      setDocs((list) => list?.filter((doc) => doc.folderId !== folder.id) ?? null)
      setImportResult(null)
      return null
    })
  }

  const toggleMode = async (doc: KnowledgeDoc, mode: AppMode) => {
    const on = doc.modes.includes(mode)
    const modes = MODES.map((m) => m.mode).filter((m) => (m === mode ? !on : doc.modes.includes(m)))
    replaceDoc({ ...doc, modes })
    const saved = await window.api.updateKnowledge(doc.id, { modes })
    if (saved) replaceDoc(saved)
  }

  const reimport = async (doc: KnowledgeDoc) => {
    const { doc: updated, error } = await window.api.reimportKnowledge(doc.id)
    if (updated) {
      replaceDoc(updated)
      toast.success(`已从「${doc.source}」重新导入`)
    } else {
      toast.error('重新导入失败', { description: error })
    }
  }

  const remove = async (doc: KnowledgeDoc) => {
    setDeleting(null)
    setDocs((list) => list?.filter((d) => d.id !== doc.id) ?? null)
    await window.api.removeKnowledge(doc.id)
  }

  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragDepth.current++
      setDragging(true)
    },
    onDragLeave: (e: DragEvent) => {
      if (!hasFiles(e)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    },
    onDrop: async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragDepth.current = 0
      setDragging(false)
      const paths = [...e.dataTransfer.files]
        .map((file) => window.api.getPathForFile(file))
        .filter(Boolean)
      if (paths.length > 0) await importBatch(() => window.api.importKnowledgeFiles(paths))
    }
  }

  return (
    <div className="relative" aria-busy={importing} {...dropHandlers}>
      <SettingsCard Icon={LibraryBig} title="资料库">
        <p className="-mt-2 mb-4 text-xs font-light">
          选择文件夹，在本机读取文件并建立检索索引。提问时只将相关文件的完整正文和来源文件名发给
          AI，不会发送整个文件夹。已有单独导入和粘贴的资料也会按问题检索。
        </p>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={importing}
            onClick={() => importBatch(() => window.api.pickKnowledgeFolder())}
          >
            <FolderOpen className="h-4 w-4" />
            {importing ? '处理索引中…' : '选择文件夹'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={importing}
            onClick={() => importBatch(() => window.api.pickKnowledgeFiles())}
          >
            {importing ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4" />
            )}
            {importing ? '导入中…' : '批量导入文件'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="bg-white"
            onClick={() => setEditing('new')}
          >
            <Plus className="h-4 w-4" />
            新建文本
          </Button>
          <span className="text-xs font-light">
            支持 PDF、Word（.docx）、Markdown、TXT。按住 Ctrl / Shift 多选文件，或一次拖入多个文件
          </span>
        </div>

        <p className="mb-4 text-xs text-gray-600">
          包含子文件夹，跳过隐藏目录、node_modules
          和链接目录。文件变更后点击「刷新索引」。本地关键词检索每次最多发送{' '}
          {KNOWLEDGE_RETRIEVAL_LIMIT}{' '}
          个相关文件的完整正文，不按字数截断；纯截图会先通过当前视觉模型提取关键词，多一次请求。
        </p>

        {folders.length > 0 && (
          <ul className="mb-4 space-y-2">
            {folders.map((folder) => (
              <li
                key={folder.id}
                className="flex flex-wrap items-center gap-2 rounded-md border p-3"
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {folder.name} · {docs?.filter((doc) => doc.folderId === folder.id).length ?? 0}{' '}
                    份资料
                  </p>
                  <p className="break-all text-xs text-gray-600">{folder.path}</p>
                  <p className="text-xs text-gray-600">
                    上次扫描：{new Date(folder.updatedAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={importing}
                  onClick={() => importBatch(() => window.api.refreshKnowledgeFolder(folder.id))}
                >
                  <RefreshCw className="h-4 w-4" />
                  刷新索引
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={importing}
                  onClick={() => setDeletingFolder(folder)}
                >
                  移除
                </Button>
              </li>
            ))}
          </ul>
        )}

        {importResult && (
          <div className="mb-4 rounded-md border p-3 text-xs" role="status">
            <p>
              本次导入：成功 {importResult.added.length} 份，失败 {importResult.failed.length} 份
              {'folder' in importResult &&
                `；更新 ${importResult.updated.length} 份，移除 ${importResult.removedIds.length} 份`}
            </p>
            {importResult.failed.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-red-600">
                {importResult.failed.map((file, index) => (
                  <li key={index} className="break-words">
                    {file.name}：{file.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {docs && docs.length === 0 && (
          <div className="rounded-md border border-dashed border-gray-400 px-4 py-6 text-center text-sm text-gray-600">
            还没有资料。选择资料文件夹、导入文件，或新建文本粘贴问答
          </div>
        )}

        {docs && docs.length > 0 && (
          <>
            <ul className="max-h-96 space-y-2 overflow-y-auto">
              {docs.map((doc) => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  onToggleMode={(mode) => toggleMode(doc, mode)}
                  onEdit={() => setEditing(doc)}
                  onReimport={() => reimport(doc)}
                  onDelete={() => setDeleting(doc)}
                />
              ))}
            </ul>
            <UsageMeter docs={docs} />
          </>
        )}
      </SettingsCard>

      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-500 bg-blue-50/80 text-sm font-medium text-blue-700">
          {importing ? '正在导入，请稍候再拖入文件' : '松开鼠标批量导入资料'}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        {editing && (
          <DocEditor
            key={editing === 'new' ? 'new' : editing.id}
            target={editing}
            onClose={() => setEditing(null)}
            onSaved={(doc) =>
              editing === 'new' ? setDocs((list) => [...(list ?? []), doc]) : replaceDoc(doc)
            }
          />
        )}
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除资料</DialogTitle>
            <DialogDescription>
              确定删除资料「{deleting?.name}」吗？删除后无法恢复
              {deleting?.source && '，原文件不受影响'}。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => deleting && remove(deleting)}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deletingFolder} onOpenChange={(open) => !open && setDeletingFolder(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>移除资料文件夹</DialogTitle>
            <DialogDescription>
              移除「{deletingFolder?.name}」及其本地索引。原文件夹和文件不会删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingFolder(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingFolder && removeFolder(deletingFolder)}
            >
              移除索引
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DocRow({
  doc,
  onToggleMode,
  onEdit,
  onReimport,
  onDelete
}: {
  doc: KnowledgeDoc
  onToggleMode: (mode: AppMode) => void
  onEdit: () => void
  onReimport: () => void
  onDelete: () => void
}) {
  const meta = [doc.source && `来自 ${doc.source}`, formatChars(doc.chars)]
  if (doc.modes.length === 0) meta.push('未启用')

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-gray-400/60 bg-white/40 px-3 py-2">
      <FileText className="h-4 w-4 shrink-0 text-gray-600" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{doc.name}</div>
        <div className="truncate text-xs text-gray-600">{meta.filter(Boolean).join(' · ')}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {MODES.map(({ mode, label }) => {
          const on = doc.modes.includes(mode)
          return (
            <button
              key={mode}
              className={cn(
                'rounded-md border px-2 py-0.5 text-xs transition-colors cursor-pointer',
                on
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-gray-300 text-gray-500 hover:border-blue-400'
              )}
              title={on ? `点击后不再用于${MODE_NAMES[mode]}` : `点击用于${MODE_NAMES[mode]}`}
              onClick={() => onToggleMode(mode)}
            >
              {label}
            </button>
          )
        })}
        <RowAction title="查看 / 编辑文字" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </RowAction>
        {doc.sourcePath ? (
          <RowAction title="从原文件重新导入（会覆盖在这里做的修改）" onClick={onReimport}>
            <RefreshCw className="h-3.5 w-3.5" />
          </RowAction>
        ) : (
          // Pasted text has nothing to reimport; keep the columns lined up with the rows that do
          <span className="w-6.5" />
        )}
        <RowAction title="删除" onClick={onDelete} danger>
          <Trash2 className="h-3.5 w-3.5" />
        </RowAction>
      </div>
    </li>
  )
}

function RowAction({
  title,
  onClick,
  danger,
  children
}: {
  title: string
  onClick: () => void
  danger?: boolean
  children: ReactNode
}) {
  return (
    <button
      className={cn(
        'rounded p-1.5 text-gray-600 transition-colors cursor-pointer hover:bg-black/10',
        danger ? 'hover:text-red-600' : 'hover:text-gray-900'
      )}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

/** Library size is independent of the bounded excerpts sent for a question. */
function UsageMeter({ docs }: { docs: KnowledgeDoc[] }) {
  const usages = MODES.map(({ mode }) => ({ mode, ...knowledgeUsage(docs, mode) }))

  return (
    <div className="mt-4 space-y-2">
      {usages.map(({ mode, count, chars }) => (
        <div key={mode}>
          <div className="mb-1 flex justify-between gap-2 text-xs">
            <span>{MODE_NAMES[mode]}可检索资料</span>
            <span className="text-gray-600">
              {count > 0 ? `${count} 份 · ${formatChars(chars)}` : '未启用资料'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Paste a new piece of material, or view and correct one (a PDF's layout often needs it) */
function DocEditor({
  target,
  onClose,
  onSaved
}: {
  target: KnowledgeDoc | 'new'
  onClose: () => void
  onSaved: (doc: KnowledgeDoc) => void
}) {
  const isNew = target === 'new'
  const [name, setName] = useState(isNew ? '' : target.name)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (target === 'new') return
    let alive = true
    window.api.getKnowledgeText(target.id).then((saved) => {
      if (!alive) return
      setText(saved)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [target])

  const save = async () => {
    setSaving(true)
    const doc = isNew
      ? await window.api.createKnowledge(name, text)
      : await window.api.updateKnowledge(target.id, { name, text })
    setSaving(false)
    if (doc) onSaved(doc)
    onClose()
  }

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{isNew ? '新建文本' : '编辑资料'}</DialogTitle>
        <DialogDescription>
          {isNew
            ? '粘贴简历、岗位 JD、准备好的问答或笔记；保存后随时可以修改'
            : '这是发给 AI 的文字，可以删掉无关内容、修正排版错乱；保存后从下一次请求开始生效'}
        </DialogDescription>
      </DialogHeader>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="资料名称，如「我的简历」「八股问答」，AI 会看到这个名称"
        maxLength={40}
        autoFocus={isNew}
      />
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={loading}
        placeholder={
          loading
            ? '读取中…'
            : '在这里粘贴内容。问答可以写成：\n问：为什么从上一家公司离职？\n答：……'
        }
        className="max-h-[50vh] min-h-48 bg-white overflow-y-auto"
      />
      <DialogFooter className="items-center sm:justify-between">
        <span className="text-xs text-gray-600">{formatChars(text.trim().length)}</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={save} disabled={loading || saving || !text.trim()}>
            保存
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  )
}
