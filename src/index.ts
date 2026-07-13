/**
 * StatusLine entry point for IronLabs plugin.
 * If user had a previous statusLine command (e.g. claude-hud), runs it and
 * merges its output with the balance display.
 *
 * Previous statusLine is saved to ~/.ironlabs/previous-statusline.json during setup.
 *
 * Manual test:
 *   echo '{}' | npx tsx src/index.ts
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import { getBalance, refreshFromApi } from './credits-cache.js'
import { renderCreditsLine } from './render/credits-line.js'

const PREVIOUS_STATUSLINE_FILE = path.join(os.homedir(), '.ironlabs/previous-statusline.json')

// ── Stdin reading ───────────────────────────────────────────────────────
async function readStdinRaw(): Promise<string> {
  if (process.stdin.isTTY) return ''

  const chunks: string[] = []
  try {
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) {
      chunks.push(chunk as string)
    }
  } catch {
    // ignore
  }
  return chunks.join('')
}

// ── Previous statusLine integration ─────────────────────────────────────
// Intentionally executes an arbitrary shell command: this file is only ever
// written by /ironlabs:setup, copying the user's own pre-existing statusLine
// command from ~/.claude/settings.json (a command Claude Code already runs
// every session). Not attacker-controlled input — see commands/setup.md
// Step 8, which also restricts this file to 0600.
function runPreviousStatusLine(stdinData: string): string {
  try {
    const raw    = fs.readFileSync(PREVIOUS_STATUSLINE_FILE, 'utf-8')
    const config = JSON.parse(raw) as { command?: string }
    if (!config.command) return ''

    return execSync(config.command, {
      input: stdinData,
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env },
      shell: '/bin/bash',
    }).trimEnd()
  } catch {
    return ''
  }
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const stdinData = await readStdinRaw()

  // Run previous statusLine command if configured (e.g. claude-hud)
  const previousOutput = runPreviousStatusLine(stdinData)

  // Get balance from local file cache (fast, no network)
  const { data, fresh } = getBalance()

  // If cache is stale or empty, fire async refresh (non-blocking)
  if (!fresh) {
    refreshFromApi().catch(() => {})
  }

  const balanceLine = renderCreditsLine(data)

  // Merge: previous statusLine output first, then balance line
  if (previousOutput) {
    console.log(previousOutput)
  }
  console.log(balanceLine)
}

main().catch(() => {
  // statusLine must never crash — silent fail
})
