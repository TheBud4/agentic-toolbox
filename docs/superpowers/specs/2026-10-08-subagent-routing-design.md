# subagent-routing — design

Data: 2026-10-08 · Status: aguardando revisão

## Objetivo

O usuário trabalha com Sonnet (effort high) na sessão principal e delega
tarefas a subagentes. O mod `subagent-routing`:

1. **roteia** cada delegação para um modelo/effort adequado à dificuldade —
   difícil vai para modelo mais inteligente, simples para modelo mais econômico;
2. **incentiva** a sessão principal a delegar de forma moderada, atuando como
   coordenadora.

Sucesso: tarefa difícil nunca cai em modelo fraco; tarefa trivial não gasta
Opus; o usuário enxerga e controla cada decisão.

Fora do escopo (por ora): revisão automática do trabalho de subagentes por um
modelo mais forte; regras por projeto; painel lateral com histórico.

## Níveis

| Nível    | Modelo / effort padrão | Quem pode escolher                          |
|----------|------------------------|---------------------------------------------|
| `leve`   | haiku / high           | Sonnet principal ou classificador           |
| `medio`  | sonnet / high          | Sonnet principal ou classificador           |
| `pesado` | opus / high            | Sonnet, classificador ou limite fixo        |
| `maximo` | opus / max             | **só** o Sonnet explicitamente, ou o usuário |

O classificador nunca devolve `maximo`. Modelo/effort de cada nível é
configurável via `/route set`.

## Arquitetura

Abordagem: **interceptar e reescrever**. O mod não cria tipos de agente; ele
reescreve `model` e `effort` de toda chamada da ferramenta `Agent`, qualquer que
seja o `subagent_type` (Explore, general-purpose, feature-dev:*, auditor…).

### Repositório

```
~/www/claude-mods/                    repo git geral de mods (marketplace local)
  .claude-plugin/marketplace.json     lista os mods; entrada "source": "./subagent-routing"
  docs/superpowers/specs/             specs
  subagent-routing/
    .claude-plugin/plugin.json        name, version, description, "types": "./types/index.d.ts"
    hooks/hooks.json                  { "modules": ["./register.ts"] }
    hooks/register.ts                ligação dos eventos
    hooks/tiers.ts                    lógica pura de decisão
    hooks/policy.ts                   texto injetado no system prompt
    hooks/classify.ts                 classificador Haiku
    hooks/stats.ts                    contagem de delegações e textos de toast/status
    hooks/tags.ts                     extração das tags do prompt
    hooks/command.ts                  subcomandos do /route (puro)
    hooks/*.test.ts                   testes
    types/index.d.ts                  contrato de $.state
```

### Unidades

| Unidade        | Responsabilidade                                                                                                  | Depende de          |
|----------------|-------------------------------------------------------------------------------------------------------------------|---------------------|
| `tiers.ts`     | Config padrão, merge/validação de config, precedência das fontes, eco/boost, limites fixos, nível → model/effort, model/effort → nível, detecção de edição | nada (puro)         |
| `policy.ts`    | Gera a seção do system prompt a partir da config                                                                  | `tiers.ts`          |
| `classify.ts`  | `$.model.complete({ model: "haiku", effort: "low", timeoutMs })` → `leve`/`medio`/`pesado` ou falha                | `$.model`           |
| `stats.ts`     | Contadores por nível e por fonte, textos de toast/status/estatísticas (puro; `register.ts` grava em `$.state`/`$.store`) | `tiers.ts`          |
| `tags.ts`      | Extrai e remove `#leve`/`#medio`/`#pesado`/`#max` do texto do prompt                                              | `tiers.ts`          |
| `command.ts`   | Interpreta os argumentos do `/route` e devolve texto + mudanças de config/modo/stats (puro)                       | `tiers.ts`, `stats.ts` |
| `register.ts` | Registra hooks e comando; sem lógica própria além de orquestrar                                                    | todos               |

### Eventos

| Evento           | Ação                                                                                                   |
|------------------|--------------------------------------------------------------------------------------------------------|
| `session.start`  | registra o comando `/route`                                                                             |
| `prompt.compose` | acrescenta por último a seção `subagent-routing:policy` (`scope: 'session'`)                            |
| `prompt.submit`  | extrai `#leve`/`#medio`/`#pesado`/`#max` do texto, grava em `turnTag`, repassa o texto sem a tag; sem tag, limpa `turnTag` |
| `tool.call` (`Agent`) | decide o nível e chama `next({ ...e, model, effort })`; toast, status e stats                     |
| `command.run` (`route`) | subcomandos do `/route`                                                                          |

## Fluxo de uma delegação

Entrada: o evento `tool.call` da ferramenta `Agent` (`e.subagent_type`,
`e.description`, `e.prompt`, `e.model?`, `e.effort?`).

0. **Fork** — `subagent_type === "fork"`: passa intacto (fork sempre usa o
   modelo da sessão). Toast `fork · sem roteamento`; conta em stats.
1. **Nível base** — primeira fonte presente:
   1. `turnTag` (tag do usuário no turno) → **final**, pula 2 e 3;
   2. modo `force:<nível>` da sessão → **final**, pula 2 e 3;
   3. escolha do Sonnet, lida de `e.model`/`e.effort`:
      `haiku`→leve, `sonnet`→medio, `opus` com effort `max`/`xhigh`→maximo,
      outro `opus`→pesado. Qualquer outro modelo (ex.: `fable`) → **fora da
      tabela**: a chamada passa como o Sonnet pediu, sem 2 e 3, contada como
      "fora da tabela";
   4. classificador Haiku (só quando `e.model` está ausente).
2. **eco/boost** (só fontes 3 e 4): `eco` desce um nível (piso `leve`);
   `boost` sobe um nível (teto `pesado`; nunca alcança `maximo`). `eco` sobre
   `maximo` dá `pesado`.
3. **Limites fixos** (só fontes 3 e 4, depois de eco/boost):
   - **edita arquivos ⇒ mínimo `medio`**. Não edita se `subagent_type` está na
     lista de agentes somente leitura; caso contrário, edita se o prompt ou a
     descrição contém um verbo de escrita (match por palavra, sem
     maiúsculas/acentos). Tipo desconhecido segue a regra dos verbos.
   - **palavra pesada ⇒ mínimo `pesado`** (match por palavra/expressão no prompt
     e na descrição). Para agentes somente leitura o mínimo é `medio`: eles só
     leem, e o texto de uma busca menciona "migration" ou "debug" sem que a
     busca seja difícil (ajuste da revisão final).
   - Limites só elevam; nunca rebaixam (não afetam `maximo`).
4. **Aplicar** — `next({ ...e, model, effort })` com os valores da config para o
   nível final.
5. **Retorno** — toast `→ <model>/<effort> · "<description>" · <motivo>`
   (motivo: `tag`, `force`, `sonnet`, `classificador`, `limite: edita arquivos`,
   `limite: "<palavra>"`, `eco`, `boost`); status
   `rota: <modo se houver> · última <model>/<effort>`; stats.

Exemplos:
- Sonnet delega "achar onde o token é validado" a `Explore` com haiku → leve,
  haiku/high.
- Sonnet delega "corrigir o deadlock no worker" a `general-purpose` com sonnet →
  limite de edição satisfeito (medio); "deadlock" força pesado → opus/high.
- Usuário escreve `#leve` e o Sonnet delega uma edição → leve (tag ignora limites).

## Política injetada (rascunho)

Seção `subagent-routing:policy`, gerada de `policy.ts` com os valores atuais:

> **Delegação de trabalho.** Você coordena; subagentes executam. Delegue a um
> subagente toda tarefa que exija mais de ~3 chamadas de ferramenta ou leitura de
> vários arquivos. Faça você mesmo o que for rápido: uma edição pontual, um grep,
> ler um arquivo que já está em discussão.
>
> Ao chamar `Agent`, sempre informe `model` e `effort` conforme o nível da tarefa
> (esta instrução é a autorização explícita para definir `effort`):
>
> - leve (busca, leitura, resumo, rodar e relatar) → `haiku`, `high`
> - medio (implementação especificada, testes, refatoração local, bug de causa conhecida) → `sonnet`, `high`
> - pesado (arquitetura, debug de causa desconhecida, concorrência, segurança, planos, revisão crítica) → `opus`, `high`
> - maximo (só para problemas excepcionalmente difíceis, quando pesado não basta) → `opus`, `max`
>
> Prefira subagentes novos com prompt autocontido; use `fork` só quando o
> contexto desta conversa for indispensável (fork não é roteado). Um hook pode
> ajustar sua escolha; isso é esperado.

## Classificador

`$.model.complete({ model: "haiku", effort: "low", timeoutMs: <config> })` com
prompt fixo descrevendo os três níveis e pedindo **uma palavra**:
`leve`, `medio` ou `pesado`. Entrada: `subagent_type`, `description` e os
primeiros ~2000 caracteres de `prompt`. Resposta normalizada (minúsculas, sem
acento, primeira palavra); qualquer outra coisa, `!isAnswered` ou timeout →
falha → nível de reserva (`medio`), motivo `classificador falhou`.

## Configuração e estado

### Config (`$.store`, chave `config`) — global, persiste entre sessões

As listas abaixo são o conteúdo inicial; ampliáveis via `/route`.

```
tiers:
  leve:   { model: haiku,  effort: high }
  medio:  { model: sonnet, effort: high }
  pesado: { model: opus,   effort: high }
  maximo: { model: opus,   effort: max }
heavyKeywords: debug, depurar, arquitetura, architecture, race, race condition,
  concorrência, concurrency, segurança, security, vulnerabilidade,
  vulnerability, deadlock, migração, migration
writeVerbs: implementar, implemente, editar, edite, corrigir, corrija,
  refatorar, refatore, criar, crie, escrever, escreva, implement, edit, fix,
  refactor, write, create
readOnlyAgents: Explore, Plan, auditor, claude-code-guide,
  feature-dev:code-explorer, feature-dev:code-reviewer,
  feature-dev:code-architect, hookify:conversation-analyzer
classifier: { enabled: true, timeoutMs: 4000, fallback: medio }
```

Leitura: o valor salvo é mesclado sobre o padrão. Campos ausentes usam o padrão
em silêncio (permite acrescentar campos em versões futuras); campos inválidos usam
o padrão e geram um aviso (uma vez por carga do mod).

Modelos aceitos: `haiku`, `sonnet`, `opus`, `fable`. Efforts aceitos: `low`,
`medium`, `high`, `xhigh`, `max`.

### Estado da sessão (`$.state`, contrato em `types/index.d.ts`)

| Chave          | Valor                                                    |
|----------------|----------------------------------------------------------|
| `mode`         | `null` \| `{ force: Tier }` \| `"eco"` \| `"boost"`       |
| `turnTag`      | `Tier \| null`                                           |
| `lastRoute`    | `{ model, effort, tier, reason, description } \| null`   |
| `sessionStats` | contagens por nível, por fonte, `fork` e `foraDaTabela`   |

Estatísticas acumuladas: `$.store`, chave `stats`, mesma forma.

O modo é só da sessão de propósito: um `eco` esquecido não pode rebaixar
sessões futuras sem o usuário perceber.

### Comando `/route`

| Comando                                   | Efeito                                                     |
|-------------------------------------------|------------------------------------------------------------|
| `/route` ou `/route show`                 | config, modo ativo, resumo de stats                         |
| `/route set <nível> <model>/<effort>`     | altera um nível (validado)                                  |
| `/route keywords add\|rm <palavra>`       | edita `heavyKeywords`                                       |
| `/route verbs add\|rm <verbo>`            | edita `writeVerbs`                                          |
| `/route readonly add\|rm <agente>`        | edita `readOnlyAgents`                                      |
| `/route classifier on\|off`               | liga/desliga o classificador (desligado: reserva direto)    |
| `/route force <nível>`                    | modo forçado na sessão                                      |
| `/route eco` · `/route boost`             | modo eco/boost na sessão                                    |
| `/route reset`                            | limpa o modo                                                |
| `/route stats` · `/route stats reset`     | por nível e por fonte, sessão e acumulado; zera             |
| `/route defaults`                         | restaura a config padrão                                    |

## Tags no prompt

`#leve`, `#medio` (também `#médio`), `#pesado`, `#max` (também `#maximo`).
Reconhecidas como palavra isolada, removidas do texto antes de chegar ao modelo.
Várias tags: vale a última, com toast de aviso. A tag vale para todas as
delegações do turno e é limpa quando o turno principal termina
(`turn.complete` sem `agentId`). Só prompts da pessoa (origem `composer`,
`bridge` ou `sdk`, sem `/` no início) definem tag; um prompt sem tag não mexe na
tag do turno em curso, e uma tag digitada no meio de um turno entra nele.
Remover a tag não altera o resto do texto (indentação de código preservada).

## Erros

Princípio: **o mod nunca impede uma delegação.**

| Situação                                         | Comportamento                                                   |
|--------------------------------------------------|-----------------------------------------------------------------|
| Exceção no hook de `tool.call`                    | `.catch` repassa `next(e)` intacto; toast `subagent-routing: erro, seguiu sem roteamento` |
| Classificador falha/timeout/resposta inválida     | reserva (`medio`), toast indica                                  |
| Sonnet omite `model`                              | classificador                                                    |
| Modelo fora da tabela                             | passa como pedido; stats "fora da tabela"                        |
| `subagent_type` desconhecido                      | tratado como possível editor (regra dos verbos)                  |
| `/route set` inválido                             | recusa listando valores aceitos                                  |
| Config corrompida                                 | merge com padrão, aviso uma vez                                  |
| Effort não suportado pelo modelo                  | o motor descarta; nada a fazer                                   |

## Testes

1. **Unitários de `tiers.ts`** (tabela de casos): precedência das fontes;
   eco/boost nas bordas; limites (edição, palavra pesada, ordem eco→limite);
   tag/force ignorando limites; detecção de edição (somente leitura, verbos
   PT/EN, tipo desconhecido); model/effort ↔ nível (opus/max = maximo, fable =
   fora da tabela); validação de `set`; merge de config corrompida.
2. **Hooks via `claude plugin test`**: Agent sai com model/effort reescritos;
   fork intacto; tag removida do prompt; classificador falhando → medio; exceção
   interna → passa intacto; subcomandos do `/route` mudam estado/config.
3. **Estático**: `claude plugin validate subagent-routing` e `tsc -p subagent-routing`.
4. **Verificação real** nesta sessão com hot reload: delegações de teste (busca,
   edição, "debug de deadlock", `#max`, `/route eco`) conferindo toast, status e
   `/route stats`.

## Desenvolvimento e instalação

- **Desenvolvimento**: link simbólico da pasta de mods de desenvolvimento da
  sessão (`~/.claude/dev-mods/<sessão>/subagent-routing`) para
  `~/www/claude-mods/subagent-routing`, com hot reload — o motor observa a pasta
  para a qual o link aponta.
- **Uso permanente**: `claude plugin marketplace add ~/www/claude-mods` e
  `claude plugin install subagent-routing@claude-mods` (escopo usuário). Como a
  entrada do marketplace é caminho relativo, o plugin é lido da própria pasta:
  editar e rodar `/reload-plugins`. Não instalar enquanto o link de
  desenvolvimento estiver ativo, para não carregar duas vezes.
