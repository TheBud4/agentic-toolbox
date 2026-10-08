import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type Seen = Record<string, unknown>

/** Fundo da cadeia de tool.call: guarda o que chegou ao "motor" depois do mod. */
function captureAgent(on: On): Seen[] {
  const seen: Seen[] = []
  on('tool.call', { tool: 'Agent' }, ($, e) => {
    seen.push(e as unknown as Seen)
    return { result: { status: 'completed' } as never }
  })
  return seen
}

function captureToasts(on: On): string[] {
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return toasts
}

function agent(fields: Record<string, unknown>) {
  return { tool: 'Agent' as const, tool_use_id: 't1', description: 'tarefa', prompt: 'olhar o código', ...fields } as never
}

function classifierSays(on: On, text: string) {
  on('model.complete', () => ({ value: { isAnswered: true as const, text, usage: USAGE } }))
}

function turnEnd(fields: Record<string, unknown>) {
  return { answer: '', durationMs: 1, isAborted: false, turnId: 'turn-1', reason: 'answer', ...fields } as never
}

function routeCommand(args: string) {
  return { command: 'route', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } } as never
}

describe('tool.call de Agent', () => {
  test('Sonnet escolhe haiku para Explore: haiku/high e toast', async ($, on) => {
    mock.store(on)
    const seen = captureAgent(on)
    const toasts = captureToasts(on)
    await $.tool.call(agent({ subagent_type: 'Explore', description: 'achar token', model: 'haiku' }))
    expect(seen[0]).toMatchObject({ model: 'haiku', effort: 'high' })
    expect(toasts).toContain('→ haiku/high · "achar token" · sonnet')
  })

  test('palavra pesada eleva a opus/high', async ($, on) => {
    mock.store(on)
    const seen = captureAgent(on)
    await $.tool.call(agent({ prompt: 'corrigir o deadlock no worker', model: 'sonnet' }))
    expect(seen[0]).toMatchObject({ model: 'opus', effort: 'high' })
  })

  test('sem model: o classificador decide', async ($, on) => {
    mock.store(on)
    classifierSays(on, 'pesado')
    const seen = captureAgent(on)
    await $.tool.call(agent({}))
    expect(seen[0]).toMatchObject({ model: 'opus', effort: 'high' })
  })

  test('classificador com resposta inválida: reserva medio', async ($, on) => {
    mock.store(on)
    classifierSays(on, 'não sei')
    const seen = captureAgent(on)
    await $.tool.call(agent({}))
    expect(seen[0]).toMatchObject({ model: 'sonnet', effort: 'high' })
  })

  test('fork passa intacto', async ($, on) => {
    mock.store(on)
    const seen = captureAgent(on)
    await $.tool.call(agent({ subagent_type: 'fork' }))
    expect(seen[0]?.model).toBe(undefined)
    expect(seen[0]?.effort).toBe(undefined)
  })

  test('erro interno: a chamada segue intacta', async ($, on) => {
    mock.store(on)
    const seen = captureAgent(on)
    const toasts = captureToasts(on)
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'opus', description: undefined }))
    expect(seen[0]?.model).toBe('opus')
    expect(seen[0]?.effort).toBe(undefined)
    expect(toasts).toContain('subagent-routing: erro, seguiu sem roteamento')
  })

  test('estatísticas acumuladas vão para o store', async ($, on) => {
    mock.store(on)
    captureAgent(on)
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'haiku' }))
    const out = await $.command.run(routeCommand('stats'))
    // linha "leve": 1 na sessão (estado) e 1 no total (store)
    expect(out.text).toContain(`${'leve'.padEnd(16)}${'1'.padStart(8)}${'1'.padStart(8)}`)
  })
})

describe('prompt.submit', () => {
  test('tag força o nível do turno e some do texto', async ($, on) => {
    mock.store(on)
    let submitted = ''
    on('prompt.submit', ($, e) => {
      submitted = e.text
      return { text: e.text }
    })
    const seen = captureAgent(on)
    await $.prompt.submit({ text: 'olha isso #pesado', origin: { kind: 'composer' }, wait: false } as never)
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'haiku' }))
    expect(submitted).toBe('olha isso')
    expect(seen[0]).toMatchObject({ model: 'opus', effort: 'high' })
  })

  test('o fim do turno principal limpa a tag', async ($, on) => {
    mock.store(on)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('turn.complete', () => ({ text: '' }))
    const seen = captureAgent(on)
    await $.prompt.submit({ text: 'a #pesado', origin: { kind: 'composer' }, wait: false } as never)
    await $.turn.complete(turnEnd({}))
    await $.prompt.submit({ text: 'b', origin: { kind: 'composer' }, wait: false } as never)
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'haiku' }))
    expect(seen[0]).toMatchObject({ model: 'haiku' })
  })

  test('tag não vaza para um turno seguinte que a pessoa não digitou', async ($, on) => {
    mock.store(on)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('turn.complete', () => ({ text: '' }))
    const seen = captureAgent(on)
    await $.prompt.submit({ text: 'resume isso #leve', origin: { kind: 'composer' }, wait: false } as never)
    await $.turn.complete(turnEnd({}))
    await $.prompt.submit({ text: 'agente terminou', origin: { kind: 'task-notification' }, wait: false } as never)
    await $.tool.call(agent({ model: 'haiku', prompt: 'corrigir o deadlock no worker' }))
    expect(seen[0]).toMatchObject({ model: 'opus', effort: 'high' })
  })

  test('o fim do turno de um subagente não limpa a tag', async ($, on) => {
    mock.store(on)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('turn.complete', () => ({ text: '' }))
    const seen = captureAgent(on)
    await $.prompt.submit({ text: 'a #pesado', origin: { kind: 'composer' }, wait: false } as never)
    await $.turn.complete(turnEnd({ agentId: 'sub-1' }))
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'haiku' }))
    expect(seen[0]).toMatchObject({ model: 'opus' })
  })

  test('prompt sem tag digitado no meio do turno não limpa a tag', async ($, on) => {
    mock.store(on)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    const seen = captureAgent(on)
    await $.prompt.submit({ text: 'a #pesado', origin: { kind: 'composer' }, wait: false } as never)
    await $.prompt.submit({ text: 'e mais isso', origin: { kind: 'composer' }, wait: false, turnId: 't1' } as never)
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'haiku' }))
    expect(seen[0]).toMatchObject({ model: 'opus' })
  })

  test('origem que não é a pessoa não define nem remove tag', async ($, on) => {
    mock.store(on)
    let submitted = ''
    on('prompt.submit', ($, e) => {
      submitted = e.text
      return { text: e.text }
    })
    const seen = captureAgent(on)
    await $.prompt.submit({ text: 'agente terminou #max', origin: { kind: 'task-notification' }, wait: false } as never)
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'haiku' }))
    expect(submitted).toBe('agente terminou #max')
    expect(seen[0]).toMatchObject({ model: 'haiku' })
  })
})

describe('prompt.compose', () => {
  const COMPOSE = {
    model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: ['terminal'],
    outputStyle: null, traits: [],
  }

  test('injeta a política quando a requisição oferece Agent', async ($, on) => {
    mock.store(on)
    on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'base', scope: 'shared' as const }] }))
    const result = await $.prompt.compose({ ...COMPOSE, tools: ['Agent', 'Read'] } as never)
    expect(result.sections.map(s => s.id)).toEqual(['base', 'subagent-routing:policy'])
  })

  test('não injeta sem a ferramenta Agent', async ($, on) => {
    mock.store(on)
    on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'base', scope: 'shared' as const }] }))
    const result = await $.prompt.compose({ ...COMPOSE, tools: ['Read'] } as never)
    expect(result.sections.map(s => s.id)).toEqual(['base'])
  })
})

describe('/route', () => {
  test('eco rebaixa a escolha do Sonnet', async ($, on) => {
    mock.store(on)
    const seen = captureAgent(on)
    const out = await $.command.run(routeCommand('eco'))
    expect(out.text).toContain('Modo eco')
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'sonnet' }))
    expect(seen[0]).toMatchObject({ model: 'haiku', effort: 'high' })
  })

  test('set grava a config e vale na próxima delegação', async ($, on) => {
    mock.store(on)
    const seen = captureAgent(on)
    await $.command.run(routeCommand('set leve haiku/low'))
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'haiku' }))
    expect(seen[0]).toMatchObject({ model: 'haiku', effort: 'low' })
  })

  test('config inválida no store: usa o padrão e avisa uma vez', async ($, on) => {
    mock.store(on, { config: { tiers: { leve: { model: 'gpt', effort: 'x' } } } })
    const toasts = captureToasts(on)
    const seen = captureAgent(on)
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'haiku' }))
    expect(seen[0]).toMatchObject({ model: 'haiku', effort: 'high' })
    expect(toasts.filter(t => t.includes('configuração com campos inválidos'))).toHaveLength(1)
  })
})
