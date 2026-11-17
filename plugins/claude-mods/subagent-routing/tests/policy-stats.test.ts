import { describe, expect, test } from 'claude-code/testing'

import { POLICY_SECTION_ID, policyText } from '../hooks/policy'
import {
  addToStats,
  coerceStats,
  emptyStats,
  formatStats,
  lastRouteOf,
  modeLabel,
  statusText,
  toastText,
} from '../hooks/stats'
import { DEFAULT_CONFIG, cloneConfig, type RouteDecision } from '../hooks/tiers'

const ROUTED: RouteDecision = {
  kind: 'route', tier: 'pesado', target: { model: 'opus', effort: 'high' },
  source: 'sonnet', reasons: ['sonnet', 'limite: "deadlock"'], isLimited: true,
}

describe('policyText', () => {
  test('lista cada nível com o alvo configurado', () => {
    const text = policyText(DEFAULT_CONFIG)
    expect(POLICY_SECTION_ID).toBe('subagent-routing:policy')
    expect(text).toContain('- leve (')
    expect(text).toContain('model: "haiku", effort: "high"')
    expect(text).toContain('model: "opus", effort: "max"')
    expect(text).toContain('fork')
  })

  test('reflete a config alterada', () => {
    const config = cloneConfig(DEFAULT_CONFIG)
    config.tiers.leve = { model: 'haiku', effort: 'low' }
    expect(policyText(config)).toContain('model: "haiku", effort: "low"')
  })
})

describe('stats', () => {
  test('rota limitada conta nível, fonte e limite, sem mutar a entrada', () => {
    const before = emptyStats()
    const after = addToStats(before, ROUTED)
    expect(after.porNivel.pesado).toBe(1)
    expect(after.porFonte.sonnet).toBe(1)
    expect(after.porFonte.limite).toBe(1)
    expect(before.porNivel.pesado).toBe(0)
  })

  test('fork e fora da tabela', () => {
    const stats = addToStats(addToStats(emptyStats(), { kind: 'fork' }), { kind: 'fora', model: 'fable' })
    expect(stats.fork).toBe(1)
    expect(stats.foraDaTabela).toBe(1)
  })

  test('coerceStats tolera lixo e campos faltando', () => {
    expect(coerceStats('lixo')).toEqual(emptyStats())
    expect(coerceStats({ porNivel: { leve: 3, medio: -1 }, fork: 'x' }).porNivel).toEqual({
      leve: 3, medio: 0, pesado: 0, maximo: 0,
    })
  })

  test('formatStats tem as linhas de nível e fonte', () => {
    const text = formatStats(addToStats(emptyStats(), ROUTED), emptyStats())
    expect(text).toContain('pesado')
    expect(text).toContain('fora da tabela')
    expect(text).toContain('limite')
  })
})

describe('textos', () => {
  test('toast de rota, fork e fora da tabela', () => {
    expect(toastText(ROUTED, 'corrigir deadlock')).toBe('→ opus/high · "corrigir deadlock" · sonnet, limite: "deadlock"')
    expect(toastText({ kind: 'fork' }, 'x')).toBe('fork · sem roteamento · "x"')
    expect(toastText({ kind: 'fora', model: 'fable' }, 'x')).toBe('fable · fora da tabela · "x"')
  })

  test('descrição longa é cortada', () => {
    expect(toastText({ kind: 'fork' }, 'a'.repeat(100))).toBe(`fork · sem roteamento · "${'a'.repeat(39)}…"`)
  })

  test('status', () => {
    const last = lastRouteOf(ROUTED, 'corrigir deadlock', undefined)
    expect(last).toEqual({ model: 'opus', effort: 'high', tier: 'pesado', reason: 'sonnet, limite: "deadlock"', description: 'corrigir deadlock' })
    expect(statusText(null, null)).toBe('rota: sem delegações')
    expect(statusText('eco', last)).toBe('rota: eco · última opus/high')
    expect(statusText({ force: 'pesado' }, null)).toBe('rota: force pesado · sem delegações')
    expect(modeLabel(null)).toBe('normal')
  })

  test('lastRouteOf de fora da tabela usa o effort pedido', () => {
    expect(lastRouteOf({ kind: 'fora', model: 'fable' }, 'x', 'medium')).toMatchObject({ model: 'fable', effort: 'medium', tier: null })
  })
})
