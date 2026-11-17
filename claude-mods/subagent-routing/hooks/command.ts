import type { RouteMode, RouteStats } from '../types'
import { formatStats, modeLabel } from './stats'
import {
  DEFAULT_CONFIG,
  EFFORTS,
  MODELS,
  TIERS,
  cloneConfig,
  normalize,
  parseTarget,
  parseTier,
  type RouteConfig,
} from './tiers'

export type RouteCommandContext = { config: RouteConfig; mode: RouteMode; session: RouteStats; total: RouteStats }
export type RouteCommandOutcome = { text: string; config?: RouteConfig; mode?: RouteMode; isResettingStats?: boolean }

export const USAGE = [
  'Uso: /route [subcomando]',
  '  show                               config, modo e resumo (padrão)',
  '  set <nível> <modelo>/<effort>      altera um nível',
  '  keywords|verbs|readonly add|rm <termo>   edita as listas',
  '  classifier on|off                  liga/desliga o classificador',
  '  force <nível> | eco | boost        modo desta sessão',
  '  reset                              volta ao modo normal',
  '  stats [reset]                      estatísticas (ou zera)',
  '  defaults                           restaura a config padrão',
].join('\n')

const LISTS = { keywords: 'heavyKeywords', verbs: 'writeVerbs', readonly: 'readOnlyAgents' } as const

function delegations(stats: RouteStats): number {
  return TIERS.reduce((sum, tier) => sum + stats.porNivel[tier], 0) + stats.fork + stats.foraDaTabela
}

function showText({ config, mode, session }: RouteCommandContext): string {
  const c = config.classifier
  return [
    'Níveis:',
    ...TIERS.map(tier => `  ${tier.padEnd(7)} → ${config.tiers[tier].model}/${config.tiers[tier].effort}`),
    `Modo: ${modeLabel(mode)}`,
    `Classificador: ${c.enabled ? 'ligado' : 'desligado'} (timeout ${c.timeoutMs} ms, reserva ${c.fallback})`,
    `Palavras pesadas: ${config.heavyKeywords.join(', ')}`,
    `Verbos de escrita: ${config.writeVerbs.join(', ')}`,
    `Agentes somente leitura: ${config.readOnlyAgents.join(', ')}`,
    `Delegações nesta sessão: ${delegations(session)}`,
  ].join('\n')
}

export function runRouteCommand(args: string, ctx: RouteCommandContext): RouteCommandOutcome {
  const [sub = 'show', ...rest] = args.trim().split(/\s+/).filter(word => word !== '')
  const name = normalize(sub)

  switch (name) {
    case 'show':
      return { text: showText(ctx) }

    case 'set': {
      const tier = parseTier(rest[0] ?? '')
      const target = parseTarget(rest[1] ?? '')
      if (tier === null || target === null || rest.length !== 2) {
        return {
          text: `Uso: /route set <nível> <modelo>/<effort>\nNíveis: ${TIERS.join(', ')} · modelos: ${MODELS.join(', ')} · efforts: ${EFFORTS.join(', ')}`,
        }
      }
      const config = cloneConfig(ctx.config)
      config.tiers[tier] = target
      return { text: `${tier} → ${target.model}/${target.effort}`, config }
    }

    case 'keywords':
    case 'verbs':
    case 'readonly': {
      const key = LISTS[name]
      const op = normalize(rest[0] ?? '')
      const term = rest.slice(1).join(' ').trim()
      if ((op !== 'add' && op !== 'rm') || term === '') return { text: `Uso: /route ${name} add|rm <termo>` }
      const isSame = (item: string) => normalize(item) === normalize(term)
      const list = ctx.config[key]
      if (op === 'add') {
        if (list.some(isSame)) return { text: `"${term}" já está em ${name}.` }
        const config = cloneConfig(ctx.config)
        config[key] = [...list, term]
        return { text: `"${term}" adicionado a ${name}.`, config }
      }
      if (!list.some(isSame)) return { text: `"${term}" não está em ${name}.` }
      const config = cloneConfig(ctx.config)
      config[key] = list.filter(item => !isSame(item))
      return { text: `"${term}" removido de ${name}.`, config }
    }

    case 'classifier': {
      const value = normalize(rest[0] ?? '')
      if (value !== 'on' && value !== 'off') return { text: 'Uso: /route classifier on|off' }
      const config = cloneConfig(ctx.config)
      config.classifier.enabled = value === 'on'
      return { text: `Classificador ${value === 'on' ? 'ligado' : 'desligado'}.`, config }
    }

    case 'force': {
      const tier = parseTier(rest[0] ?? '')
      if (tier === null) return { text: `Uso: /route force <nível> (${TIERS.join(', ')})` }
      const { model, effort } = ctx.config.tiers[tier]
      return {
        text: `Modo forçado: toda delegação desta sessão vai para ${tier} (${model}/${effort}). /route reset volta ao normal.`,
        mode: { force: tier },
      }
    }

    case 'eco':
      return { text: 'Modo eco: delegações descem um nível nesta sessão (limites fixos continuam valendo).', mode: 'eco' }

    case 'boost':
      return { text: 'Modo boost: delegações sobem um nível nesta sessão (no máximo até pesado).', mode: 'boost' }

    case 'reset':
      return { text: 'Modo normal.', mode: null }

    case 'stats':
      if (normalize(rest[0] ?? '') === 'reset') return { text: 'Estatísticas zeradas.', isResettingStats: true }
      return { text: formatStats(ctx.session, ctx.total) }

    case 'defaults':
      return { text: 'Configuração padrão restaurada.', config: cloneConfig(DEFAULT_CONFIG) }

    default:
      return { text: USAGE }
  }
}
