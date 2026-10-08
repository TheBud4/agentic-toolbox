import type { EngineInterface } from 'claude-code'

import { normalize, type ClassTier, type DecideInput, type RouteConfig } from './tiers'

type TaskText = Pick<DecideInput, 'subagentType' | 'description' | 'prompt'>

export const CLASSIFIER_SYSTEM = [
  'Você classifica, por dificuldade, uma tarefa que será delegada a um subagente de programação.',
  'Responda com exatamente uma palavra: leve, medio ou pesado.',
  '- leve: buscar, ler, listar, resumir, rodar comandos e relatar; nenhuma decisão difícil.',
  '- medio: implementar algo já especificado, escrever testes, refatoração local, corrigir bug de causa conhecida.',
  '- pesado: arquitetura, design, debug de causa desconhecida, concorrência, segurança, planos, revisão crítica.',
].join('\n')

export function buildClassifierPrompt(input: TaskText): string {
  return [
    `Tipo de agente: ${input.subagentType ?? 'general-purpose'}`,
    `Descrição: ${input.description}`,
    'Tarefa:',
    input.prompt.slice(0, 2000),
  ].join('\n')
}

export function parseClassification(text: string): ClassTier | null {
  const word = normalize(text).replace(/^[^a-z]+/, '').match(/^[a-z]+/)?.[0]
  return word === 'leve' || word === 'medio' || word === 'pesado' ? word : null
}

/** Pergunta ao Haiku o nível da tarefa. Qualquer falha devolve `null`. */
export async function classify(
  $: Pick<EngineInterface, 'model'>,
  input: TaskText,
  config: RouteConfig,
): Promise<ClassTier | null> {
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
