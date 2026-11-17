#!/usr/bin/env bash
# SessionStart: injeta no contexto onde paramos.
#   Claude Code: carregar.sh                (texto no stdout; roda ao abrir, após /clear e após compactação)
#   Antigravity: carregar.sh --antigravity  (JSON injectSteps; roda a cada conversa nova)
# No Antigravity também entram memory.md e o perfil, porque lá não há os imports do CLAUDE.md.
ag=0; [ "$1" = "--antigravity" ] && ag=1
if [ $ag = 1 ]; then
  root=$(jq -r '.workspacePaths[0] // empty' 2>/dev/null)
  root=${root:-$PWD}
else
  root="$CLAUDE_PROJECT_DIR"
fi
h="$root/.harness"

texto() {
  echo "## Contexto do harness (recarregado automaticamente)"
  arquivos="state.json session.md"
  [ $ag = 1 ] && arquivos="$arquivos memory.md"
  for f in $arquivos; do
    [ -f "$h/$f" ] && { echo "### $f"; cat "$h/$f"; }
  done
  if [ $ag = 1 ] && [ -f "$HOME/.harness/perfil.md" ]; then
    echo "### perfil.md"; cat "$HOME/.harness/perfil.md"
  fi
  if grep -qF -- '- [ ]' "$h/dividas.md" 2>/dev/null; then
    echo "### Dívidas de resgate pendentes"
    grep -F -- '- [ ]' "$h/dividas.md"
  fi
}

if [ $ag = 1 ]; then
  texto | jq -Rs '{injectSteps: [{systemMessage: {systemMessage: .}}]}'
else
  texto
fi
exit 0
