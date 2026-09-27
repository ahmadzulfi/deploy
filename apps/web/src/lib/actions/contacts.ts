'use server'

import { revalidatePath } from 'next/cache'
import { prisma, OptInStatus, type Prisma } from '@wa/db'
import { contactRowsFromCsv, normalizeWaId } from '@wa/core'
import { hasRole, requireUser } from '@/lib/auth'

export type ContactState = { error?: string; ok?: number }

type User = Awaited<ReturnType<typeof requireUser>>

async function ownContact(user: User, id: string) {
  const c = await prisma.contact.findUnique({ where: { id } })
  return c && c.orgId === user.orgId ? c : null
}

const KEY = /^[A-Za-z_][\w]{0,49}$/

/**
 * Parses the attributes box: one `key=value` per line.
 *
 * Values typed here are text. A key whose text is unchanged keeps its old
 * value as-is, so a number or true/false written by the API is not quietly
 * turned into a string just because someone edited a different line.
 */
function parseAttributes(raw: string, previous: Record<string, unknown>): Record<string, unknown> | string {
  const out: Record<string, unknown> = {}
  for (const [i, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const eq = line.indexOf('=')
    if (eq < 0) return `Baris ${i + 1}: pakai format kunci=nilai.`
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (!KEY.test(key)) {
      return `Baris ${i + 1}: kunci "${key}" hanya boleh huruf, angka, dan garis bawah, tidak diawali angka.`
    }
    const old = previous[key]
    out[key] = old !== undefined && String(old) === value ? old : value
  }
  return out
}

export async function updateContact(_prev: ContactState, formData: FormData): Promise<ContactState> {
  const user = await requireUser()
  if (user.role === 'VIEWER') return { error: 'Peran kamu hanya bisa membaca.' }

  const contact = await ownContact(user, String(formData.get('id') ?? ''))
  if (!contact) return { error: 'Kontak tidak ditemukan.' }

  const name = String(formData.get('name') ?? '').trim()
  if (name.length > 200) return { error: 'Nama maksimal 200 karakter.' }

  const tags = [
    ...new Set(
      String(formData.get('tags') ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ]
  if (tags.some((t) => t.length > 50)) return { error: 'Satu tag maksimal 50 karakter.' }
  if (tags.length > 50) return { error: 'Maksimal 50 tag per kontak.' }

  const attributes = parseAttributes(
    String(formData.get('attributes') ?? ''),
    (contact.attributes ?? {}) as Record<string, unknown>,
  )
  if (typeof attributes === 'string') return { error: attributes }

  await prisma.contact.update({
    where: { id: contact.id },
    data: { name: name || null, tags, attributes: attributes as Prisma.InputJsonValue },
  })
  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'contact.update',
      resourceType: 'Contact',
      resourceId: contact.id,
      diff: {
        before: { name: contact.name, tags: contact.tags, attributes: contact.attributes },
        after: { name: name || null, tags, attributes },
      } as Prisma.InputJsonValue,
    },
  })

  revalidatePath(`/contacts/${contact.id}`)
  revalidatePath('/contacts')
  return { ok: Date.now() }
}

/**
 * Records a contact's consent by hand - someone who asked by phone to stop,
 * or who agreed in person. Broadcasts respect it on their next start.
 */
export async function setOptIn(contactId: string, optedIn: boolean) {
  const user = await requireUser()
  if (user.role === 'VIEWER') return

  const contact = await ownContact(user, contactId)
  if (!contact) return

  await prisma.contact.update({
    where: { id: contact.id },
    data: optedIn
      ? { optInStatus: OptInStatus.OPTED_IN, optInSource: `manual:${user.id}`, optInAt: new Date(), optOutAt: null }
      : { optInStatus: OptInStatus.OPTED_OUT, optOutAt: new Date() },
  })
  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: optedIn ? 'contact.opt_in' : 'contact.opt_out',
      resourceType: 'Contact',
      resourceId: contact.id,
      diff: { from: contact.optInStatus },
    },
  })

  revalidatePath(`/contacts/${contact.id}`)
  revalidatePath('/contacts')
}

// ---------- Adding, importing, bulk actions ----------

/** One tag, as typed into a "group" field. Null when unusable. */
function cleanTag(raw: FormDataEntryValue | string | null): string | null {
  const t = String(raw ?? '').trim()
  return t && t.length <= 50 ? t : null
}

function tagList(raw: FormDataEntryValue | null): string[] {
  return [
    ...new Set(
      String(raw ?? '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ]
}

export type AddContactState = { error?: string; ok?: number; existingId?: string }

export async function createContact(_prev: AddContactState, formData: FormData): Promise<AddContactState> {
  const user = await requireUser()
  if (!hasRole(user, 'AGENT')) return { error: 'Peran kamu hanya bisa membaca.' }

  const raw = String(formData.get('phone') ?? '')
  const waId = normalizeWaId(raw)
  if (!waId) return { error: `Nomor "${raw}" tidak valid. Tulis dengan kode negara atau awalan 0.` }

  const name = String(formData.get('name') ?? '').trim()
  if (name.length > 200) return { error: 'Nama maksimal 200 karakter.' }
  const tags = tagList(formData.get('tags'))
  if (tags.some((t) => t.length > 50)) return { error: 'Satu grup maksimal 50 karakter.' }

  const existing = await prisma.contact.findUnique({ where: { orgId_waId: { orgId: user.orgId, waId } } })
  if (existing) return { error: `+${waId} sudah terdaftar.`, existingId: existing.id }

  const optedIn = formData.get('optIn') === 'on'
  const contact = await prisma.contact.create({
    data: {
      orgId: user.orgId,
      waId,
      name: name || null,
      tags,
      ...(optedIn
        ? { optInStatus: OptInStatus.OPTED_IN, optInSource: `manual:${user.id}`, optInAt: new Date() }
        : {}),
    },
  })
  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'contact.create',
      resourceType: 'Contact',
      resourceId: contact.id,
      diff: { waId, name: name || null, tags, optedIn },
    },
  })

  revalidatePath('/contacts')
  return { ok: Date.now() }
}

export type ImportState = {
  error?: string
  result?: { created: number; updated: number; unchanged: number; errors: { line: number; reason: string }[] }
}

const IMPORT_MAX_BYTES = 2 * 1024 * 1024

/**
 * Adds or updates contacts from a CSV. Existing contacts keep what they had:
 * tags and attributes are merged, a name is only filled in where missing, and
 * someone who opted out stays opted out whatever the import says.
 */
export async function importContacts(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await requireUser()
  if (!hasRole(user, 'SUPERVISOR')) return { error: 'Impor kontak butuh peran supervisor ke atas.' }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { error: 'Pilih file CSV.' }
  if (file.size > IMPORT_MAX_BYTES) return { error: 'File maksimal 2 MB.' }

  const { rows, errors } = contactRowsFromCsv(await file.text())
  if (rows.length === 0) return { result: { created: 0, updated: 0, unchanged: 0, errors } }

  const groupRaw = String(formData.get('group') ?? '').trim()
  const group = groupRaw ? cleanTag(groupRaw) : null
  if (groupRaw && !group) return { error: 'Nama grup maksimal 50 karakter.' }
  const optIn = formData.get('optIn') === 'on'
  const now = new Date()

  const existing = new Map(
    (
      await prisma.contact.findMany({
        where: { orgId: user.orgId, waId: { in: rows.map((r) => r.waId) } },
      })
    ).map((c) => [c.waId, c]),
  )

  const fresh = rows.filter((r) => !existing.has(r.waId))
  const created = fresh.length
    ? (
        await prisma.contact.createMany({
          data: fresh.map((r) => ({
            orgId: user.orgId,
            waId: r.waId,
            name: r.name ?? null,
            tags: [...new Set([...r.tags, ...(group ? [group] : [])])],
            attributes: r.attributes,
            ...(optIn ? { optInStatus: OptInStatus.OPTED_IN, optInSource: `import:${user.id}`, optInAt: now } : {}),
          })),
          skipDuplicates: true,
        })
      ).count
    : 0

  const updates: Prisma.PrismaPromise<unknown>[] = []
  let unchanged = 0
  for (const r of rows) {
    const c = existing.get(r.waId)
    if (!c) continue
    const tags = [...new Set([...c.tags, ...r.tags, ...(group ? [group] : [])])]
    const attributes = { ...((c.attributes ?? {}) as Record<string, unknown>), ...r.attributes }
    const name = c.name || r.name || null
    const optInNow = optIn && c.optInStatus === OptInStatus.UNKNOWN
    const same =
      tags.length === c.tags.length &&
      name === c.name &&
      !optInNow &&
      JSON.stringify(attributes) === JSON.stringify(c.attributes ?? {})
    if (same) {
      unchanged++
      continue
    }
    updates.push(
      prisma.contact.update({
        where: { id: c.id },
        data: {
          tags,
          name,
          attributes: attributes as Prisma.InputJsonValue,
          ...(optInNow ? { optInStatus: OptInStatus.OPTED_IN, optInSource: `import:${user.id}`, optInAt: now } : {}),
        },
      }),
    )
  }
  for (let i = 0; i < updates.length; i += 500) await prisma.$transaction(updates.slice(i, i + 500))

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'contact.import',
      resourceType: 'Contact',
      diff: { file: file.name, rows: rows.length, created, updated: updates.length, group, optIn },
    },
  })

  revalidatePath('/contacts')
  return { result: { created, updated: updates.length, unchanged, errors } }
}

export type BulkOp = 'addTag' | 'removeTag' | 'optIn' | 'optOut' | 'delete'
export type BulkState = { error?: string; done?: number }

const BULK_MAX = 500

/** One action over the contacts ticked on the list. */
export async function bulkContacts(ids: string[], op: BulkOp, value?: string): Promise<BulkState> {
  const user = await requireUser()
  if (!hasRole(user, 'AGENT')) return { error: 'Peran kamu hanya bisa membaca.' }
  // Deleting takes conversations and broadcast history with it.
  if (op === 'delete' && !hasRole(user, 'ADMIN')) return { error: 'Menghapus kontak butuh peran admin.' }

  const list = [...new Set(ids.map(String))].slice(0, BULK_MAX)
  if (list.length === 0) return { error: 'Belum ada kontak yang dipilih.' }

  let done: number
  if (op === 'addTag' || op === 'removeTag') {
    const tag = cleanTag(value ?? '')
    if (!tag) return { error: 'Nama grup wajib diisi, maksimal 50 karakter.' }
    done =
      op === 'addTag'
        ? await prisma.$executeRaw`
            UPDATE "Contact" SET tags = array_append(tags, ${tag}::text), "updatedAt" = now()
            WHERE "orgId" = ${user.orgId} AND id = ANY(${list}::text[]) AND NOT (${tag}::text = ANY(tags))`
        : await prisma.$executeRaw`
            UPDATE "Contact" SET tags = array_remove(tags, ${tag}::text), "updatedAt" = now()
            WHERE "orgId" = ${user.orgId} AND id = ANY(${list}::text[]) AND ${tag}::text = ANY(tags)`
  } else if (op === 'optIn') {
    done = (
      await prisma.contact.updateMany({
        where: { orgId: user.orgId, id: { in: list } },
        data: { optInStatus: OptInStatus.OPTED_IN, optInSource: `manual:${user.id}`, optInAt: new Date(), optOutAt: null },
      })
    ).count
  } else if (op === 'optOut') {
    done = (
      await prisma.contact.updateMany({
        where: { orgId: user.orgId, id: { in: list } },
        data: { optInStatus: OptInStatus.OPTED_OUT, optOutAt: new Date() },
      })
    ).count
  } else if (op === 'delete') {
    done = (await prisma.contact.deleteMany({ where: { orgId: user.orgId, id: { in: list } } })).count
  } else {
    return { error: 'Aksi tidak dikenal.' }
  }

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: `contact.bulk.${op}`,
      resourceType: 'Contact',
      diff: { ids: list, value: value ?? null, affected: done },
    },
  })

  revalidatePath('/contacts')
  return { done }
}

// ---------- Groups (a group is a tag) ----------

export type GroupState = { error?: string; ok?: number; added?: number; created?: number; invalid?: string[] }

/** A new group from pasted numbers; numbers that are not contacts yet become ones. */
export async function createGroup(_prev: GroupState, formData: FormData): Promise<GroupState> {
  const user = await requireUser()
  if (!hasRole(user, 'SUPERVISOR')) return { error: 'Membuat grup butuh peran supervisor ke atas.' }

  const tag = cleanTag(formData.get('name'))
  if (!tag) return { error: 'Nama grup wajib diisi, maksimal 50 karakter.' }

  const lines = String(formData.get('numbers') ?? '')
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean)
  const invalid: string[] = []
  const waIds = new Set<string>()
  for (const l of lines) {
    const w = normalizeWaId(l)
    if (w) waIds.add(w)
    else invalid.push(l)
  }
  if (waIds.size === 0) return { error: 'Tempel minimal satu nomor yang valid.', invalid }
  if (waIds.size > 5000) return { error: 'Maksimal 5.000 nomor sekali buat.' }

  const list = [...waIds]
  const known = new Set(
    (
      await prisma.contact.findMany({
        where: { orgId: user.orgId, waId: { in: list } },
        select: { waId: true },
      })
    ).map((c) => c.waId),
  )

  const created = (
    await prisma.contact.createMany({
      data: list.filter((w) => !known.has(w)).map((waId) => ({ orgId: user.orgId, waId, tags: [tag] })),
      skipDuplicates: true,
    })
  ).count
  const joined = await prisma.$executeRaw`
    UPDATE "Contact" SET tags = array_append(tags, ${tag}::text), "updatedAt" = now()
    WHERE "orgId" = ${user.orgId} AND "waId" = ANY(${list}::text[]) AND NOT (${tag}::text = ANY(tags))`

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'contact.group.create',
      resourceType: 'Contact',
      diff: { tag, numbers: list.length, created, joined },
    },
  })

  revalidatePath('/contacts')
  return { ok: Date.now(), added: joined + created, created, invalid }
}

export async function renameGroup(from: string, to: string): Promise<GroupState> {
  const user = await requireUser()
  if (!hasRole(user, 'SUPERVISOR')) return { error: 'Mengubah grup butuh peran supervisor ke atas.' }
  const next = cleanTag(to)
  if (!next) return { error: 'Nama grup wajib diisi, maksimal 50 karakter.' }
  if (next === from) return { ok: Date.now() }

  // A contact already in the target group just loses the old tag, instead of
  // ending up carrying the same one twice.
  const n = await prisma.$executeRaw`
    UPDATE "Contact"
    SET tags = CASE WHEN ${next}::text = ANY(tags) THEN array_remove(tags, ${from}::text)
                    ELSE array_replace(tags, ${from}::text, ${next}::text) END,
        "updatedAt" = now()
    WHERE "orgId" = ${user.orgId} AND ${from}::text = ANY(tags)`

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'contact.group.rename',
      resourceType: 'Contact',
      diff: { from, to: next, affected: n },
    },
  })
  revalidatePath('/contacts')
  return { ok: Date.now() }
}

/** Takes the tag off everyone in the group; the contacts themselves stay. */
export async function deleteGroup(tag: string): Promise<GroupState> {
  const user = await requireUser()
  if (!hasRole(user, 'SUPERVISOR')) return { error: 'Menghapus grup butuh peran supervisor ke atas.' }

  const n = await prisma.$executeRaw`
    UPDATE "Contact" SET tags = array_remove(tags, ${tag}::text), "updatedAt" = now()
    WHERE "orgId" = ${user.orgId} AND ${tag}::text = ANY(tags)`

  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'contact.group.delete',
      resourceType: 'Contact',
      diff: { tag, affected: n },
    },
  })
  revalidatePath('/contacts')
  return { ok: Date.now() }
}
