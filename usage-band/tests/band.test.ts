import { expect, mock, test } from 'claude-code/testing'

import { fmtDuration, forecastOf, parseGitStatus, prettyModel, warningsOf } from '../hooks/register'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const HOUR = 3_600_000

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('formats durations and model names', async () => {
  expect(fmtDuration(42_000)).toBe('42s')
  expect(fmtDuration(125_000)).toBe('2m05s')
  expect(fmtDuration(3 * HOUR + 7 * 60_000)).toBe('3h07')
  expect(prettyModel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(prettyModel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5 1M')
  expect(prettyModel('opus')).toBe('Opus')
})

test('parses git status', async () => {
  const out = '## main...origin/main [ahead 2, behind 1]\nM  a.ts\n M b.ts\nMM c.ts\n?? d.ts\n'
  expect(parseGitStatus(out)).toEqual({ branch: 'main', ahead: 2, behind: 1, staged: 2, modified: 2, untracked: 1 })
  expect(parseGitStatus('## No commits yet on dev\n')?.branch).toBe('dev')
  expect(parseGitStatus('fatal: not a git repository')).toBe(null)
})

test('forecast says when a window runs out before it resets', async () => {
  // 5h: 2.5h se passaram e 80% foi usado, então acaba em ~37m30s, antes de zerar em 2h30.
  const resetsAt = new Date(NOW + 2.5 * HOUR).toISOString()
  expect(forecastOf({ kind: 'five_hour', percentUsed: 80, resetsAt }, NOW)).toBe(0.625 * HOUR)
  // 20% em metade da janela: dura até o reset.
  expect(forecastOf({ kind: 'five_hour', percentUsed: 20, resetsAt }, NOW)).toBe(null)
  expect(forecastOf({ kind: 'spend_limit', percentUsed: 80, resetsAt }, NOW)).toBe(null)
})

test('warns from 70%', async () => {
  const m = { limits: [{ kind: 'five_hour', percentUsed: 69 }], contextPercent: 72, contextTokens: 1, contextWindow: 2 }
  const ws = warningsOf(m, NOW)
  expect(ws.map(w => w.id)).toEqual(['context'])
  expect(ws[0]?.text).toBe('contexto 72%: passou do pico, considere /compact')
  expect(warningsOf({ ...m, limits: [{ kind: 'five_hour', percentUsed: 74 }] }, NOW)[1]?.text).toBe('5h 74%')
  const resetsAt = new Date(NOW + 4 * HOUR).toISOString()
  expect(warningsOf({ ...m, limits: [{ kind: 'seven_day', percentUsed: 71, resetsAt }] }, NOW)[1]?.text).toBe(
    'semana 71%: zera em 4h00',
  )
  expect(warningsOf({ ...m, limits: [{ kind: 'five_hour', percentUsed: 74 }] }, NOW).map(w => w.id)).toEqual([
    'context',
    'five_hour',
  ])
})

test('compact band: git, model and warning on top; ctx and windows below; no round, no cost', async ($, on) => {
  mock.clock(on, { now: NOW })
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('session.measure', async (_$, e) => ({ changed: e.changed }))
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        model: 'claude-opus-5-5',
        input_tokens: 1200,
        output_tokens: 3400,
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 0,
      },
    }
  })

  await $.prompt.submit({ text: 'oi', wait: false, origin: { kind: 'composer' } })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })
  for await (const _ of stream) {
  }
  await stream.result

  await $.session.measure({
    context: { window: 200_000, tokens: 150_000, percent: 75 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 37, resetsAt: new Date(NOW + 2 * HOUR).toISOString() },
      { kind: 'seven_day', percentUsed: 22 },
    ],
    cost: { usd: 1.23 },
    changed: ['context', 'rateLimits', 'cost'],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ }), `${surface}: /Opus 5\\.5/`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^high$/ }), `${surface}: /^high$/`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ctx$/ }), `${surface}: /^ctx$/`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^75%$/ }), `${surface}: /^75%$/`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^5h$/ }), `${surface}: /^5h$/`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^63%$/ }), `${surface}: /^63%$/`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^↻2h00$/ }), `${surface}: /^↻2h00$/`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^sem$/ }), `${surface}: /^sem$/`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^78%$/ }), `${surface}: /^78%$/`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /passou do pico, considere \/compact/ }), `${surface}: /passou do pico, considere \\/compact/`).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /rodada|tokens|livre|zera em/ }), `${surface}: /rodada|tokens|livre|zera em/`).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /\$/ }), `${surface}: /\\$/`).toBeUndefined()
    await ui.unmount()
  }
})
