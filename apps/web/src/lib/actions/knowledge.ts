'use server'

import { revalidatePath } from 'next/cache'
import { prisma } from '@wa/db'
import { requireRole } from '@/lib/auth'
import {
  createDocument,
  deleteDocument,
  getDocument,
  searchKnowledge,
  updateDocument,
  type KnowledgeAnswer,
} from '@/lib/knowledge'
import { checkKnowledgeInput } from '@/lib/knowledge-rules'

export type KnowledgeFormState = { error?: string; saved?: boolean }

export type KnowledgeTestResult = { ok: true; answer: KnowledgeAnswer; ms: number } | { ok: false; error: string }

function idOf(value: unknown) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * Creates a document, or replaces one when the form carries an id.
 *
 * The audit row keeps the full text on both sides: the service keeps no
 * history, so this is the only way back from a bad edit.
 */
export async function saveKnowledgeDoc(_prev: KnowledgeFormState, formData: FormData): Promise<KnowledgeFormState> {
  const user = await requireRole('ADMIN')

  const rawId = String(formData.get('id') ?? '')
  const id = rawId ? idOf(rawId) : null
  if (rawId && !id) return { error: 'Dokumen tidak ditemukan.' }

  const input = {
    category: String(formData.get('category') ?? '').trim() || 'Umum',
    title: String(formData.get('title') ?? '').trim(),
    content: String(formData.get('content') ?? '').trim(),
  }
  const bad = checkKnowledgeInput(input)
  if (bad) return { error: bad }

  let before: { category: string; title: string; content: string } | null = null
  let savedId = id
  if (id) {
    const current = await getDocument(id)
    if (!current.ok) return { error: current.error }
    before = { category: current.data.category, title: current.data.title, content: current.data.content }

    const res = await updateDocument(id, input)
    if (!res.ok) return { error: res.error }
  } else {
    const res = await createDocument(input)
    if (!res.ok) return { error: res.error }
    savedId = res.data.id
  }

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: id ? 'knowledge.update' : 'knowledge.create',
      resourceType: 'KnowledgeDocument',
      resourceId: savedId ? String(savedId) : null,
      diff: before ? { from: before, to: input } : input,
    },
  })

  revalidatePath('/knowledge')
  return { saved: true }
}

export async function deleteKnowledgeDoc(rawId: number): Promise<{ error?: string }> {
  const user = await requireRole('ADMIN')
  const id = idOf(rawId)
  if (!id) return { error: 'Dokumen tidak ditemukan.' }

  // Read first so the audit row can bring the text back if this was a mistake.
  const current = await getDocument(id)
  if (!current.ok) return { error: current.error }

  const res = await deleteDocument(id)
  if (!res.ok) return { error: res.error }

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'knowledge.delete',
      resourceType: 'KnowledgeDocument',
      resourceId: String(id),
      diff: { category: current.data.category, title: current.data.title, content: current.data.content },
    },
  })

  revalidatePath('/knowledge')
  return {}
}

/** Each test spends Gemini quota, so viewers only read. */
export async function testKnowledgeSearch(question: string): Promise<KnowledgeTestResult> {
  await requireRole('AGENT')

  const q = String(question ?? '').trim()
  if (!q) return { ok: false, error: 'Tulis pertanyaan uji dulu.' }
  if (q.length > 500) return { ok: false, error: 'Pertanyaan uji maksimum 500 karakter.' }

  const res = await searchKnowledge(q)
  return res.ok ? { ok: true, ...res.data } : res
}
