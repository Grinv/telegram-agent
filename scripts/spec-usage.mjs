#!/usr/bin/env node
// Token and time accounting for an OpenSpec change.
//
// Merges two local, offline data sources — whichever engine(s) actually did
// the work are picked up automatically, no configuration needed:
//
// 1. opencode SQLite database (~/.local/share/opencode/opencode.db). Each
//    assistant message row stores modelID, token breakdown
//    (input/output/reasoning/cache), and time.created / time.completed, so
//    model generation time is measured directly. Sessions are filtered by
//    `session.directory` matching the project root, which also includes
//    sub-agent sessions (they inherit the parent's directory).
//
// 2. Claude Code JSONL session transcripts
//    (~/.claude/projects/<project-slug>/*.jsonl). Each assistant turn may be
//    split across several JSONL lines (one per content block) that all share
//    the same message.id and repeat the same usage snapshot for that whole
//    API response, so lines are deduplicated by message.id before summing.
//    Sidechain (sub-agent) turns live in the same file and are included the
//    same way. Claude Code's logs don't record per-message generation
//    duration, so its rows report token counts only — modelMs is left
//    unknown (not zero) and the report notes when this makes "model time"
//    a lower bound.
//
// Commands:
//   start [--force]                    mark the start of work on a change
//   status                             show the current marker and accumulated costs
//   report [--since ISO] [--until ISO]  compute and print without writing
//   finish --change <name> [--summary <text>] [--since ISO] [--dry-run]
//                                      append an entry to openspec/token-usage.md
//   hook                               UserPromptSubmit hook mode (JSON on stdin)

import { readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const STATE_FILE = join(ROOT, 'openspec', '.token-usage-state.json')
const LEDGER_FILE = join(ROOT, 'openspec', 'token-usage.md')
const CHANGES_DIR = join(ROOT, 'openspec', 'changes')

const LEDGER_HEADER = `# Spec cost history

Auto-populated by \`scripts/spec-usage.mjs finish\` when archiving a change.
Tokens and time are read from local logs for the period between
\`/opsx:propose\` and archivation, merged across whichever engine(s) did the
work: the opencode SQLite database, and Claude Code's JSONL session
transcripts. "Model time" is the sum of \`time.completed - time.created\` per
assistant message — only generation, excluding tool execution and pauses
between user turns; Claude Code doesn't log this, so a report is marked as a
lower bound whenever Claude Code turns are included. Parallel sub-agent time
is summed. "Total" is the sum of all token types, including cache read and
write.
`

// --- opencode SQLite database ------------------------------------------------

function dbPath() {
  return join(homedir(), '.local', 'share', 'opencode', 'opencode.db')
}

function emptyModelStats() {
  return { requests: 0, modelMs: 0, input: 0, output: 0, reasoning: 0, cacheWrite: 0, cacheRead: 0 }
}

function collectOpencode(sinceMs, untilMs) {
  if (!existsSync(dbPath())) {
    return { perModel: new Map(), firstMs: null, lastMs: null }
  }

  const db = new DatabaseSync(dbPath(), { readOnly: true })

  // Per-model breakdown: each assistant message is a row with its own tokens
  // and time.created/time.completed. No deduplication needed.
  const perModelRows = db.prepare(`
    SELECT
      json_extract(m.data, '$.modelID')                               AS model,
      COUNT(*)                                                         AS requests,
      SUM(json_extract(m.data, '$.tokens.input'))                      AS input_t,
      SUM(json_extract(m.data, '$.tokens.output'))                     AS output_t,
      SUM(json_extract(m.data, '$.tokens.reasoning'))                  AS reasoning_t,
      SUM(json_extract(m.data, '$.tokens.cache.read'))                AS cache_read,
      SUM(json_extract(m.data, '$.tokens.cache.write'))                AS cache_write,
      SUM(COALESCE(json_extract(m.data, '$.time.completed'),
                   json_extract(m.data, '$.time.created'))
          - json_extract(m.data, '$.time.created'))                   AS model_ms
    FROM message m
    JOIN session s ON m.session_id = s.id
    WHERE s.directory = ?
      AND json_extract(m.data, '$.role') = 'assistant'
      AND json_extract(m.data, '$.modelID') IS NOT NULL
      AND json_extract(m.data, '$.time.created') >= ?
      AND json_extract(m.data, '$.time.created') <= ?
    GROUP BY model
  `).all(ROOT, sinceMs, untilMs)

  db.close()

  const perModel = new Map()
  for (const row of perModelRows) {
    const stats = emptyModelStats()
    stats.requests = row.requests
    stats.modelMs = row.model_ms ?? 0
    stats.input = row.input_t ?? 0
    stats.output = row.output_t ?? 0
    stats.reasoning = row.reasoning_t ?? 0
    stats.cacheWrite = row.cache_write ?? 0
    stats.cacheRead = row.cache_read ?? 0
    perModel.set(row.model, stats)
  }

  // Wall-clock: first and last message timestamps (user + assistant).
  const db2 = new DatabaseSync(dbPath(), { readOnly: true })
  const wallRow = db2.prepare(`
    SELECT
      MIN(json_extract(m.data, '$.time.created'))                              AS first_ms,
      MAX(COALESCE(json_extract(m.data, '$.time.completed'),
                   json_extract(m.data, '$.time.created')))                     AS last_ms
    FROM message m
    JOIN session s ON m.session_id = s.id
    WHERE s.directory = ?
      AND json_extract(m.data, '$.time.created') >= ?
      AND json_extract(m.data, '$.time.created') <= ?
  `).get(ROOT, sinceMs, untilMs)
  db2.close()

  const firstMs = wallRow?.first_ms ?? null
  const lastMs = wallRow?.last_ms ?? null

  return { perModel, firstMs, lastMs }
}

// --- Claude Code JSONL transcripts ------------------------------------------

function claudeProjectDir() {
  // Claude Code names each project's log directory after the project's
  // absolute path with every non-alphanumeric character replaced by `-`
  // (e.g. /Users/x/y z -> -Users-x-y-z). Verified empirically against this
  // project's own directory; not documented, so degrade silently if it
  // ever changes rather than crashing accounting.
  const slug = ROOT.replace(/[^a-zA-Z0-9]/g, '-')
  const dir = join(homedir(), '.claude', 'projects', slug)
  return existsSync(dir) ? dir : null
}

function collectClaudeCode(sinceMs, untilMs) {
  const dir = claudeProjectDir()
  const perModel = new Map()
  if (!dir) return { perModel, firstMs: null, lastMs: null }

  const seenMessageIds = new Set()
  let firstMs = null
  let lastMs = null

  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.jsonl')) continue
    const path = join(dir, name)
    if (!statSync(path).isFile()) continue

    let raw
    try { raw = readFileSync(path, 'utf8') } catch { continue }

    for (const line of raw.split('\n')) {
      if (!line) continue
      let entry
      try { entry = JSON.parse(line) } catch { continue }
      if (entry.type !== 'assistant' || !entry.message?.id || !entry.message.usage) continue

      const ts = Date.parse(entry.timestamp)
      if (Number.isNaN(ts) || ts < sinceMs || ts > untilMs) continue

      // One API response can be split across several JSONL lines (one per
      // content block); they share message.id and repeat the same usage
      // snapshot for the whole response, so only count each id once.
      if (seenMessageIds.has(entry.message.id)) continue
      seenMessageIds.add(entry.message.id)

      const u = entry.message.usage
      const model = entry.message.model ?? 'unknown'
      const stats = perModel.get(model) ?? { ...emptyModelStats(), modelMs: null }
      stats.requests += 1
      stats.input += u.input_tokens ?? 0
      stats.output += u.output_tokens ?? 0
      stats.reasoning += u.output_tokens_details?.thinking_tokens ?? 0
      stats.cacheWrite += u.cache_creation_input_tokens ?? 0
      stats.cacheRead += u.cache_read_input_tokens ?? 0
      perModel.set(model, stats)

      if (firstMs === null || ts < firstMs) firstMs = ts
      if (lastMs === null || ts > lastMs) lastMs = ts
    }
  }

  return { perModel, firstMs, lastMs }
}

// --- merge --------------------------------------------------------------

// Claude Code rows carry modelMs: null (unknown, not zero — its logs don't
// record per-message generation duration). Once a model's modelMs goes
// null it stays null rather than silently reverting to a partial number.
function mergeModelStats(target, source) {
  for (const [model, s] of source) {
    const t = target.get(model)
    if (!t) { target.set(model, { ...s }); continue }
    t.requests += s.requests
    t.input += s.input
    t.output += s.output
    t.reasoning += s.reasoning
    t.cacheWrite += s.cacheWrite
    t.cacheRead += s.cacheRead
    t.modelMs = (t.modelMs === null || s.modelMs === null) ? null : t.modelMs + s.modelMs
  }
}

function collect(sinceMs, untilMs) {
  const oc = collectOpencode(sinceMs, untilMs)
  const cc = collectClaudeCode(sinceMs, untilMs)

  const perModel = new Map()
  for (const [model, s] of oc.perModel) perModel.set(model, { ...s })
  mergeModelStats(perModel, cc.perModel)

  const firstCandidates = [oc.firstMs, cc.firstMs].filter((v) => v !== null)
  const lastCandidates = [oc.lastMs, cc.lastMs].filter((v) => v !== null)
  const firstMs = firstCandidates.length ? Math.min(...firstCandidates) : null
  const lastMs = lastCandidates.length ? Math.max(...lastCandidates) : null

  const modelMsIncomplete = [...perModel.values()].some((s) => s.modelMs === null)
  const modelMs = [...perModel.values()].reduce((sum, s) => sum + (s.modelMs ?? 0), 0)
  const total = [...perModel.values()].reduce(
    (sum, s) => sum + s.input + s.output + s.cacheWrite + s.cacheRead,
    0,
  )

  return {
    perModel,
    total,
    modelMs,
    modelMsIncomplete,
    firstMs,
    lastMs,
    wallMs: firstMs && lastMs ? lastMs - firstMs : 0,
  }
}

// --- formatting ------------------------------------------------------------

const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

function duration(ms) {
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${s}s`
  return `${s}s`
}

const localDate = (ms) => new Date(ms).toLocaleDateString('sv-SE') // YYYY-MM-DD
const localTime = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

function modelLines(usage) {
  return [...usage.perModel.entries()]
    .sort((a, b) => b[1].output - a[1].output)
    .map(([model, s]) => {
      const reasoning = s.reasoning ? ` (reasoning ${num(s.reasoning)})` : ''
      const time = s.modelMs === null ? 'duration n/a' : duration(s.modelMs)
      return `- ${model}: ${num(s.requests)} requests, ${time}, ` +
        `in ${num(s.input)} / out ${num(s.output)}${reasoning}` +
        ` / cache write ${num(s.cacheWrite)} / cache read ${num(s.cacheRead)}`
    })
}

function modelTimeNote(usage) {
  return usage.modelMsIncomplete
    ? ' (lower bound — Claude Code turns are not included; its logs don\'t record per-message duration)'
    : ''
}

function renderReport(usage) {
  if (!usage.perModel.size) return 'No model requests in the period.'
  const period = usage.firstMs
    ? `${localDate(usage.firstMs)} ${localTime(usage.firstMs)} → ${localTime(usage.lastMs)}`
    : '—'
  return [
    `Period: ${period}`,
    `Time: ${duration(usage.wallMs)} total, model time ${duration(usage.modelMs)}${modelTimeNote(usage)}`,
    ...modelLines(usage),
    `Total: ${num(usage.total)} tokens`,
  ].join('\n')
}

// --- state -----------------------------------------------------------------

function readState() {
  if (!existsSync(STATE_FILE)) return null
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { return null }
}

function writeState(state) {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`)
}

// Change start time: if no marker exists, use the earliest file in the change directory.
function changeDirStart(change) {
  const candidates = [join(CHANGES_DIR, change)]
  const archive = join(CHANGES_DIR, 'archive')
  if (existsSync(archive)) {
    for (const name of readdirSync(archive)) {
      if (name === change || name.endsWith(`-${change}`)) candidates.push(join(archive, name))
    }
  }
  let earliest = null
  for (const dir of candidates) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const ms = statSync(join(dir, name)).birthtimeMs || statSync(join(dir, name)).mtimeMs
      if (earliest === null || ms < earliest) earliest = ms
    }
  }
  return earliest
}

// --- commands --------------------------------------------------------------

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) { args[key] = next; i++ } else { args[key] = true }
  }
  return args
}

function cmdStart(args) {
  const existing = readState()
  if (existing && !args.force) {
    console.log(`Start marker already exists: ${existing.startedAt}. Use --force to overwrite.`)
    return
  }
  writeState({ startedAt: new Date().toISOString(), sessionId: args.session ?? null })
  console.log('Token accounting started.')
}

function cmdStatus() {
  const state = readState()
  if (!state) {
    console.log('No start marker. It is set by the hook on /opsx:propose or the start command.')
    return
  }
  console.log(`Started: ${state.startedAt}`)
  console.log(renderReport(collect(Date.parse(state.startedAt), Date.now())))
}

function cmdReport(args) {
  const since = args.since ? Date.parse(args.since) : (readState() ? Date.parse(readState().startedAt) : null)
  if (since === null || Number.isNaN(since)) {
    console.error('Need --since <ISO> or a start marker.')
    process.exit(1)
  }
  const until = args.until ? Date.parse(args.until) : Date.now()
  console.log(renderReport(collect(since, until)))
}

function cmdFinish(args) {
  const change = args.change
  if (!change || change === true) {
    console.error('Need --change <change-name>.')
    process.exit(1)
  }

  const state = readState()
  let sinceMs = args.since ? Date.parse(args.since) : state ? Date.parse(state.startedAt) : null
  let sinceNote = state ? 'from /opsx:propose marker' : null
  if (args.since) sinceNote = 'specified manually'
  if (sinceMs === null || Number.isNaN(sinceMs)) {
    sinceMs = changeDirStart(change)
    sinceNote = 'from change file creation time'
  }
  if (!sinceMs) {
    console.error(`Could not determine start of work on "${change}". Pass --since <ISO>.`)
    process.exit(1)
  }

  const untilMs = Date.now()
  const usage = collect(sinceMs, untilMs)
  const summary = typeof args.summary === 'string' ? args.summary.trim() : '_no summary provided_'

  // Bounds come from actual messages: the search window is wider than the actual work.
  const fromMs = usage.firstMs ?? sinceMs
  const toMs = usage.lastMs ?? untilMs

  const entry = [
    '',
    `## ${localDate(untilMs)} — ${change}`,
    '',
    summary,
    '',
    `- Time: ${duration(usage.wallMs)} total, model time ${duration(usage.modelMs)}${modelTimeNote(usage)}, ` +
      `${localDate(fromMs)} ${localTime(fromMs)} → ${localDate(toMs)} ${localTime(toMs)}`,
    ...modelLines(usage),
    `- Total: ${num(usage.total)} tokens`,
    `- Start: ${sinceNote}`,
    '',
  ].join('\n')

  if (args['dry-run']) {
    console.log(entry)
    return
  }

  if (!existsSync(LEDGER_FILE)) writeFileSync(LEDGER_FILE, LEDGER_HEADER)
  appendFileSync(LEDGER_FILE, entry)
  if (existsSync(STATE_FILE)) rmSync(STATE_FILE)

  console.log(`Entry appended to openspec/token-usage.md:\n${entry}`)
}

// UserPromptSubmit: /opsx:propose sets the marker, /opsx:archive reminds to log.
function cmdHook() {
  let raw = ''
  try { raw = readFileSync(0, 'utf8') } catch { /* no stdin — exit silently */ }
  let input = {}
  try { input = JSON.parse(raw) } catch { return }
  const prompt = String(input.prompt ?? '')

  if (/^\s*\/opsx:propose\b/.test(prompt)) {
    if (!readState()) {
      writeState({ startedAt: new Date().toISOString(), sessionId: input.session_id ?? null })
      console.log(JSON.stringify({ systemMessage: 'Token accounting for this change started (openspec/token-usage.md).' }))
    }
    return
  }

  if (/^\s*\/opsx:archive\b/.test(prompt)) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext:
          'After successfully archiving the change, run:\n' +
          'node scripts/spec-usage.mjs finish --change "<change-name>" --summary "1-2 sentences of what was actually done"\n' +
          'This appends a record with date, time, models, and tokens to openspec/token-usage.md. ' +
          'If the script says no start marker exists, also pass --since <ISO-time-when-work-started>. ' +
          'If archiving did not happen, do not run it.',
      },
    }))
  }
}

const [command, ...rest] = process.argv.slice(2)
const args = parseArgs(rest)

try {
  switch (command) {
    case 'start': cmdStart(args); break
    case 'status': cmdStatus(args); break
    case 'report': cmdReport(args); break
    case 'finish': cmdFinish(args); break
    case 'hook': cmdHook(args); break
    default:
      console.error('Usage: spec-usage.mjs start|status|report|finish|hook')
      process.exit(1)
  }
} catch (error) {
  if (command === 'hook') process.exit(0) // a hook must never break a session
  console.error(String(error.message ?? error))
  process.exit(1)
}
