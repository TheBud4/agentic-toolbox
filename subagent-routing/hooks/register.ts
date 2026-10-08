import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { CLASSIFIER_SYSTEM, buildClassifierPrompt, parseClassification, type TaskText } from './classify'
import { runRouteCommand } from './command'
import { POLICY_SECTION_ID, policyText } from './policy'
import { addToStats, coerceStats, emptyStats, lastRouteOf, statusText, toastText } from './stats'
import { extractTag } from './tags'
import {
  decide,
  mergeConfig,
  needsClassifier,
  type ClassTier,
  type DecideInput,
  type RouteConfig,
  type RouteDecision,
} from './tiers'

const modeAtom = atom({ plugin: 'subagent-routing', key: 'mode' } as const, null)
const turnTagAtom = atom({ plugin: 'subagent-routing', key: 'turnTag' } as const, null)
const lastRouteAtom = atom({ plugin: 'subagent-routing', key: 'lastRoute' } as const, null)
const sessionStatsAtom = atom({ plugin: 'subagent-routing', key: 'sessionStats' } as const, emptyStats())

const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

let hasWarnedConfig = false
let totalQueue: Promise<void> = Promise.resolve()

async function loadConfig($: EngineInterface): Promise<RouteConfig> {
  const { config, isRepaired } = mergeConfig(await $.store.get('config'))
  if (isRepaired && !hasWarnedConfig) {
    hasWarnedConfig = true
    $.ui.toast('subagent-routing: configuração com campos inválidos; usando o padrão neles (/route defaults restaura tudo)')
  }
  return config
}

/**
 * Pergunta ao Haiku o nível da tarefa. Qualquer falha devolve `null`.
 * Fica aqui, e não em classify.ts, porque o motor não segue `$` através de um import.
 */
async function classify($: EngineInterface, input: TaskText, config: RouteConfig): Promise<ClassTier | null> {
  try {
    const reply = await $.model.complete({
      model: 'haiku',
      system: CLASSIFIER_SYSTEM,
      prompt: buildClassifierPrompt(input),
      effort: 'low',
      timeoutMs: config.classifier.timeoutMs,
    })
    return reply.isAnswered ? parseClassification(reply.text) : null
  } catch {
    return null
  }
}

/** Delegações em paralelo: serializa o read-modify-write das estatísticas acumuladas. */
function bumpTotal($: EngineInterface, decision: RouteDecision): Promise<void> {
  totalQueue = totalQueue
    .then(async () => {
      await $.store.set('stats', addToStats(coerceStats(await $.store.get('stats')), decision))
    })
    .catch(() => undefined)
  return totalQueue
}

async function report($: EngineInterface, decision: RouteDecision, description: string, askedEffort: string | undefined) {
  const last = lastRouteOf(decision, description, askedEffort)
  await update($, lastRouteAtom, () => last)
  await update($, sessionStatsAtom, stats => addToStats(stats, decision))
  await bumpTotal($, decision)
  $.ui.toast(toastText(decision, description))
  $.ui.status(statusText(await read($, modeAtom), last))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Roteamento de subagentes: níveis, modos e estatísticas',
      argumentHint: '[show|set|keywords|verbs|readonly|classifier|force|eco|boost|reset|stats|defaults]',
      immediate: true,
    })
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes('Agent')) return composed
    const config = await loadConfig($)
    return {
      ...composed,
      sections: [...composed.sections, { id: POLICY_SECTION_ID, text: policyText(config), scope: 'session' as const }],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!PERSON_ORIGINS.has(e.origin.kind) || e.text.trimStart().startsWith('/')) return next(e)
    const { text, tag, count } = extractTag(e.text)
    await update($, turnTagAtom, () => tag)
    if (count > 1) $.ui.toast(`subagent-routing: várias tags; vale #${tag}`)
    return next(count > 0 ? { ...e, text } : e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const config = await loadConfig($)
    const input: DecideInput = {
      subagentType: e.subagent_type,
      description: e.description,
      prompt: e.prompt,
      model: e.model,
      effort: e.effort,
      turnTag: await read($, turnTagAtom),
      mode: await read($, modeAtom),
    }
    const classified = needsClassifier(input, config) ? await classify($, input, config) : null
    const decision = decide(input, classified, config)
    await report($, decision, e.description, e.effort)
    return next(
      decision.kind === 'route' ? { ...e, model: decision.target.model, effort: decision.target.effort } : e,
    )
  }).catch(($, e, next) => {
    if (!next.called) {
      try {
        $.ui.toast('subagent-routing: erro, seguiu sem roteamento')
      } catch {
        // o toast é cortesia; a delegação segue de qualquer jeito
      }
    }
    return next(e)
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const outcome = runRouteCommand(e.args, {
      config: await loadConfig($),
      mode: await read($, modeAtom),
      session: await read($, sessionStatsAtom),
      total: coerceStats(await $.store.get('stats')),
    })
    if (outcome.config !== undefined) await $.store.set('config', outcome.config)
    if (outcome.mode !== undefined) {
      const mode = outcome.mode
      await update($, modeAtom, () => mode)
      $.ui.status(statusText(mode, await read($, lastRouteAtom)))
    }
    if (outcome.isResettingStats === true) {
      await update($, sessionStatsAtom, () => emptyStats())
      await $.store.set('stats', emptyStats())
    }
    return { text: outcome.text }
  })
}
