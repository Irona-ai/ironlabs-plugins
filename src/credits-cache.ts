/**
 * Balance fetcher.
 * Fetches the live balance from the IronLabs API on every call — no local caching.
 */

export interface BalanceData {
  balance: number    // in cents
  updated_at: number // Unix timestamp in ms
}

export async function fetchBalance(): Promise<BalanceData | null> {
  const apiKey = process.env.IRONLABS_API_KEY
  if (!apiKey) return null

  const baseUrl = (process.env.IRONLABS_BASE_URL ?? 'https://www.chat.ironlabs.ai/api/v1').replace(/\/$/, '')

  const res = await fetch(`${baseUrl}/chat/balance`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return null

  const json = await res.json() as {
    data?: { totalBalance?: string | number },
    balance?: string | number
  }

  const raw = json.data?.totalBalance ?? json.balance
  const dollars = typeof raw === 'string' ? parseFloat(raw) : raw

  if (typeof dollars !== 'number' || Number.isNaN(dollars)) return null

  // totalBalance is denominated in dollars — convert to cents to match BalanceData's contract.
  return { balance: Math.round(dollars * 100), updated_at: Date.now() }
}
