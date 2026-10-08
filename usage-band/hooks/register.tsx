import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register, RenderChildren, SessionMeasureInput, SessionUsage } from 'claude-code'

import type { Git, Limit, Meter } from '../types'

const round = atom({ plugin: 'usage-band', key: 'round' } as const, null)
const meter = atom({ plugin: 'usage-band', key: 'meter' } as const, null)
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)
const git = atom({ plugin: 'usage-band', key: 'git' } as const, null)
const model = atom({ plugin: 'usage-band', key: 'model' } as const, null)

const HOUR = 3_600_000
const WINDOW_MS: Record<string, number> = { five_hour: 5 * HOUR, seven_day: 7 * 24 * HOUR }
const LABEL: Record<string, string> = { five_hour: '5h', seven_day: 'semana', spend_limit: 'gasto' }
const WINDOW_NAME: Record<string, string> = { five_hour: 'janela de 5h', seven_day: 'janela semanal' }

/** A partir daqui o contexto passou do pico de inteligência e as janelas pedem atenção. */
export const WARN_AT = 70

export const fmtTokens = (n: number): string => {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${parseFloat((n / 1_000_000).toFixed(2))}M`
}

export const fmtDuration = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h${String(m % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)}d${h % 24}h`
}

/** `claude-opus-5-5` → `Opus 5.5`, `claude-haiku-4-5-20251001` → `Haiku 4.5`, `opus` → `Opus`. */
export const prettyModel = (id: string): string => {
  const m = /claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?!\d)/.exec(id)
  if (!m || !m[1]) return /^[a-z]+$/.test(id) ? id.charAt(0).toUpperCase() + id.slice(1) : id
  const name = m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return `${name} ${m[2]}${m[3] ? `.${m[3]}` : ''}${id.includes('[1m]') ? ' 1M' : ''}`
}

/** Lê a saída de `git status --porcelain=v1 --branch`. */
export const parseGitStatus = (out: string): Git | null => {
  const lines = out.split('\n').filter(Boolean)
  const head = lines[0]
  if (!head?.startsWith('## ')) return null
  const info = head.slice(3)
  const branch = info.startsWith('No commits yet on ')
    ? info.slice('No commits yet on '.length)
    : info.startsWith('HEAD (no branch)')
      ? 'HEAD solto'
      : (info.split('...')[0] ?? info).split(' ')[0] ?? info
  const ahead = Number(/ahead (\d+)/.exec(info)?.[1] ?? 0)
  const behind = Number(/behind (\d+)/.exec(info)?.[1] ?? 0)
  let staged = 0
  let modified = 0
  let untracked = 0
  for (const line of lines.slice(1)) {
    if (line.startsWith('??')) {
      untracked++
      continue
    }
    if (line[0] !== ' ') staged++
    if (line[1] !== ' ') modified++
  }
  return { branch, ahead, behind, staged, modified, untracked }
}

const levelColor = (pct: number): string => (pct >= 85 ? 'red' : pct >= WARN_AT ? 'yellow' : 'green')

const totalOf = (u: ModelUsage): number =>
  u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

const toMeter = (u: SessionUsage | SessionMeasureInput): Meter => ({
  limits: u.rateLimits.map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
  contextPercent: u.context.percent ?? null,
  contextTokens: u.context.tokens ?? null,
  contextWindow: u.context.window,
})

/**
 * Previsão de esgotamento: no ritmo médio da janela até agora, em quantos ms
 * ela chega a 100%. Null quando dura até o reset ou ainda é cedo para dizer.
 */
export const forecastOf = (limit: Limit, at: number): number | null => {
  const span = WINDOW_MS[limit.kind]
  if (!span || !limit.resetsAt || limit.percentUsed <= 0) return null
  const resetIn = Date.parse(limit.resetsAt) - at
  const elapsed = span - resetIn
  if (elapsed <= span * 0.05) return null
  const left = (100 - limit.percentUsed) * (elapsed / limit.percentUsed)
  return left < resetIn ? Math.max(0, left) : null
}

export type Warning = { id: string; text: string }

/** Os avisos de 70%: o contexto passou do pico, ou uma janela de uso está alta. */
export const warningsOf = (m: Meter | null, at: number): Warning[] => {
  if (!m) return []
  const out: Warning[] = []
  if (m.contextPercent !== null && m.contextPercent >= WARN_AT) {
    out.push({
      id: 'context',
      text: `contexto em ${m.contextPercent}%, passou do pico de inteligência; considere /compact`,
    })
  }
  for (const l of m.limits) {
    if (l.percentUsed < WARN_AT) continue
    const forecast = forecastOf(l, at)
    const tail =
      forecast !== null
        ? `acaba em ~${fmtDuration(forecast)}, antes de zerar`
        : l.resetsAt
          ? `zera em ${fmtDuration(Date.parse(l.resetsAt) - at)}`
          : ''
    const name = WINDOW_NAME[l.kind] ?? l.kind
    out.push({ id: l.kind, text: `${name} em ${Math.round(l.percentUsed)}%${tail ? `; ${tail}` : ''}` })
  }
  return out
}

// Estado do módulo: some num reload, o que só reinicia temporizadores e avisos.
const ticker = { isWorking: false, lastTick: 0, lastGit: 0 }
const warned = new Set<string>()

async function refreshGit($: EngineInterface): Promise<void> {
  const t = await $.clock.now()
  if (t - ticker.lastGit < 1000) return
  ticker.lastGit = t
  try {
    const r = await $.process.run(['git', 'status', '--porcelain=v1', '--branch'], { timeoutMs: 3000 })
    const status = r.exitCode === 0 ? parseGitStatus(r.stdout) : null
    await update($, git, () => status)
  } catch {
    await update($, git, () => null)
  }
}

async function tick($: EngineInterface): Promise<void> {
  const t = await $.clock.now()
  if (ticker.isWorking || t - ticker.lastTick >= 30_000) {
    ticker.lastTick = t
    await update($, now, () => t)
  }
  if (t - ticker.lastGit >= 15_000) await refreshGit($)
}

async function toastWarnings($: EngineInterface, m: Meter): Promise<void> {
  const list = warningsOf(m, await $.clock.now())
  const ids = new Set(list.map(w => w.id))
  for (const id of [...warned]) if (!ids.has(id)) warned.delete(id)
  for (const w of list) {
    if (warned.has(w.id)) continue
    warned.add(w.id)
    $.ui.toast(`⚠ ${w.text}`, { timeoutMs: 8000 })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const t = await $.clock.now()
    await update($, now, () => t)
    const settings: Record<string, unknown> = await $.settings.read()
    const id = settings.model
    if (typeof id === 'string') {
      const effort = typeof settings.effortLevel === 'string' ? settings.effortLevel : null
      await update($, model, m => m ?? { id, effort })
    }
    const usage = await $.session.usage()
    await update($, meter, () => toMeter(usage))
    await refreshGit($)
    $.clock.every(1000, () => void tick($))
    return result
  })

  on('session.measure', async ($, e, next) => {
    const m = toMeter(e)
    await update($, meter, () => m)
    await toastWarnings($, m)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const t = await $.clock.now()
    ticker.isWorking = true
    await update($, round, () => ({
      startedAt: t,
      endedAt: null,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      requests: 0,
      tools: 0,
      subagentTokens: 0,
    }))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const info = { id: e.model, effort: e.effort === undefined ? null : String(e.effort) }
      await update($, model, () => info)
    }
    const result = yield* next(e)
    const usage = result.usage
    if (usage) {
      await update($, round, r => {
        if (!r) return r
        if (e.agentId) return { ...r, subagentTokens: r.subagentTokens + totalOf(usage) }
        return {
          ...r,
          input: r.input + usage.input_tokens,
          output: r.output + usage.output_tokens,
          cacheRead: r.cacheRead + usage.cache_read_input_tokens,
          cacheWrite: r.cacheWrite + usage.cache_creation_input_tokens,
          requests: r.requests + 1,
        }
      })
    }
    return result
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) return next(e)
    await update($, round, r => (r ? { ...r, tools: r.tools + 1 } : r))
    const result = await next(e)
    if (e.tool === 'Bash' || e.tool === 'Edit' || e.tool === 'Write') await refreshGit($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      ticker.isWorking = false
      const t = await $.clock.now()
      await update($, round, r => (r ? { ...r, endedAt: t } : r))
      await refreshGit($)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const r = await read($, round)
    const m = await read($, meter)
    const g = await read($, git)
    const mi = await read($, model)
    const t = Math.max(await read($, now), r?.startedAt ?? 0)
    if (!r && !m && !g && !mi) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const isWide = e.props.bodyColumns >= 110
    const barWidth = isWide ? 10 : 6

    const meterBar = (pct: number, color: string) => {
      const filled = Math.min(barWidth, Math.max(0, Math.round((pct / 100) * barWidth)))
      return (
        <Box>
          <Text color={color}>{'━'.repeat(filled)}</Text>
          <Text dimColor>{'─'.repeat(barWidth - filled)}</Text>
        </Box>
      )
    }

    // Linha 1: onde estou (git), com quem (modelo) e quanto de contexto.
    const gitSeg = g && (
      <Box key="git" columnGap={1}>
        <Text color="magenta">⎇ {g.branch}</Text>
        {g.ahead > 0 ? <Text color="cyan">↑{g.ahead}</Text> : null}
        {g.behind > 0 ? <Text color="cyan">↓{g.behind}</Text> : null}
        {g.staged > 0 ? <Text color="green">+{g.staged}</Text> : null}
        {g.modified > 0 ? <Text color="yellow">~{g.modified}</Text> : null}
        {g.untracked > 0 ? <Text dimColor>?{g.untracked}</Text> : null}
        {g.staged + g.modified + g.untracked === 0 ? <Text dimColor>limpo</Text> : null}
      </Box>
    )

    const modelSeg = mi && (
      <Box key="model" columnGap={1}>
        <Text color="cyan">◆ {prettyModel(mi.id)}</Text>
        {mi.effort ? <Text dimColor>{mi.effort}</Text> : null}
      </Box>
    )

    const ctxSeg = m && m.contextPercent !== null && (
      <Box key="ctx" columnGap={1}>
        <Text dimColor>contexto</Text>
        {meterBar(m.contextPercent, levelColor(m.contextPercent))}
        <Text color={levelColor(m.contextPercent)} bold>
          {m.contextPercent}%
        </Text>
        {isWide && m.contextTokens !== null ? (
          <Text dimColor>
            {fmtTokens(m.contextTokens)}/{fmtTokens(m.contextWindow)}
          </Text>
        ) : null}
      </Box>
    )

    // Linha 2: a rodada atual (ou a última).
    const isLive = r !== null && r.endedAt === null
    const roundRow = r && (
      <Box key="round" columnGap={3} flexWrap="wrap">
        <Box columnGap={1}>
          <Text color={isLive ? 'cyan' : undefined} dimColor={!isLive}>
            {isLive ? '● rodada' : '○ última rodada'}
          </Text>
          <Text bold>{fmtTokens(r.input + r.output + r.cacheRead + r.cacheWrite)}</Text>
          <Text dimColor>tokens</Text>
          <Text dimColor>
            ↑{fmtTokens(r.input + r.cacheWrite)} ↓{fmtTokens(r.output)}
            {isWide ? ` ↻${fmtTokens(r.cacheRead)} cache` : ''}
          </Text>
        </Box>
        <Text dimColor>
          {r.requests} req · {r.tools} tools · {fmtDuration((r.endedAt ?? t) - r.startedAt)}
        </Text>
        {r.subagentTokens > 0 ? <Text color="magenta">subagentes {fmtTokens(r.subagentTokens)}</Text> : null}
      </Box>
    )

    // Linha 3: janelas de uso, como bateria (barra cheia = sobra).
    const limitSegs = (m?.limits ?? []).map(l => {
      const left = Math.max(0, 100 - l.percentUsed)
      const color = levelColor(l.percentUsed)
      const forecast = forecastOf(l, t)
      return (
        <Box key={l.kind} columnGap={1}>
          <Text dimColor>{LABEL[l.kind] ?? l.kind}</Text>
          {meterBar(left, color)}
          <Text color={color} bold>
            {Math.round(left)}%
          </Text>
          <Text dimColor>livre</Text>
          {l.resetsAt ? <Text dimColor>· zera em {fmtDuration(Date.parse(l.resetsAt) - t)}</Text> : null}
          {forecast !== null ? <Text color="yellow">· acaba em ~{fmtDuration(forecast)}</Text> : null}
        </Box>
      )
    })

    const warnings = warningsOf(m, t)

    // Duas colunas: à esquerda a rodada e as janelas, à direita modelo/contexto e git.
    const row = (key: string, left: RenderChildren, right: RenderChildren) => (
      <Box key={key} justifyContent="space-between" columnGap={3} flexWrap="wrap">
        {left}
        {right ? (
          <Box columnGap={3} flexWrap="wrap">
            {right}
          </Box>
        ) : null}
      </Box>
    )

    const rightTop = modelSeg || ctxSeg ? [modelSeg || null, ctxSeg || null] : null
    const leftTop = roundRow || <Text dimColor>○ nenhuma rodada ainda</Text>
    const leftBottom = limitSegs.length > 0 ? (
      <Box columnGap={3} flexWrap="wrap">
        {limitSegs}
      </Box>
    ) : null

    return (
      <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
        {row('top', leftTop, rightTop)}
        {leftBottom || gitSeg ? row('bottom', leftBottom ?? <Text> </Text>, gitSeg || null) : null}
        {warnings.map(w => (
          <Text key={`warn-${w.id}`} color="yellow">
            ⚠ {w.text}
          </Text>
        ))}
      </Box>
    )
  })
}
