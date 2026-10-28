import { readdir, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { KNOWLEDGE_EXTENSIONS } from '../shared/knowledge'

/** Scan supported files without following junctions/symlinks outside the selected tree. */
export async function scanKnowledgeFolder(root: string) {
  if (!(await stat(root)).isDirectory()) throw new Error('请选择一个文件夹')
  const files: { path: string; source: string }[] = []
  const failed: { name: string; error: string }[] = []
  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      failed.push({ name: relative(root, directory) || root, error: String(error.message) })
      return []
    })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') await walk(path)
      } else if (
        entry.isFile() &&
        KNOWLEDGE_EXTENSIONS.includes(extname(entry.name).slice(1).toLowerCase())
      ) {
        files.push({ path, source: relative(root, path) })
      }
    }
  }
  await walk(root)
  return { files, failed }
}
