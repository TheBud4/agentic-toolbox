import type { RouteEffort, RouteModel, RouteTarget, RouteTier } from '../types'

export type ClassTier = Exclude<RouteTier, 'maximo'>

export type RouteConfig = {
  tiers: Record<RouteTier, RouteTarget>
  heavyKeywords: string[]
  writeVerbs: string[]
  readOnlyAgents: string[]
  classifier: { enabled: boolean; timeoutMs: number; fallback: ClassTier }
}

export const TIERS: readonly RouteTier[] = ['leve', 'medio', 'pesado', 'maximo']
export const MODELS: readonly RouteModel[] = ['haiku', 'sonnet', 'opus', 'fable']
export const EFFORTS: readonly RouteEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const DEFAULT_CONFIG: RouteConfig = {
  tiers: {
    leve: { model: 'haiku', effort: 'high' },
    medio: { model: 'sonnet', effort: 'high' },
    pesado: { model: 'opus', effort: 'high' },
    maximo: { model: 'opus', effort: 'max' },
  },
  heavyKeywords: [
    'debug', 'debugar', 'depurar', 'arquitetura', 'architecture', 'race',
    'race condition', 'condição de corrida', 'concorrência', 'concurrency',
    'segurança', 'security', 'vulnerabilidade', 'vulnerability', 'deadlock',
    'migração', 'migration', 'causa raiz', 'root cause',
  ],
  writeVerbs: [
    'implementar', 'implemente', 'implementa', 'editar', 'edite', 'edita',
    'corrigir', 'corrija', 'corrige', 'refatorar', 'refatore', 'refatora',
    'criar', 'crie', 'cria', 'escrever', 'escreva', 'escreve', 'alterar',
    'altere', 'altera', 'adicionar', 'adicione', 'adiciona', 'remover',
    'remova', 'renomear', 'renomeie', 'implement', 'edit', 'fix', 'refactor',
    'write', 'create', 'modify', 'update', 'add', 'delete', 'rename', 'remove',
  ],
  readOnlyAgents: [
    'Explore', 'Plan', 'auditor', 'claude-code-guide',
    'feature-dev:code-explorer', 'feature-dev:code-reviewer',
    'feature-dev:code-architect', 'hookify:conversation-analyzer',
  ],
  classifier: { enabled: true, timeoutMs: 4000, fallback: 'medio' },
}

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `term` aparece em `text` como palavra (ou expressão) inteira, sem acento nem caixa. */
export function containsTerm(text: string, term: string): boolean {
  const wanted = normalize(term).trim()
  if (wanted === '') return false
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(wanted)}([^a-z0-9]|$)`).test(normalize(text))
}

export function parseTier(word: string): RouteTier | null {
  const w = normalize(word).trim()
  if (w === 'max') return 'maximo'
  return (TIERS as readonly string[]).includes(w) ? (w as RouteTier) : null
}

export function parseTarget(spec: string): RouteTarget | null {
  const [model, effort, ...rest] = normalize(spec).trim().split('/')
  if (model === undefined || effort === undefined || rest.length > 0) return null
  if (!(MODELS as readonly string[]).includes(model)) return null
  if (!(EFFORTS as readonly string[]).includes(effort)) return null
  return { model: model as RouteModel, effort: effort as RouteEffort }
}

export function cloneConfig(config: RouteConfig): RouteConfig {
  return JSON.parse(JSON.stringify(config)) as RouteConfig
}

function isTarget(value: unknown): value is RouteTarget {
  if (typeof value !== 'object' || value === null) return false
  const { model, effort } = value as Record<string, unknown>
  return (
    typeof model === 'string' && (MODELS as readonly string[]).includes(model) &&
    typeof effort === 'string' && (EFFORTS as readonly string[]).includes(effort)
  )
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/** Mescla a config salva sobre o padrão. Ausente: padrão em silêncio. Inválido: padrão e `isRepaired`. */
export function mergeConfig(raw: unknown): { config: RouteConfig; isRepaired: boolean } {
  const config = cloneConfig(DEFAULT_CONFIG)
  if (raw === undefined || raw === null) return { config, isRepaired: false }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { config, isRepaired: true }

  const saved = raw as Record<string, unknown>
  let isRepaired = false

  if (typeof saved.tiers === 'object' && saved.tiers !== null) {
    const tiers = saved.tiers as Record<string, unknown>
    for (const tier of TIERS) {
      const value = tiers[tier]
      if (value === undefined) continue
      if (isTarget(value)) config.tiers[tier] = { model: value.model, effort: value.effort }
      else isRepaired = true
    }
  } else if (saved.tiers !== undefined) {
    isRepaired = true
  }

  for (const key of ['heavyKeywords', 'writeVerbs', 'readOnlyAgents'] as const) {
    const value = saved[key]
    if (value === undefined) continue
    if (isStringList(value)) config[key] = [...value]
    else isRepaired = true
  }

  if (typeof saved.classifier === 'object' && saved.classifier !== null) {
    const { enabled, timeoutMs, fallback } = saved.classifier as Record<string, unknown>
    if (typeof enabled === 'boolean') config.classifier.enabled = enabled
    else if (enabled !== undefined) isRepaired = true
    if (typeof timeoutMs === 'number' && timeoutMs > 0) config.classifier.timeoutMs = timeoutMs
    else if (timeoutMs !== undefined) isRepaired = true
    if (fallback === 'leve' || fallback === 'medio' || fallback === 'pesado') config.classifier.fallback = fallback
    else if (fallback !== undefined) isRepaired = true
  } else if (saved.classifier !== undefined) {
    isRepaired = true
  }

  return { config, isRepaired }
}
