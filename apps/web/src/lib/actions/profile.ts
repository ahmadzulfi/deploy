'use server'

import { revalidatePath } from 'next/cache'
import { compare, hash } from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@wa/db'
import { requireUser, updateSession } from '@/lib/auth'

export type ProfileState = { error?: string; ok?: string }

const nameSchema = z.string().trim().min(2, 'Nama minimal 2 karakter').max(80, 'Nama maksimal 80 karakter')

/** Renames the signed-in user. Email stays: it is the login, changed by an admin. */
export async function updateProfile(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const user = await requireUser()

  const parsed = nameSchema.safeParse(formData.get('name') ?? '')
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const name = parsed.data
  if (name === user.name) return { ok: 'Tidak ada perubahan.' }

  await prisma.user.update({ where: { id: user.id }, data: { name } })
  await prisma.auditLog.create({
    data: {
      orgId: user.orgId,
      actorId: user.id,
      action: 'user.rename',
      resourceType: 'User',
      resourceId: user.id,
      diff: { from: user.name, to: name },
    },
  })

  // The header reads the name from the session cookie, not the database.
  await updateSession({ user: { name } })
  revalidatePath('/', 'layout')
  return { ok: 'Nama disimpan.' }
}

const passwordSchema = z
  .object({
    current: z.string().min(1, 'Isi kata sandi saat ini'),
    next: z.string().min(8, 'Kata sandi baru minimal 8 karakter').max(128, 'Kata sandi baru maksimal 128 karakter'),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: 'Konfirmasi tidak sama dengan kata sandi baru' })
  .refine((v) => v.next !== v.current, { message: 'Kata sandi baru harus berbeda dari yang lama' })

export async function changePassword(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const user = await requireUser()

  const parsed = passwordSchema.safeParse({
    current: formData.get('current') ?? '',
    next: formData.get('next') ?? '',
    confirm: formData.get('confirm') ?? '',
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } })
  if (!row?.passwordHash || !(await compare(parsed.data.current, row.passwordHash))) {
    return { error: 'Kata sandi saat ini salah.' }
  }

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(parsed.data.next, 10) } })
  await prisma.auditLog.create({
    data: { orgId: user.orgId, actorId: user.id, action: 'user.password', resourceType: 'User', resourceId: user.id },
  })

  revalidatePath('/profile')
  return { ok: 'Kata sandi diganti. Pakai yang baru saat masuk berikutnya.' }
}
