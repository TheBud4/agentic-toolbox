@AGENTS.md
@.harness/memory.md
@~/.harness/perfil.md
@.agents/rules/projeto.md

## Notas do Claude Code

- O hook `.harness/bin/guard.sh` bloqueia Edit/Write fora das exceções da regra 1. Se ele bloquear, não contorne pelo Bash: siga a regra 1.
- O hook `SessionStart` (`.harness/bin/carregar.sh`) já injeta `state.json`, `session.md` e as dívidas pendentes ao abrir, depois de `/clear` e depois de uma compactação.
- Os domínios de documentação oficial já estão liberados para WebFetch em `.claude/settings.json`.
