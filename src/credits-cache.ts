/**
 * Balance cache module.
 * Reads/writes ~/.ironlabs/balance-cache.json with TTL-based expiry.
 * statusLine calls this on every refresh — must be fast (local file only).
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

const CACHE_DIR  = path.join(os.homedir(), '.ironlabs')
const CACHE_FILE = path.join(CACHE_DIR, 'balance-cache.json')
const DEFAULT_TTL_MS = 30_000 // 30 seconds

export interface BalanceData {
  balance: number    // in cents
  updated_at: number // Unix timestamp in ms
}

export function readCache(): BalanceData | null {
  try {
    const raw  = fs.readFileSync(CACHE_FILE, 'utf-8')
    const data = JSON.parse(raw) as BalanceData
    if (typeof data.balance !== 'number' || typeof data.updated_at !== 'number') return null
    return data
  } catch {
    return null
  }
}

export function isCacheFresh(data: BalanceData, ttlMs: number = DEFAULT_TTL_MS): boolean {
  return Date.now() - data.updated_at < ttlMs
}

export function writeCache(balance: number): void {
  const data: BalanceData = { balance, updated_at: Date.now() }
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8')
  } catch {
    // Silent fail — statusLine must never crash
  }
}

export function getBalance(): { data: BalanceData | null; fresh: boolean } {
  const data = readCache()
  if (!data) return { data: null, fresh: false }
  return { data, fresh: isCacheFresh(data) }
}

/**
 * Fetch real balance from IronLabs Studio API and update cache.
 * Uses IRONLABS_STUDIO_URL for auth/balance — separate from the chat/skills URL.
 * Non-blocking — fire and forget.
 */
export async function refreshFromApi(): Promise<void> {
  const apiKey = process.env.IRONLABS_API_KEY
  if (!apiKey) return

  const studioUrl = (process.env.IRONLABS_STUDIO_URL ?? 'https://studio.ironlabs.ai').replace(/\/$/, '')

  const res = await fetch(`${studioUrl}/api/v1/balance`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return

  const json = await res.json() as { data?: { topupBalance?: string | number } }
  const raw = json.data?.topupBalance
  const balance = typeof raw === 'string' ? parseFloat(raw) : raw
  if (typeof balance === 'number' && !isNaN(balance)) {
    writeCache(balance)
  }
}
