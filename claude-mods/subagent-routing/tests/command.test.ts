import { describe, expect, test } from 'claude-code/testing'

import { USAGE, runRouteCommand, type RouteCommandContext } from '../hooks/command'
import { emptyStats } from '../hooks/stats'
import { DEFAULT_CONFIG, cloneConfig } from '../hooks/tiers'

function ctx(): RouteCommandContext {
  return { config: cloneConfig(DEFAULT_CONFIG), mode: null, session: emptyStats(), total: emptyStats() }
}

describe('mostrar', () => {
  test('sem argumentos e show mostram a config', () => {
    for (const args of ['', '  ', 'show']) {
      const out = runRouteCommand(args, ctx())
      expect(out.text).toContain('leve    → haiku/high')
      expect(out.text).toContain('Modo: normal')
      expect(out.config).toBe(undefined)
      expect('mode' in out).toBe(false)
    }
  })

  test('subcomando desconhecido mostra o uso', () => {
    expect(runRouteCommand('xyz', ctx()).text).toBe(USAGE)
  })
})

describe('set', () => {
  test('altera um nível sem mutar o contexto', () => {
    const c = ctx()
    const out = runRouteCommand('set Leve Haiku/Low', c)
    expect(out.config?.tiers.leve).toEqual({ model: 'haiku', effort: 'low' })
    expect(c.config.tiers.leve).toEqual({ model: 'haiku', effort: 'high' })
  })

  test('valores inválidos recusam com a lista aceita', () => {
    for (const args of ['set turbo haiku/low', 'set leve gpt/low', 'set leve', 'set leve haiku/low extra']) {
      const out = runRouteCommand(args, ctx())
      expect(out.config).toBe(undefined)
      expect(out.text).toContain('Uso: /route set')
      expect(out.text).toContain('fable')
    }
  })
})

describe('listas', () => {
  test('keywords add aceita expressão e recusa repetida', () => {
    expect(runRouteCommand('keywords add memory leak', ctx()).config?.heavyKeywords).toContain('memory leak')
    const again = runRouteCommand('keywords add Deadlock', ctx())
    expect(again.config).toBe(undefined)
    expect(again.text).toContain('já está')
  })

  test('keywords rm remove sem caixa nem acento', () => {
    expect(runRouteCommand('keywords rm SEGURANCA', ctx()).config?.heavyKeywords).not.toContain('segurança')
  })

  test('verbs e readonly', () => {
    expect(runRouteCommand('verbs add consertar', ctx()).config?.writeVerbs).toContain('consertar')
    expect(runRouteCommand('readonly add my-reviewer', ctx()).config?.readOnlyAgents).toContain('my-reviewer')
  })

  test('uso errado das listas', () => {
    expect(runRouteCommand('keywords drop x', ctx()).text).toContain('Uso: /route keywords add|rm')
    expect(runRouteCommand('verbs add', ctx()).config).toBe(undefined)
  })
})

describe('classificador', () => {
  test('on/off', () => {
    expect(runRouteCommand('classifier off', ctx()).config?.classifier.enabled).toBe(false)
    expect(runRouteCommand('classifier on', ctx()).config?.classifier.enabled).toBe(true)
    expect(runRouteCommand('classifier talvez', ctx()).config).toBe(undefined)
  })
})

describe('modos', () => {
  test('force, eco, boost e reset', () => {
    expect(runRouteCommand('force pesado', ctx()).mode).toEqual({ force: 'pesado' })
    expect(runRouteCommand('force max', ctx()).mode).toEqual({ force: 'maximo' })
    expect(runRouteCommand('eco', ctx()).mode).toBe('eco')
    expect(runRouteCommand('boost', ctx()).mode).toBe('boost')
    const reset = runRouteCommand('reset', ctx())
    expect('mode' in reset && reset.mode === null).toBe(true)
  })

  test('force sem nível válido não muda o modo', () => {
    const out = runRouteCommand('force', ctx())
    expect('mode' in out).toBe(false)
    expect(out.text).toContain('Uso: /route force')
  })
})

describe('stats e defaults', () => {
  test('stats mostra a tabela; stats reset pede para zerar', () => {
    expect(runRouteCommand('stats', ctx()).text).toContain('fora da tabela')
    expect(runRouteCommand('stats reset', ctx()).isResettingStats).toBe(true)
  })

  test('defaults restaura a config padrão', () => {
    const c = ctx()
    c.config.tiers.leve = { model: 'sonnet', effort: 'low' }
    expect(runRouteCommand('defaults', c).config).toEqual(DEFAULT_CONFIG)
  })
})
