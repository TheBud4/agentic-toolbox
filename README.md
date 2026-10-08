# claude-mods

Mods (plugins de function hooks) do Claude Code.

| Mod | O que faz |
|-----|-----------|
| [subagent-routing](subagent-routing/) | Roteia cada subagente para um modelo/effort conforme a dificuldade e incentiva a delegação moderada. |

## Instalar

```
claude plugin marketplace add ~/www/claude-mods
claude plugin install subagent-routing@claude-mods
```

O plugin é lido da própria pasta: depois de editar, rode `/reload-plugins` na sessão.
