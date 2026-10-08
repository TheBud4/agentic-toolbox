import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULT_CONFIG,
  cloneConfig,
  decide,
  needsClassifier,
  shiftTier,
  tierFromChoice,
  type ClassTier,
  type DecideInput,
} from '../hooks/tiers'

const BASE: DecideInput = {
  subagentType: 'general-purpose',
  description: 'tarefa',
  prompt: 'olhar o código',
  model: undefined,
  effort: undefined,
  turnTag: null,
  mode: null,
}

function route(over: Partial<DecideInput>, classified: ClassTier | null = null) {
  return decide({ ...BASE, ...over }, classified, DEFAULT_CONFIG)
}

describe('tierFromChoice', () => {
  test('aliases do Agent', () => {
    expect(tierFromChoice('haiku', 'high', DEFAULT_CONFIG)).toBe('leve')
    expect(tierFromChoice('sonnet', undefined, DEFAULT_CONFIG)).toBe('medio')
    expect(tierFromChoice('opus', 'high', DEFAULT_CONFIG)).toBe('pesado')
    expect(tierFromChoice('opus', 'max', DEFAULT_CONFIG)).toBe('maximo')
    expect(tierFromChoice('opus', 'xhigh', DEFAULT_CONFIG)).toBe('maximo')
  })

  test('ID completo e maiúsculas caem na família', () => {
    expect(tierFromChoice('claude-opus-5-5', undefined, DEFAULT_CONFIG)).toBe('pesado')
    expect(tierFromChoice('HAIKU', undefined, DEFAULT_CONFIG)).toBe('leve')
  })

  test('modelo fora da tabela e ausente', () => {
    expect(tierFromChoice('fable', 'high', DEFAULT_CONFIG)).toBe('fora')
    expect(tierFromChoice(undefined, 'high', DEFAULT_CONFIG)).toBe(null)
  })

  test('modelo configurado fora das famílias vira o nível configurado', () => {
    const config = cloneConfig(DEFAULT_CONFIG)
    config.tiers.maximo = { model: 'fable', effort: 'max' }
    expect(tierFromChoice('fable', 'high', config)).toBe('maximo')
  })
})

describe('shiftTier', () => {
  test('eco desce até leve', () => {
    expect(shiftTier('maximo', 'eco')).toBe('pesado')
    expect(shiftTier('pesado', 'eco')).toBe('medio')
    expect(shiftTier('medio', 'eco')).toBe('leve')
    expect(shiftTier('leve', 'eco')).toBe('leve')
  })

  test('boost sobe até pesado e nunca cria maximo', () => {
    expect(shiftTier('leve', 'boost')).toBe('medio')
    expect(shiftTier('medio', 'boost')).toBe('pesado')
    expect(shiftTier('pesado', 'boost')).toBe('pesado')
    expect(shiftTier('maximo', 'boost')).toBe('maximo')
  })
})

describe('decide: fontes', () => {
  test('fork passa sem roteamento', () => {
    expect(route({ subagentType: 'fork', model: 'opus' })).toEqual({ kind: 'fork' })
  })

  test('tag vence force e escolha do Sonnet', () => {
    expect(route({ turnTag: 'leve', mode: { force: 'pesado' }, model: 'opus' })).toEqual({
      kind: 'route', tier: 'leve', target: { model: 'haiku', effort: 'high' },
      source: 'tag', reasons: ['tag #leve'], isLimited: false,
    })
  })

  test('force vence a escolha do Sonnet', () => {
    const d = route({ mode: { force: 'pesado' }, model: 'haiku' })
    expect(d).toEqual({
      kind: 'route', tier: 'pesado', target: { model: 'opus', effort: 'high' },
      source: 'force', reasons: ['force pesado'], isLimited: false,
    })
  })

  test('escolha do Sonnet', () => {
    expect(route({ subagentType: 'Explore', model: 'haiku' })).toEqual({
      kind: 'route', tier: 'leve', target: { model: 'haiku', effort: 'high' },
      source: 'sonnet', reasons: ['sonnet'], isLimited: false,
    })
  })

  test('sem model: classificador', () => {
    const d = route({}, 'pesado')
    expect(d).toEqual({
      kind: 'route', tier: 'pesado', target: { model: 'opus', effort: 'high' },
      source: 'classificador', reasons: ['classificador'], isLimited: false,
    })
  })

  test('sem model e classificador falhou: reserva medio', () => {
    expect(route({}, null)).toEqual({
      kind: 'route', tier: 'medio', target: { model: 'sonnet', effort: 'high' },
      source: 'reserva', reasons: ['classificador falhou'], isLimited: false,
    })
  })

  test('modelo fora da tabela passa como pedido', () => {
    expect(route({ model: 'fable', effort: 'high' })).toEqual({ kind: 'fora', model: 'fable' })
  })

  test('tag vence até modelo fora da tabela', () => {
    expect(route({ model: 'fable', turnTag: 'medio' })).toMatchObject({ kind: 'route', tier: 'medio', source: 'tag' })
  })
})

describe('decide: eco, boost e limites', () => {
  test('eco desce a escolha do Sonnet', () => {
    expect(route({ mode: 'eco', model: 'sonnet', subagentType: 'Explore' })).toMatchObject({
      tier: 'leve', reasons: ['sonnet', 'eco'],
    })
  })

  test('limite de edição vem depois do eco', () => {
    expect(route({ mode: 'eco', model: 'sonnet', prompt: 'corrigir o bug no parser' })).toEqual({
      kind: 'route', tier: 'medio', target: { model: 'sonnet', effort: 'high' },
      source: 'sonnet', reasons: ['sonnet', 'eco', 'limite: edita arquivos'], isLimited: true,
    })
  })

  test('boost não passa de pesado e mantém maximo', () => {
    expect(route({ mode: 'boost', model: 'opus' })).toMatchObject({ tier: 'pesado' })
    expect(route({ mode: 'boost', model: 'opus', effort: 'max' })).toMatchObject({ tier: 'maximo' })
    expect(route({ mode: 'eco', model: 'opus', effort: 'max' })).toMatchObject({ tier: 'pesado' })
  })

  test('palavra pesada eleva a pesado', () => {
    expect(route({ model: 'sonnet', prompt: 'corrigir o deadlock no worker' })).toEqual({
      kind: 'route', tier: 'pesado', target: { model: 'opus', effort: 'high' },
      source: 'sonnet', reasons: ['sonnet', 'limite: "deadlock"'], isLimited: true,
    })
  })

  test('palavra pesada nunca rebaixa maximo', () => {
    expect(route({ model: 'opus', effort: 'max', prompt: 'deadlock' })).toMatchObject({ tier: 'maximo', isLimited: false })
  })

  test('substring não dispara palavra pesada', () => {
    expect(route({ subagentType: 'Explore', model: 'haiku', prompt: 'listar arquivos do raceway' })).toMatchObject({ tier: 'leve' })
  })

  test('tag ignora os limites', () => {
    expect(route({ turnTag: 'leve', prompt: 'corrigir o deadlock' })).toMatchObject({ tier: 'leve', isLimited: false })
  })

  test('palavra pesada em agente somente leitura sobe no máximo a medio', () => {
    expect(route({ subagentType: 'Explore', model: 'haiku', prompt: 'Find where the migration files live' })).toEqual({
      kind: 'route', tier: 'medio', target: { model: 'sonnet', effort: 'high' },
      source: 'sonnet', reasons: ['sonnet', 'limite: "migration"'], isLimited: true,
    })
    expect(route({ subagentType: 'Explore', model: 'opus', prompt: 'explain the architecture' })).toMatchObject({ tier: 'pesado', isLimited: false })
  })

  test('agente somente leitura não conta como edição', () => {
    expect(route({ subagentType: 'Explore', model: 'haiku', prompt: 'descobrir como corrigir o bug' })).toMatchObject({ tier: 'leve' })
  })

  test('verbo de escrita em inglês conta como edição', () => {
    expect(route({ model: 'haiku', prompt: 'implement the parser' })).toMatchObject({ tier: 'medio', isLimited: true })
  })

  test('tipo desconhecido sem verbo de escrita não é edição', () => {
    expect(route({ subagentType: 'my-agent', model: 'haiku', prompt: 'resumir o README' })).toMatchObject({ tier: 'leve' })
  })
})

describe('needsClassifier', () => {
  test('só sem model, sem tag, sem force, não fork e ligado', () => {
    expect(needsClassifier(BASE, DEFAULT_CONFIG)).toBe(true)
    expect(needsClassifier({ ...BASE, model: 'haiku' }, DEFAULT_CONFIG)).toBe(false)
    expect(needsClassifier({ ...BASE, turnTag: 'leve' }, DEFAULT_CONFIG)).toBe(false)
    expect(needsClassifier({ ...BASE, mode: { force: 'medio' } }, DEFAULT_CONFIG)).toBe(false)
    expect(needsClassifier({ ...BASE, subagentType: 'fork' }, DEFAULT_CONFIG)).toBe(false)
    const off = cloneConfig(DEFAULT_CONFIG)
    off.classifier.enabled = false
    expect(needsClassifier(BASE, off)).toBe(false)
  })

  test('classificador desligado: motivo diz desligado', () => {
    const off = cloneConfig(DEFAULT_CONFIG)
    off.classifier.enabled = false
    expect(decide(BASE, null, off)).toMatchObject({ tier: 'medio', source: 'reserva', reasons: ['classificador desligado'] })
  })
})
