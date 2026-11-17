import type { AgentInfo, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { PLAYERS } from '../hooks/register'

const DONE = { answer: 'feito', durationMs: 1000, isAborted: false } as const

/** O mundo abaixo do mod: relógio, store, player de som e lista de agentes. */
function world(on: On) {
  const clock = mock.clock(on, { now: 0 })
  mock.store(on)
  const played: string[] = []
  const agents: AgentInfo[] = []
  on('process.run', async (_$, e) => {
    played.push(String(e.argv[e.argv.length - 1]).split('/').pop() ?? '')
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('agent.list', async () => ({ value: agents }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('turn.complete', async () => ({ text: '' }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('tool.call', async () => ({ deny: 'só no teste' }))
  on('classic.Notification', async () => ({}))
  return { clock, played, agents }
}

test('tries PipeWire first and macOS last', async () => {
  expect(PLAYERS[0]).toEqual(['pw-play'])
  expect(PLAYERS[PLAYERS.length - 1]).toEqual(['afplay'])
})

test('spins on submit, pays the jackpot on answer, and /cassino mutes', async ($, on) => {
  const { clock, played } = world(on)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'oi', wait: false, origin: { kind: 'composer' } })
  await clock.advance(10)
  expect(played).toEqual(['roleta.wav'])

  await $.turn.complete({ turnId: 't1', reason: 'answer', ...DONE })
  await clock.advance(1000)
  expect(played).toEqual(['roleta.wav'])
  await clock.advance(5000)
  expect(played).toEqual(['roleta.wav', 'jackpot.wav'])

  await $.command.run({
    command: 'cassino',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })
  await $.prompt.submit({ text: 'de novo', wait: false, origin: { kind: 'composer' } })
  await clock.advance(10)
  expect(played).toEqual(['roleta.wav', 'jackpot.wav'])
})

test('holds the jackpot while a subagent still works', async ($, on) => {
  const { clock, played, agents } = world(on)
  agents.push({ id: 'a1', description: 'pesquisa', type: 'general-purpose', status: 'running' })

  // O Claude dispara o subagente em segundo plano e fica ocioso: nada de jackpot.
  await $.turn.complete({ turnId: 't1', reason: 'answer', ...DONE })
  await clock.advance(10_000)
  expect(played).toEqual([])

  // O subagente terminou e o Claude fechou a rodada com o resultado dele.
  agents[0] = { ...agents[0]!, status: 'completed' }
  await $.turn.complete({ turnId: 't2', reason: 'answer', ...DONE })
  await clock.advance(10)
  expect(played).toEqual(['jackpot.wav'])
})

test('a subagent finishing its own turn pays nothing', async ($, on) => {
  const { clock, played } = world(on)
  await $.turn.complete({ turnId: 't1', agentId: 'a1', reason: 'answer', ...DONE })
  await clock.advance(10_000)
  expect(played).toEqual([])
})

test('dings when something waits for an answer, once per request', async ($, on) => {
  const { clock, played } = world(on)

  await $.classic.Notification({ message: 'Claude needs your permission', notification_type: 'permission_prompt' })
  await clock.advance(10)
  expect(played).toEqual(['notificacao.wav'])

  // O lembrete de "ocioso" não pede nada.
  await clock.advance(5000)
  await $.classic.Notification({ message: 'Claude is waiting', notification_type: 'idle_prompt' })
  await clock.advance(10)
  expect(played).toEqual(['notificacao.wav'])

  // Uma pergunta que chega pela ferramenta e pela notificação toca uma vez só.
  await $.tool.call({ tool: 'AskUserQuestion', questions: [] }).catch(() => undefined)
  await $.classic.Notification({ message: 'Claude has a question', notification_type: 'elicitation_dialog' })
  await clock.advance(10)
  expect(played).toEqual(['notificacao.wav', 'notificacao.wav'])
})
