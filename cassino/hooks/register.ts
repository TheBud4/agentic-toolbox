import type { EngineInterface, Register } from 'claude-code'

const ROLETA = 'sounds/roleta.wav'
const JACKPOT = 'sounds/jackpot.wav'
const NOTIFICACAO = 'sounds/notificacao.wav'
const ROLETA_MS = 3700
const MUTED_KEY = 'muted'
/** Intervalo mínimo entre dois sons de notificação (um pedido pode chegar por dois caminhos). */
const NOTIFY_GAP_MS = 3000

/** Status de agente que ainda conta como trabalho em andamento. */
export const BUSY: readonly string[] = ['pending', 'running', 'waiting']
/** Ferramentas que param tudo esperando uma resposta sua. */
export const ASKS: readonly string[] = ['AskUserQuestion', 'ExitPlanMode']
/** Notificações que não pedem nada (o lembrete de ocioso, login concluído). */
export const QUIET_NOTIFICATIONS: readonly string[] = ['idle_prompt', 'auth_success']

/** Players tentados em ordem; o primeiro que funciona fica guardado. */
export const PLAYERS: readonly (readonly string[])[] = [['pw-play'], ['paplay'], ['aplay', '-q'], ['afplay']]

// Estado do módulo: some num reload, o que só refaz a busca pelo player.
const sound = { player: null as readonly string[] | null, roletaEndsAt: 0, lastNotifyAt: -Infinity }

async function playFile($: EngineInterface, asset: string): Promise<void> {
  if ((await $.store.get(MUTED_KEY)) === true) return
  const path = `${$.plugin.root}/${asset}`
  const candidates = sound.player ? [sound.player] : PLAYERS
  for (const argv of candidates) {
    try {
      const r = await $.process.run([...argv, path], { timeoutMs: 15_000 })
      if (r.exitCode === 0) {
        sound.player = argv
        return
      }
    } catch {
      // Player ausente: tenta o próximo.
    }
  }
  // Nenhum player do sistema: deixa o engine tentar (toca no macOS).
  await $.audio.play({ asset }).catch(() => undefined)
}

/** Toca fora do dispatch, para o hook não esperar o som acabar. */
function play($: EngineInterface, asset: string, delayMs = 1): void {
  $.clock.after(Math.max(1, delayMs), () => void playFile($, asset))
}

async function notify($: EngineInterface): Promise<void> {
  const t = await $.clock.now()
  if (t - sound.lastNotifyAt < NOTIFY_GAP_MS) return
  sound.lastNotifyAt = t
  play($, NOTIFICACAO)
}

async function startRoleta($: EngineInterface): Promise<void> {
  sound.roletaEndsAt = (await $.clock.now()) + ROLETA_MS
  play($, ROLETA)
}

async function payJackpot($: EngineInterface): Promise<void> {
  const agents = await $.agent.list()
  if (agents.some(a => BUSY.includes(a.status))) return
  // Deixa a roleta parar antes do jackpot numa resposta rápida.
  play($, JACKPOT, sound.roletaEndsAt - (await $.clock.now()))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cassino',
      description: 'Liga/desliga os sons do cassino (roleta, jackpot e notificação)',
    })
    return next(e)
  })

  on('command.run', { command: 'cassino' }, async $ => {
    const muted = (await $.store.get(MUTED_KEY)) !== true
    await $.store.set(MUTED_KEY, muted)
    return { text: muted ? '🔇 Sons do cassino desligados.' : '🎰 Sons do cassino ligados.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    if (e.origin.kind === 'composer' && !e.text.trimStart().startsWith('/cassino')) {
      await startRoleta($).catch(() => undefined)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // Só quando tudo acabou: com um subagente ainda rodando, o Claude fica
    // ocioso esperando e ganha outra rodada quando ele termina; o jackpot fica
    // para o fim dessa.
    if (!e.agentId && e.reason === 'answer') await payJackpot($).catch(() => undefined)
    return result
  })

  // Pedido de permissão e outros diálogos que esperam você.
  on('classic.Notification', async ($, e, next) => {
    if (!QUIET_NOTIFICATIONS.includes(e.notification_type)) await notify($).catch(() => undefined)
    return next(e)
  })

  // Pergunta do Claude ou plano esperando aprovação.
  on('tool.call', async ($, e, next) => {
    if (ASKS.includes(String(e.tool))) await notify($).catch(() => undefined)
    return next(e)
  })
}
