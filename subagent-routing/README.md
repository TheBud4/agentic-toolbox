# subagent-routing

Roteia cada chamada de subagente (`Agent`) para um modelo/effort conforme a
dificuldade da tarefa, e orienta a sessão principal a delegar de forma moderada.

| Nível    | Padrão        | Para                                                         |
|----------|---------------|--------------------------------------------------------------|
| `leve`   | haiku / high  | busca, leitura, resumo, rodar e relatar                      |
| `medio`  | sonnet / high | implementação especificada, testes, refatoração local        |
| `pesado` | opus / high   | arquitetura, debug difícil, concorrência, segurança, planos  |
| `maximo` | opus / max    | só por escolha explícita do Sonnet, `#max` ou `/route force` |

Ordem de decisão: tag no prompt (`#leve`, `#medio`, `#pesado`, `#max`), depois
`/route force`, depois a escolha do Sonnet, depois o classificador Haiku.
Fora a tag e o force, valem `/route eco|boost` e os limites fixos: tarefa que
edita arquivos fica no mínimo em `medio`; palavra pesada (deadlock, segurança,
arquitetura...) fica no mínimo em `pesado` (em agentes somente leitura, como
`Explore`, no mínimo em `medio`). Uma tag vale só até o fim do turno. Forks não
são roteados.

## Instalar

```
claude plugin marketplace add ~/www/claude-mods
claude plugin install subagent-routing@claude-mods
```

## Comandos

`/route` mostra tudo; `/route help` lista os subcomandos (`set`, `keywords`,
`verbs`, `readonly`, `classifier`, `force`, `eco`, `boost`, `reset`, `stats`,
`defaults`).

## Desenvolver

```
claude plugin test subagent-routing
claude plugin validate subagent-routing
npx tsc -p subagent-routing   # precisa de .claude-plugin/types/, que o Claude Code escreve ao carregar o mod
```
