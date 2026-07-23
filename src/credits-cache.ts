/**
 * Balance cache module.
 * Reads/writes ~/.ironlabs/balance-cache-<key hash>.json with TTL-based expiry.
 * Cache file is namespaced per API key so switching accounts never shows a
 * stale balance left over from a different key.
 * statusLine calls this on every refresh — must be fast (local file only).
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'

const CACHE_DIR = path.join(os.homedir(), '.ironlabs')
const DEFAULT_TTL_MS = 30_000 // 30 seconds

export interface BalanceData {
  balance: number    // in cents
  updated_at: number // Unix timestamp in ms
}

function cacheFilePath(apiKey: string): string {
  const hash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16)
  return path.join(CACHE_DIR, `balance-cache-${hash}.json`)
}

export function readCache(apiKey: string): BalanceData | null {
  try {
    const raw  = fs.readFileSync(cacheFilePath(apiKey), 'utf-8')
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

export function writeCache(apiKey: string, balance: number): void {
  const data: BalanceData = { balance, updated_at: Date.now() }
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    fs.writeFileSync(cacheFilePath(apiKey), JSON.stringify(data, null, 2), 'utf-8')
  } catch {
    // Silent fail — statusLine must never crash
  }
}

export function getBalance(apiKey: string | undefined): { data: BalanceData | null; fresh: boolean } {
  if (!apiKey) return { data: null, fresh: false }
  const data = readCache(apiKey)
  if (!data) return { data: null, fresh: false }
  return { data, fresh: isCacheFresh(data) }
}

/**
 * Fetch real balance from IronLabs API and update cache.
 * Non-blocking — fire and forget.
 */
export async function refreshFromApi(): Promise<void> {
  const apiKey = process.env.IRONLABS_API_KEY
  if (!apiKey) return

  const baseUrl = (process.env.IRONLABS_BASE_URL ?? 'https://www.chat.ironlabs.ai/api/v1').replace(/\/$/, '')

  const res = await fetch(`${baseUrl}/chat/balance`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return

  const json = await res.json() as {
    data?: { totalBalance?: string | number },
    balance?: string | number
  }

  const raw = json.data?.totalBalance ?? json.balance
  const dollars = typeof raw === 'string' ? parseFloat(raw) : raw

  if (typeof dollars === 'number' && !Number.isNaN(dollars)) {
    // totalBalance is denominated in dollars — convert to cents to match BalanceData's contract.
    writeCache(apiKey, Math.round(dollars * 100))
  }
}
