import type { RouteEffort, RouteMode, RouteModel, RouteSource, RouteTarget, RouteTier } from '../types'

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

/** O maior atraso que um timer aceita; `$.model.complete` recusa `timeoutMs` acima disso. */
const MAX_TIMER_MS = 2147483647

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `term` aparece em `text` como palavra (ou expressão) inteira, sem acento nem caixa; `_` une palavras (update_user). */
export function containsTerm(text: string, term: string): boolean {
  const wanted = normalize(term).trim()
  if (wanted === '') return false
  return new RegExp(`(^|[^a-z0-9_])${escapeRegExp(wanted)}([^a-z0-9_]|$)`).test(normalize(text))
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
    if (typeof timeoutMs === 'number' && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_TIMER_MS) {
      config.classifier.timeoutMs = timeoutMs
    }
    else if (timeoutMs !== undefined) isRepaired = true
    if (fallback === 'leve' || fallback === 'medio' || fallback === 'pesado') config.classifier.fallback = fallback
    else if (fallback !== undefined) isRepaired = true
  } else if (saved.classifier !== undefined) {
    isRepaired = true
  }

  return { config, isRepaired }
}

export type DecideInput = {
  subagentType: string | undefined
  description: string
  prompt: string
  model: string | undefined
  effort: string | undefined
  turnTag: RouteTier | null
  mode: RouteMode
}

export type RouteDecision =
  | { kind: 'fork' }
  | { kind: 'fora'; model: string }
  | {
      kind: 'route'
      tier: RouteTier
      target: RouteTarget
      source: RouteSource
      reasons: string[]
      isLimited: boolean
    }

const RANK: Record<RouteTier, number> = { leve: 0, medio: 1, pesado: 2, maximo: 3 }
const HIGHEST_FIRST: readonly RouteTier[] = ['maximo', 'pesado', 'medio', 'leve']

export function isForced(mode: RouteMode): mode is { force: RouteTier } {
  return typeof mode === 'object' && mode !== null
}

/** Nível que o Sonnet pediu: alvo exato configurado, depois família do modelo; só effort max/xhigh, sem model, é maximo. */
export function tierFromChoice(
  model: string | undefined,
  effort: string | undefined,
  config: RouteConfig,
): RouteTier | 'fora' | null {
  const e = effort === undefined ? undefined : normalize(effort).trim()
  if (model === undefined || model.trim() === '') return e === 'max' || e === 'xhigh' ? 'maximo' : null
  const m = normalize(model).trim()

  const exact = HIGHEST_FIRST.find(tier => config.tiers[tier].model === m && config.tiers[tier].effort === e)
  if (exact !== undefined) return exact
  if (m.includes('haiku')) return 'leve'
  if (m.includes('sonnet')) return 'medio'
  if (m.includes('opus')) return e === 'max' || e === 'xhigh' ? 'maximo' : 'pesado'
  return HIGHEST_FIRST.find(tier => config.tiers[tier].model === m) ?? 'fora'
}

export function shiftTier(tier: RouteTier, mode: 'eco' | 'boost'): RouteTier {
  if (mode === 'eco') {
    if (tier === 'maximo') return 'pesado'
    if (tier === 'pesado') return 'medio'
    return 'leve'
  }
  if (tier === 'leve') return 'medio'
  if (tier === 'medio') return 'pesado'
  return tier
}

export function isReadOnlyAgent(subagentType: string | undefined, config: RouteConfig): boolean {
  const type = normalize(subagentType ?? 'general-purpose')
  return config.readOnlyAgents.some(agent => normalize(agent) === type)
}

export function editsFiles(subagentType: string | undefined, text: string, config: RouteConfig): boolean {
  if (isReadOnlyAgent(subagentType, config)) return false
  return config.writeVerbs.some(verb => containsTerm(text, verb))
}

export function findHeavyKeyword(text: string, config: RouteConfig): string | null {
  return config.heavyKeywords.find(word => containsTerm(text, word)) ?? null
}

export function needsClassifier(input: DecideInput, config: RouteConfig): boolean {
  return (
    config.classifier.enabled &&
    input.subagentType !== 'fork' &&
    input.turnTag === null &&
    !isForced(input.mode) &&
    tierFromChoice(input.model, input.effort, config) === null
  )
}

export function decide(input: DecideInput, classified: ClassTier | null, config: RouteConfig): RouteDecision {
  if (input.subagentType === 'fork') return { kind: 'fork' }

  const route = (tier: RouteTier, source: RouteSource, reasons: string[], isLimited = false): RouteDecision => ({
    kind: 'route', tier, target: { ...config.tiers[tier] }, source, reasons, isLimited,
  })

  if (input.turnTag !== null) return route(input.turnTag, 'tag', [`tag #${input.turnTag}`])
  if (isForced(input.mode)) return route(input.mode.force, 'force', [`force ${input.mode.force}`])

  const choice = tierFromChoice(input.model, input.effort, config)
  if (choice === 'fora') return { kind: 'fora', model: input.model ?? '' }

  let tier: RouteTier
  let source: RouteSource
  const reasons: string[] = []
  if (choice !== null) {
    tier = choice
    source = 'sonnet'
    reasons.push('sonnet')
  } else if (classified !== null) {
    tier = classified
    source = 'classificador'
    reasons.push('classificador')
  } else {
    tier = config.classifier.fallback
    source = 'reserva'
    reasons.push(config.classifier.enabled ? 'classificador falhou' : 'classificador desligado')
  }

  if (input.mode === 'eco' || input.mode === 'boost') {
    const shifted = shiftTier(tier, input.mode)
    if (shifted !== tier) {
      tier = shifted
      reasons.push(input.mode)
    }
  }

  const text = `${input.description}\n${input.prompt}`
  let isLimited = false
  if (RANK[tier] < RANK.medio && editsFiles(input.subagentType, text, config)) {
    tier = 'medio'
    reasons.push('limite: edita arquivos')
    isLimited = true
  }
  // Agente somente leitura só lê: palavra pesada no texto sobe a medio, não a Opus.
  const keywordFloor: RouteTier = isReadOnlyAgent(input.subagentType, config) ? 'medio' : 'pesado'
  const keyword = RANK[tier] < RANK[keywordFloor] ? findHeavyKeyword(text, config) : null
  if (keyword !== null) {
    tier = keywordFloor
    reasons.push(`limite: "${keyword}"`)
    isLimited = true
  }

  return route(tier, source, reasons, isLimited)
}
