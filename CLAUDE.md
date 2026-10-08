# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## O que é

Mods do Claude Code: plugins de *function hooks* em TypeScript, um por pasta (`subagent-routing/`, `usage-band/`, `cassino/`). A raiz é também um marketplace local (`.claude-plugin/marketplace.json`, uma entrada por mod com `source` relativo). Textos que o usuário vê (toasts, comandos, faixas) são em português.

## Comandos

Rodados da raiz do repo, um mod por vez:

```
claude plugin test <mod>        # roda todos os *.test.ts(x) da pasta; não há filtro por teste
claude plugin validate <mod>    # manifesto, hooks, chamadas em $, contrato de $.state
claude plugin validate .        # o marketplace e os três manifestos
npx tsc -p <mod>                # tipos; precisa de <mod>/.claude-plugin/types/
```

`<mod>/.claude-plugin/types/` (API, ferramentas, tsconfig base) é escrito pelo próprio Claude Code toda vez que carrega o mod, e é gitignored. Num clone em que o mod nunca carregou, o `tsc` falha até isso acontecer.

## Como os mods carregam

- `~/.claude/settings.json` define `CLAUDE_CODE_PLUGIN_DIRS=~/.claude/mods/usage-band:~/.claude/mods/cassino:~/.claude/mods/subagent-routing`, e essas pastas são links simbólicos para este repo. Editar aqui vale em toda sessão nova, e uma sessão aberta recarrega sozinha ao salvar. Um mod novo entra criando o link em `~/.claude/mods/` e acrescentando o caminho à variável.
- Para desenvolver com hot reload numa sessão sem mexer no `settings.json`, também serve um link em `~/.claude/dev-mods/<sessão>/` (o skill `plugin-authoring` explica). Não deixe o mesmo mod nos dois lugares ao mesmo tempo, ou ele carrega duas vezes.
- Os tipos e a referência da API vêm do skill `plugin-authoring`. Carregue-o antes de mexer em qualquer mod: a API é *early access* e muda entre versões. O arquivo de tipos da versão em uso é a autoridade.

## Anatomia de um mod

- `.claude-plugin/plugin.json`: `name`, `version`, `description` e, se o mod guarda valores em `$.state`, `"types": "./types/index.d.ts"`.
- `types/index.d.ts`: o contrato de `$.state`, um `declare module 'claude-code' { interface PluginState { '<mod>': {...} } }`. Toda chave lida ou escrita precisa estar ali, e as refs de `atom(...)` são literais no código (`{ plugin: '<mod>', key: '...' } as const`).
- `hooks/hooks.json` aponta um único módulo (`register.ts` ou `.tsx`), que exporta `register(on)`. Cada hook é `($, e, next)`; `next(e)` continua a cadeia, e `next({ ...e, x })` reescreve o evento.
- `$.state` é da sessão e sobrevive a hot reload; `$.store` persiste entre sessões; variáveis do módulo zeram a cada reload.

## Restrições do motor que já custaram tempo

- **`$` não atravessa import.** Uma função que recebe `$` precisa estar declarada no próprio módulo de hooks; o motor recusa carregar se `$` for passado a uma função importada. Por isso a lógica pura fica em arquivos irmãos (`tiers.ts`, `tags.ts`, `command.ts`... no `subagent-routing`) e a parte que chama `$` fica no `register`.
- O ambiente não tem Node nem DOM. Proibidos `require`, `import()` dinâmico e `structuredClone`; só `import` estático de `'claude-code'` e de arquivos do próprio plugin.
- Hooks que podem recusar algo (`tool.call`, `prompt.submit`...) sem `.catch` deixam passar quando falham. Um `.catch(($, e, next) => next(e))` torna isso explícito: o `next(e)` repassa a chamada intacta (ou repete o resultado, se o hook já tinha chamado `next`), e um erro do mod nunca bloqueia nada. É o padrão do `tool.call` do `subagent-routing`.
- `turn.complete` e `turn.step` sem `agentId` são do loop principal; com `agentId`, de um subagente.

## Testes (`claude-code/testing`)

- O `on` do teste registra hooks **abaixo** do plugin: eles fazem o papel do motor. Para ver o que o mod mandou adiante, responda o evento no fundo e guarde o `e` (ex.: `on('tool.call', { tool: 'Agent' }, ...)`).
- Chamadas em `$` (`ui.toast`, `model.complete`, `process.run`, `agent.list`, `command.register`...) são respondidas no fundo com `{ value: ... }`; sem isso, o hook do teste é ignorado.
- `mock.store(on)` e `mock.clock(on, { now })` simulam `$.store` e o relógio (`clock.advance(ms)` dispara os `$.clock.after/every`). O `$` do teste não tem `$.store`: confira o que foi gravado por um comando do mod ou por outro evento.
- Entradas completas para `$.prompt.submit`, `$.turn.complete`, `$.command.run` etc. seguem os tipos; os testes existentes mostram os campos mínimos.

## Por mod

- **subagent-routing**: reescreve `model`/`effort` de toda chamada `Agent`. A decisão é pura, em `hooks/tiers.ts` (`decide`): tag do prompt → `/route force` → escolha do modelo principal → classificador Haiku; depois eco/boost e os limites fixos (edição ⇒ ≥ medio; palavra pesada ⇒ ≥ pesado, ou ≥ medio em agente somente leitura). A tag vale até o `turn.complete` do loop principal. Spec e plano em `docs/superpowers/` explicam cada regra; mude a spec junto quando mudar comportamento.
- **usage-band**: um `ui.render` em `AbovePrompt` desenha duas linhas (rodada à esquerda, modelo e contexto à direita; janelas de uso à esquerda, git à direita) e os avisos a partir de 70% a partir de atoms em `$.state`, alimentados por `turn.step`, `session.measure`, `tool.call` e um `$.clock.every(1000)`. As funções de formatação e previsão são exportadas e testadas direto; o desenho é testado com `$.ui.mount` em `terminal` e `desktop`.
- **cassino**: toca sons chamando um player do sistema via `$.process.run` (`pw-play` → `paplay` → `aplay` → `afplay`; por último `$.audio.play`), sempre fora do dispatch (`$.clock.after`). O jackpot espera os subagentes terminarem (`$.agent.list`). Os `.wav` são gerados por `tools/gerar-sons.py`: mude o script e rode `python3 tools/gerar-sons.py`, em vez de editar os arquivos de som. `/cassino` alterna o mudo, guardado em `$.store`.
