import type { LastRoute, RouteMode, RouteSource, RouteStats } from '../types'
import { TIERS, isForced, type RouteDecision } from './tiers'

export const SOURCES: readonly (RouteSource | 'limite')[] = [
  'tag', 'force', 'sonnet', 'classificador', 'reserva', 'limite',
]

export function emptyStats(): RouteStats {
  return {
    porNivel: { leve: 0, medio: 0, pesado: 0, maximo: 0 },
    porFonte: { tag: 0, force: 0, sonnet: 0, classificador: 0, reserva: 0, limite: 0 },
    fork: 0,
    foraDaTabela: 0,
  }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** Lê estatísticas salvas tolerando lixo; sempre devolve um objeto novo. */
export function coerceStats(raw: unknown): RouteStats {
  const stats = emptyStats()
  const saved = record(raw)
  const porNivel = record(saved.porNivel)
  const porFonte = record(saved.porFonte)
  for (const tier of TIERS) stats.porNivel[tier] = count(porNivel[tier])
  for (const source of SOURCES) stats.porFonte[source] = count(porFonte[source])
  stats.fork = count(saved.fork)
  stats.foraDaTabela = count(saved.foraDaTabela)
  return stats
}

export function addToStats(stats: RouteStats, decision: RouteDecision): RouteStats {
  const next = coerceStats(stats)
  if (decision.kind === 'fork') {
    next.fork += 1
  } else if (decision.kind === 'fora') {
    next.foraDaTabela += 1
  } else {
    next.porNivel[decision.tier] += 1
    next.porFonte[decision.source] += 1
    if (decision.isLimited) next.porFonte.limite += 1
  }
  return next
}

function clip(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function toastText(decision: RouteDecision, description: string): string {
  const desc = `"${clip(description)}"`
  if (decision.kind === 'fork') return `fork · sem roteamento · ${desc}`
  if (decision.kind === 'fora') return `${decision.model} · fora da tabela · ${desc}`
  return `→ ${decision.target.model}/${decision.target.effort} · ${desc} · ${decision.reasons.join(', ')}`
}

export function lastRouteOf(decision: RouteDecision, description: string, askedEffort: string | undefined): LastRoute {
  if (decision.kind === 'fork') return { model: 'fork', effort: '-', tier: null, reason: 'fork', description }
  if (decision.kind === 'fora') {
    return { model: decision.model, effort: askedEffort ?? '-', tier: null, reason: 'fora da tabela', description }
  }
  return {
    model: decision.target.model,
    effort: decision.target.effort,
    tier: decision.tier,
    reason: decision.reasons.join(', '),
    description,
  }
}

export function modeLabel(mode: RouteMode): string {
  if (mode === null) return 'normal'
  if (isForced(mode)) return `force ${mode.force}`
  return mode
}

export function statusText(mode: RouteMode, last: LastRoute | null): string {
  const parts = mode === null ? [] : [modeLabel(mode)]
  parts.push(last === null ? 'sem delegações' : `última ${last.model}/${last.effort}`)
  return `rota: ${parts.join(' · ')}`
}

function row(label: string, session: number | string, total: number | string): string {
  return `${label.padEnd(16)}${String(session).padStart(8)}${String(total).padStart(8)}`
}

export function formatStats(session: RouteStats, total: RouteStats): string {
  return [
    row('nível', 'sessão', 'total'),
    ...TIERS.map(tier => row(tier, session.porNivel[tier], total.porNivel[tier])),
    row('fork', session.fork, total.fork),
    row('fora da tabela', session.foraDaTabela, total.foraDaTabela),
    '',
    row('fonte', 'sessão', 'total'),
    ...SOURCES.map(source => row(source, session.porFonte[source], total.porFonte[source])),
    '',
    '"limite" conta as decisões que um limite fixo elevou (também contadas na fonte original).',
  ].join('\n')
}
