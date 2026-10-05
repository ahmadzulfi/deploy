/**
 * Limits for a knowledge document, shared by the form and the server action.
 *
 * Title and category mirror the service's columns (VARCHAR 255 / 100), so a
 * long title is refused here rather than as a database error from Go.
 */

export const KNOWLEDGE_CATEGORY_MAX = 100
export const KNOWLEDGE_TITLE_MAX = 255
/**
 * Each document becomes one embedding and the service does not split long
 * text, so past roughly 800 words the end of a document stops counting.
 * The cap keeps that from happening silently.
 */
export const KNOWLEDGE_CONTENT_MAX = 8000

export interface KnowledgeInput {
  category: string
  title: string
  content: string
}

export function checkKnowledgeInput(input: KnowledgeInput): string | null {
  if (!input.title) return 'Judul wajib diisi.'
  if (!input.content) return 'Isi dokumen wajib diisi.'
  if (input.category.length > KNOWLEDGE_CATEGORY_MAX) return `Kategori maksimum ${KNOWLEDGE_CATEGORY_MAX} karakter.`
  if (input.title.length > KNOWLEDGE_TITLE_MAX) return `Judul maksimum ${KNOWLEDGE_TITLE_MAX} karakter.`
  if (input.content.length > KNOWLEDGE_CONTENT_MAX) {
    return `Isi maksimum ${KNOWLEDGE_CONTENT_MAX} karakter. Pecah jadi beberapa dokumen per topik.`
  }
  return null
}
