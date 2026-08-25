import { getDb } from '@/db/client'
import { userAiKeys, orgAiKeys } from '@/db/schema'
import { eq, and } from 'drizzle-orm'
import { encryptSecret, decryptSecret, keyHint } from './crypto'
import type { AIProviderId } from '@/lib/ai/providers/types'

export interface StoredAIKey {
  provider: AIProviderId
  hint: string
  createdAt: number
  updatedAt: number
}

/** Persist (create or upsert) a user's BYOK key for a provider. */
export async function saveUserKey(
  userId: string,
  provider: AIProviderId,
  apiKey: string,
): Promise<StoredAIKey> {
  const db = await getDb()
  const now = Date.now()
  const row = {
    userId,
    provider,
    keyEncrypted: encryptSecret(apiKey),
    keyHint: keyHint(apiKey),
    updatedAt: now,
  }
  await db
    .insert(userAiKeys)
    .values({ id: crypto.randomUUID(), createdAt: now, ...row })
    .onConflictDoUpdate({
      target: [userAiKeys.userId, userAiKeys.provider],
      set: { keyEncrypted: row.keyEncrypted, keyHint: row.keyHint, updatedAt: now },
    })
  return { provider, hint: row.keyHint, createdAt: now, updatedAt: now }
}

export async function deleteUserKey(userId: string, provider: AIProviderId): Promise<void> {
  const db = await getDb()
  await db
    .delete(userAiKeys)
    .where(and(eq(userAiKeys.userId, userId), eq(userAiKeys.provider, provider)))
}

export async function listUserKeys(userId: string): Promise<StoredAIKey[]> {
  const db = await getDb()
  const rows = await db.select().from(userAiKeys).where(eq(userAiKeys.userId, userId))
  return rows.map((r) => ({
    provider: r.provider as AIProviderId,
    hint: r.keyHint,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))
}

/** Fetch + decrypt a user's key. Returns null when absent. */
export async function getUserKey(userId: string, provider: AIProviderId): Promise<string | null> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(userAiKeys)
    .where(and(eq(userAiKeys.userId, userId), eq(userAiKeys.provider, provider)))
    .limit(1)
  if (rows.length === 0) return null
  try {
    return decryptSecret(rows[0].keyEncrypted)
  } catch {
    return null
  }
}

export async function saveOrgKey(
  orgId: string,
  provider: AIProviderId,
  apiKey: string,
  createdBy: string,
): Promise<StoredAIKey> {
  const db = await getDb()
  const now = Date.now()
  const row = {
    orgId,
    provider,
    keyEncrypted: encryptSecret(apiKey),
    keyHint: keyHint(apiKey),
    createdBy,
    updatedAt: now,
  }
  await db
    .insert(orgAiKeys)
    .values({ id: crypto.randomUUID(), createdAt: now, ...row })
    .onConflictDoUpdate({
      target: [orgAiKeys.orgId, orgAiKeys.provider],
      set: { keyEncrypted: row.keyEncrypted, keyHint: row.keyHint, updatedAt: now },
    })
  return { provider, hint: row.keyHint, createdAt: now, updatedAt: now }
}

export async function getOrgKey(orgId: string, provider: AIProviderId): Promise<string | null> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(orgAiKeys)
    .where(and(eq(orgAiKeys.orgId, orgId), eq(orgAiKeys.provider, provider)))
    .limit(1)
  if (rows.length === 0) return null
  try {
    return decryptSecret(rows[0].keyEncrypted)
  } catch {
    return null
  }
}
