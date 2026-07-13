/**
 * Balance statusLine renderer.
 * Outputs ANSI-colored text for Claude Code's statusLine display.
 * Follows claude-hud's color pattern (direct ANSI escape sequences).
 */

import type { BalanceData } from '../credits-cache.js'

// ── ANSI Colors ─────────────────────────────────────────────────────────
const RESET  = '\x1b[0m'
const RED    = '\x1b[31m'
const GREEN  = '\x1b[32m'
const YELLOW = '\x1b[33m'
const GRAY   = '\x1b[90m'

// ── Thresholds (in cents) ────────────────────────────────────────────────
const THRESHOLD_LOW      = 500  // $5.00
const THRESHOLD_CRITICAL = 100  // $1.00

// ── Helpers ─────────────────────────────────────────────────────────────
function colorize(text: string, color: string): string {
  return `${color}${text}${RESET}`
}

function formatBalance(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

// ── Options ──────────────────────────────────────────────────────────────
export interface RenderOptions {
  addCreditsCmd?: string
  setupCmd?: string
}

// ── Main Renderer ────────────────────────────────────────────────────────
export function renderCreditsLine(
  data: BalanceData | null,
  opts: RenderOptions = {},
): string {
  const addCreditsCmd = opts.addCreditsCmd ?? '/ironlabs:add-credits'
  const setupCmd      = opts.setupCmd      ?? '/ironlabs:setup'

  if (!data) {
    return colorize(`IronLabs — type ${setupCmd} to complete setup`, GRAY)
  }

  const { balance } = data
  const formatted = formatBalance(balance)

  if (balance <= 0) {
    return colorize(`❌ IronLabs: $0.00 — type ${addCreditsCmd} to top up`, RED)
  }

  if (balance <= THRESHOLD_CRITICAL) {
    return colorize(`🔴 IronLabs: ${formatted} — type ${addCreditsCmd} to top up`, RED)
  }

  if (balance <= THRESHOLD_LOW) {
    return colorize(`⚠️  IronLabs: ${formatted} — running low`, YELLOW)
  }

  return colorize(`IronLabs: ${formatted}`, GREEN)
}
