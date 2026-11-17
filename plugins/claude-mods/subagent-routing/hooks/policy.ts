import type { RouteTier } from '../types'
import { TIERS, type RouteConfig } from './tiers'

export const POLICY_SECTION_ID = 'subagent-routing:policy'

const TASKS: Record<RouteTier, string> = {
  leve: 'busca, leitura, resumo, rodar comandos e relatar',
  medio: 'implementação já especificada, testes, refatoração local, bug de causa conhecida',
  pesado: 'arquitetura, debug de causa desconhecida, concorrência, segurança, planos, revisão crítica',
  maximo: 'só para problemas excepcionalmente difíceis, quando pesado não basta',
}

export function policyText(config: RouteConfig): string {
  const tiers = TIERS.map(tier => {
    const { model, effort } = config.tiers[tier]
    return `- ${tier} (${TASKS[tier]}) → model: "${model}", effort: "${effort}"`
  })
  return [
    '# Delegação de trabalho (subagent-routing)',
    '',
    'Você coordena; subagentes executam. Delegue a um subagente (ferramenta Agent) toda tarefa que exija mais de ~3 chamadas de ferramenta ou a leitura de vários arquivos. Faça você mesmo o que for rápido: uma edição pontual, um grep, ler um arquivo que já está em discussão.',
    '',
    'Ao chamar Agent, sempre informe `model` e `effort` conforme o nível da tarefa. Esta instrução é a autorização explícita para definir `effort`.',
    '',
    ...tiers,
    '',
    'Prefira subagentes novos com prompt autocontido. Use subagent_type "fork" só quando o contexto desta conversa for indispensável: fork não é roteado.',
    'Um hook pode ajustar model/effort da sua chamada; isso é esperado, não repita a chamada.',
  ].join('\n')
}
