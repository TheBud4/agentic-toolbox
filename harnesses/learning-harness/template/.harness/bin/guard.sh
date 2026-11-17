#!/usr/bin/env bash
# PreToolUse: bloqueia escrita no código do projeto.
#   Claude Code: guard.sh                (bloqueia com exit 2)
#   Antigravity: guard.sh --antigravity  (responde JSON com "decision")
# Libera: .harness/ (menos locks/), caminhos de livre.txt, arquivos fora do projeto
# e tudo durante um resgate ativo (o usuário cria .harness/locks/resgate; vale 10 min).
ag=0; [ "$1" = "--antigravity" ] && ag=1

permitir() { [ $ag = 1 ] && echo '{"decision":"allow"}'; exit 0; }
bloquear() {
  if [ $ag = 1 ]; then
    if command -v jq >/dev/null; then jq -cn --arg r "$1" '{decision:"deny",reason:$r}'
    else echo '{"decision":"deny","reason":"guard.sh: instale o jq para o bloqueio funcionar."}'; fi
    exit 0
  fi
  echo "$1" >&2; exit 2
}

command -v jq >/dev/null || bloquear "guard.sh: instale o jq para o bloqueio funcionar."
in=$(cat)
if [ $ag = 1 ]; then
  root=$(jq -r '.workspacePaths[0] // empty' <<<"$in")
  f=$(jq -r '.toolCall.args.TargetFile // empty' <<<"$in")
else
  root="$CLAUDE_PROJECT_DIR"
  f=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$in")
fi
[ -z "$f" ] && permitir
[ -z "$root" ] && bloquear "guard.sh: não encontrei a raiz do projeto."
case "$f" in /*) ;; *) f="$root/$f" ;; esac
h="$root/.harness"
rel=$(realpath -m --relative-to="$root" "$f")

case "$rel" in
  .harness/locks/*) bloquear "Bloqueado: .harness/locks/ é só do usuário." ;;
  .harness/*)       permitir ;;
  ../*)             permitir ;;  # fora do projeto
esac

# Caminhos fora do escopo de aprendizado (um glob por linha).
if [ -f "$h/livre.txt" ]; then
  while IFS= read -r pat; do
    [[ -z "$pat" || "$pat" == \#* ]] && continue
    [[ "$rel" == $pat ]] && permitir
  done < "$h/livre.txt"
fi

# Resgate ativo: libera e registra a dívida (uma linha por arquivo).
if [ -n "$(find "$h/locks/resgate" -mmin -10 2>/dev/null)" ]; then
  grep -qF -- "- [ ] $rel " "$h/dividas.md" 2>/dev/null ||
    echo "- [ ] $rel ($(date +%F)) — reescrever sem olhar" >> "$h/dividas.md"
  permitir
fi

bloquear "Bloqueado: $rel é código do aluno. Ofereça o próximo degrau da escada ou explique como ativar o resgate (touch .harness/locks/resgate)."
