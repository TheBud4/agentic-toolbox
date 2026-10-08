import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULT_CONFIG,
  containsTerm,
  mergeConfig,
  normalize,
  parseTarget,
  parseTier,
} from '../hooks/tiers'

describe('normalize e containsTerm', () => {
  test('remove acento e caixa', () => {
    expect(normalize('Migração ÁGIL')).toBe('migracao agil')
  })

  test('casa palavra inteira, nunca substring', () => {
    expect(containsTerm('corrigir o Deadlock no worker', 'deadlock')).toBe(true)
    expect(containsTerm('listar arquivos do raceway', 'race')).toBe(false)
    expect(containsTerm('há uma race condition aqui', 'race condition')).toBe(true)
    expect(containsTerm('revisar a segurança do login', 'segurança')).toBe(true)
    expect(containsTerm('qualquer coisa', '   ')).toBe(false)
    expect(containsTerm('ler update_user em fix_tests.py', 'update')).toBe(false)
    expect(containsTerm('ler update_user em fix_tests.py', 'fix')).toBe(false)
  })
})

describe('parseTier e parseTarget', () => {
  test('níveis com acento e apelidos', () => {
    expect(parseTier('Médio')).toBe('medio')
    expect(parseTier('max')).toBe('maximo')
    expect(parseTier('máximo')).toBe('maximo')
    expect(parseTier('turbo')).toBe(null)
  })

  test('modelo/effort válidos, sem caixa', () => {
    expect(parseTarget('Haiku/Medium')).toEqual({ model: 'haiku', effort: 'medium' })
  })

  test('modelo/effort inválidos', () => {
    expect(parseTarget('gpt/high')).toBe(null)
    expect(parseTarget('opus/ultra')).toBe(null)
    expect(parseTarget('opus')).toBe(null)
    expect(parseTarget('opus/high/x')).toBe(null)
  })
})

describe('mergeConfig', () => {
  test('nada salvo: padrão, sem aviso', () => {
    expect(mergeConfig(undefined)).toEqual({ config: DEFAULT_CONFIG, isRepaired: false })
  })

  test('campo válido sobrescreve; ausente usa o padrão em silêncio', () => {
    const { config, isRepaired } = mergeConfig({ tiers: { leve: { model: 'haiku', effort: 'low' } } })
    expect(config.tiers.leve).toEqual({ model: 'haiku', effort: 'low' })
    expect(config.tiers.medio).toEqual(DEFAULT_CONFIG.tiers.medio)
    expect(isRepaired).toBe(false)
  })

  test('campo inválido usa o padrão e avisa', () => {
    const { config, isRepaired } = mergeConfig({
      tiers: { leve: { model: 'gpt', effort: 'low' } },
      heavyKeywords: 'deadlock',
      classifier: { timeoutMs: -1 },
    })
    expect(config.tiers.leve).toEqual(DEFAULT_CONFIG.tiers.leve)
    expect(config.heavyKeywords).toEqual(DEFAULT_CONFIG.heavyKeywords)
    expect(config.classifier.timeoutMs).toBe(4000)
    expect(isRepaired).toBe(true)
  })

  test('timeoutMs precisa ser inteiro e caber num timer', () => {
    expect(mergeConfig({ classifier: { timeoutMs: 1500.5 } })).toMatchObject({ isRepaired: true, config: { classifier: { timeoutMs: 4000 } } })
    expect(mergeConfig({ classifier: { timeoutMs: 2147483648 } })).toMatchObject({ isRepaired: true, config: { classifier: { timeoutMs: 4000 } } })
    expect(mergeConfig({ classifier: { timeoutMs: 2500 } })).toMatchObject({ isRepaired: false, config: { classifier: { timeoutMs: 2500 } } })
  })

  test('valor que nem é objeto: padrão e avisa', () => {
    expect(mergeConfig('lixo')).toEqual({ config: DEFAULT_CONFIG, isRepaired: true })
  })

  test('o resultado não compartilha listas com o padrão', () => {
    const { config } = mergeConfig(undefined)
    config.heavyKeywords.push('x')
    expect(DEFAULT_CONFIG.heavyKeywords).not.toContain('x')
  })
})
