# claude-mods

Mods (plugins de function hooks) do Claude Code.

| Mod | O que faz |
|-----|-----------|
| [subagent-routing](subagent-routing/) | Roteia cada subagente para um modelo/effort conforme a dificuldade e incentiva a delegação moderada. |
| [usage-band](usage-band/) | Faixa compacta acima do prompt: git, modelo e avisos (a partir de 70%) em cima; medidores de contexto e das janelas de 5h/semanal embaixo, com previsão de esgotamento. |
| [cassino](cassino/) | Roleta quando o Claude começa a trabalhar, jackpot quando termina e um plim quando algo espera sua resposta. `/cassino` liga/desliga. |

## Instalar

```
claude plugin marketplace add ~/www/claude-mods
claude plugin install subagent-routing@claude-mods   # ou usage-band@claude-mods, cassino@claude-mods
```

O plugin é lido da própria pasta: depois de editar, rode `/reload-plugins` na sessão.
