# 🧠 Learning Harness

> **Harness de aprendizagem com IA para praticar programação, com ergonomia para TDAH.**  
> Você escreve o código; o agente orienta com base em documentação oficial. Uso pessoal, uma ferramenta de IA por vez.

---

## 🎯 1. Visão

O objetivo é **inverter o uso convencional da IA**: em vez de uma "muleta geradora de código" (que rouba o momento de aprendizado e dá ilusão de competência), ela atua como **treinador**, que aponta o caminho e a documentação.

### Princípios
- **Zero bloat:** sem banco, sem Docker, sem serviços em background.
- **Baseado em arquivos:** estado e memória em texto legível.
- **Autoria do usuário, garantida:** um bloqueio real (hook), não só um pedido.
- **Fonte real em toda resposta:** o agente lê a documentação oficial antes de citar e manda o trecho e o link, para você verificar, ler e aprender com a fonte, como se fazia sem IA.
- **Aprender fazendo:** sem perguntas e sem questionários; a prática é programar.

---

## 🛡️ 2. Regras

Resumo. As regras completas estão em [`template/AGENTS.md`](template/AGENTS.md).

1. **Autoria:** o agente não escreve o código do projeto. A exceção é o **resgate**, que só você ativa (seção 3).
2. **Âncora:** toda resposta começa situando onde estamos:  
   `📍 Marco 2 · Tarefa 3 (Passo 1/2) — Criando a janela GLFW`
3. **Um micro-passo por vez:** 1 arquivo, ou 1 função pequena e o teste dela.
4. **Fontes:** o agente lê antes de citar e manda o trecho literal + o link. Documentação local primeiro (`go doc`, `man`). Se não conseguiu abrir a fonte, escreve `não verificado`.
5. **Três modos de resposta**, com teto de 12 linhas:
   - **Apresentar** (início de passo ou "como faço X?"): O que é / Ponte mental / O que você precisa preencher / Fonte / Sua vez. Seções que não se aplicam são puladas; um conceito novo por resposta.
   - **Destravar** (`dica`, `travei` ou erro colado): só o degrau atual, a fonte e Sua vez.
   - **Rápida** (pergunta pontual): de 1 a 3 linhas e a fonte.
6. **Nomes:** os nomes de API são fatos, e o agente entrega. Os nomes do seu código são decisões suas.
7. **Escada de dicas:**

   | Degrau | O que o agente entrega |
   | :--- | :--- |
   | 0 | a fonte da função ou do conceito do passo; você tenta |
   | 1 | onde olhar, como afirmação ("o retorno da linha 42 não é checado"), com trecho da documentação |
   | 2 | o conceito explicado, com ponte para o que você domina |
   | 3 | um exemplo de caso parecido, de preferência tirado da própria documentação (vale um trecho de 1 a 3 linhas); nunca o seu caso |
   | 4 | a solução do seu caso, explicada — **só com resgate ativo** |

   Só você sobe de degrau: `dica` (+1) e `travei` (+2). O degrau 4 exige resgate.
8. **Testes:** o agente lista os casos numa tabela (entrada → saída esperada) e você escreve.
9. **Verificação por passo** (`test`, `build`, `run` ou `validation`), com critério definido antes de codar.
10. **Review de 3 linhas** ao concluir um passo: acertou / principal problema / próximo passo. Sem elogio genérico e sem pergunta.

### Comandos

| Comando | O que faz |
| :--- | :--- |
| `dica` | sobe 1 degrau |
| `travei` | sobe 2 degraus |
| `anota: <ideia>` | guarda a ideia em "Depois" no `plan.md` e volta ao passo |
| `salvar` | atualiza a memória; pronto para `/clear`. Também ao dizer "vou parar", "por hoje é isso" ou "tchau" |
| `detalha` | libera o limite de 12 linhas na próxima resposta |

---

## 🔒 3. Bloqueio de escrita e resgate

- **Bloqueio:** no Claude Code e no Antigravity, um hook `PreToolUse` (`.harness/bin/guard.sh`) bloqueia a escrita no código do projeto. Libera `.harness/` (menos `locks/`), os caminhos de `livre.txt` (boilerplate que não ensina, como `CMakeLists.txt`) e arquivos fora do projeto.
- **Resgate:** você roda `touch .harness/locks/resgate` no terminal (no Claude Code, direto no chat: `! touch .harness/locks/resgate`). Vale 10 minutos, e cada arquivo escrito vira uma linha em `.harness/dividas.md`. Na sessão seguinte o agente lembra, de forma opcional, de reescrever sem olhar.
- **Limitação conhecida:** escrita pelo shell (Bash) é coberta só pela regra escrita. Resolver só se acontecer na prática.
- **Ferramentas sem o hook** (o Codex, por exemplo): o agente segue a regra, confere o arquivo de resgate e registra a dívida ele mesmo. No Codex, o modo `read-only` impediria salvar a memória; a configuração para liberar escrita só em `.harness/` ainda precisa ser confirmada quando ele for usado.

---

## 🧠 4. Memória: limpar o contexto com segurança

O objetivo é manter o contexto entre sessões independente do agente. Por exemplo, se uma sessão chegar a 70% do contexto, dá para limpar (`/clear`) com segurança e continuar.

- **O que sobrevive:** `state.json` (onde estamos), `session.md` (o passo atual: degrau, tentativas, dicas, fontes lidas, hipótese, próxima ação), `plan.md` e `memory.md`.
- O agente atualiza esses arquivos **continuamente**, sem esperar pedido.
- `salvar` força a atualização antes de um `/clear`.
- **Recarga automática** pelo hook `SessionStart` (`carregar.sh`): ao abrir, depois de `/clear` e depois de compactação.
- A primeira resposta mostra uma linha `Carreguei: …` para você conferir.
- **Teste de aceitação:** trabalhar um pouco, `salvar`, `/clear`, "onde estamos?". A resposta tem que bater.

---

## 📁 5. Estrutura

### Este repositório
```text
learning-harness/
├── README.md
├── perfil.exemplo.md        # Modelo do seu perfil (copiar para ~/.harness/perfil.md)
├── armadilhas.md            # Teste rápido ao trocar de ferramenta
└── template/                # O que é copiado para cada projeto
```

### Um projeto depois da instalação
```text
seu-projeto/
├── AGENTS.md                # Regras completas (qualquer agente)
├── CLAUDE.md                # Importa AGENTS.md, memória, perfil e regras do projeto (Claude Code)
├── .claude/settings.json    # Hooks e domínios de documentação liberados (Claude Code)
├── .agents/
│   ├── hooks.json           # Hooks de bloqueio e recarga (Antigravity)
│   └── rules/projeto.md     # Regras específicas do projeto (as duas ferramentas leem)
└── .harness/
    ├── .gitignore           # Tira do Git os arquivos marcados abaixo
    ├── bin/guard.sh         # Hook de bloqueio de escrita (Claude Code e Antigravity)
    ├── bin/carregar.sh      # Hook de recarga do contexto (Claude Code e Antigravity)
    ├── livre.txt            # Caminhos que o agente pode escrever
    ├── locks/               # Só seu: o arquivo de resgate fica aqui
    │   └── resgate          # (fora do Git) criado por você para ativar o resgate
    ├── plan.md              # Marcos, Tarefas e Passos; ideias em "Depois"
    ├── state.json           # (fora do Git) onde estamos agora
    ├── session.md           # (fora do Git) o passo atual em detalhe
    ├── memory.md            # Fontes oficiais com versão, decisões e convenções
    └── dividas.md           # Código escrito em resgate, a reescrever
```

O perfil fica em `~/.harness/perfil.md`, fora do repositório, por privacidade.

---

## 🚀 6. Instalação

**Requisitos:** Claude Code, `jq`, bash/coreutils (Linux). Confira com `command -v jq`; sem ele, o bloqueio barra toda escrita.

### Uma vez por máquina: o perfil

```bash
mkdir -p ~/.harness && cp perfil.exemplo.md ~/.harness/perfil.md
```

Edite o perfil com o que você domina, o que está aprendendo e como prefere aprender. Ele vale para todos os projetos e fica fora de qualquer repositório.

### Em cada projeto

1. **Se o projeto já tem regras de IA** (`CLAUDE.md`, `AGENTS.md`, um arquivo de progresso), guarde antes de copiar:
   ```bash
   cd ~/caminho/do/projeto
   mkdir -p .harness/legado
   mv CLAUDE.md .harness/legado/CLAUDE.antigo.md      # repita para cada arquivo antigo
   ```
   Depois, passe o que for útil para os arquivos novos: fontes e decisões para o `memory.md`, marcos e progresso para o `plan.md`, onde você parou para o `state.json` e o `session.md`, e regras específicas do projeto para o `.agents/rules/projeto.md`.
2. **Copie o template** (o `-n` não sobrescreve nada que já exista):
   ```bash
   cp -an ~/www/agentic-toolbox/harnesses/learning-harness/template/. ~/caminho/do/projeto/
   ```
3. **Tire os arquivos de IA do Git** sem mexer no `.gitignore` do projeto:
   ```bash
   printf '%s\n' AGENTS.md CLAUDE.md .claude/ .agents/ .harness/ >> .git/info/exclude
   ```
   Se preferir versionar o `plan.md` e o `memory.md`, pule este passo; o `.harness/.gitignore` já tira do Git o `state.json`, o `session.md` e o arquivo de resgate.
4. **Ajuste ao projeto:**
   - `.harness/memory.md`: a stack com versões e as fontes oficiais.
   - `.harness/plan.md`: os Marcos, como resultados verificáveis.
   - `.harness/state.json` e `.harness/session.md`: o passo atual.
   - `.harness/livre.txt`: o boilerplate que o agente pode escrever. Deixe de fora o que você quer aprender (se está aprendendo Make, o `Makefile` não entra).
   - `.agents/rules/projeto.md`: as regras específicas do projeto.
   - `.claude/settings.json`: os domínios de documentação da stack e os comandos que o agente roda sem pedir (`make`, o binário, etc.). No Antigravity, isso se configura nas permissões do próprio aplicativo.
5. **Confira:** abra o Claude Code na raiz do projeto, rode `/hooks` e veja o `PreToolUse` e o `SessionStart`. Depois faça o teste de aceitação da seção 4. No Antigravity, veja a seção 8.

---

## 🧭 7. Uso no dia a dia

1. **Abrir a sessão:** `claude` na raiz do projeto. A primeira resposta mostra a âncora, a linha `Carreguei: …` e a próxima ação. Confira se bate com onde você parou.
2. **Começar um passo:** diga o que quer fazer ("como faço X?"). O agente responde no modo Apresentar, com a fonte, e termina com **Sua vez**.
3. **Programar:** você escreve o código no editor.
4. **Travou:** cole o erro, ou digite `dica` (sobe 1 degrau) ou `travei` (sobe 2). Cada resposta traz o trecho da documentação; abra o link quando quiser conferir.
5. **Terminou o passo:** avise ("pronto", "terminei"). O agente roda a verificação do `state.json`, faz o review de 3 linhas e avança o plano.
6. **Ideia paralela:** `anota: <ideia>` guarda no `plan.md` sem desviar do passo.
7. **Contexto cheio** (perto de 70%): `salvar`, depois `/clear`. A sessão nova recarrega sozinha.
8. **Parar por hoje:** `salvar` (ou "vou parar", "tchau") e feche. Na próxima vez, o passo 1 retoma de onde parou.

**Resgate** (quando você quer que o agente escreva o código):

```bash
! touch .harness/locks/resgate      # Claude Code, direto no chat
touch .harness/locks/resgate        # Antigravity, no terminal integrado
```

Vale por 10 minutos. Cada arquivo que o agente escrever vira uma linha em `.harness/dividas.md`. Quando você reescrever o trecho sem olhar, peça para marcar como feito.

---

## 🔁 8. Trocar de ferramenta

- Uma ferramenta por vez.
- Serve qualquer agente que leia o `AGENTS.md`. O Claude Code e o Antigravity têm o bloqueio e a recarga por hook; nos outros, valem só as regras escritas.
- Ao trocar, rode o [`armadilhas.md`](armadilhas.md) (uns 5 minutos).

### Antigravity

- **Lê sozinho:** o `AGENTS.md` e o `.agents/rules/projeto.md`. O `CLAUDE.md` é ignorado; por isso o hook de recarga também injeta o `memory.md` e o seu perfil.
- **Hooks:** o `.agents/hooks.json` chama os mesmos scripts com `--antigravity`, que responde no formato dele (JSON com `decision` e `injectSteps`).
- **Limpar o contexto:** abra uma conversa nova. O hook de recarga roda no início de cada conversa.
- **Resgate:** `touch .harness/locks/resgate` no terminal integrado.
- **Primeiro uso:** confira se os hooks rodam. Peça ao agente para editar um arquivo de código: ele tem que ser bloqueado com a mensagem do `guard.sh`. A documentação do Antigravity não diz de qual pasta os hooks rodam; se não funcionar, troque `./.harness/bin/` no `.agents/hooks.json` pelo caminho absoluto do projeto.

---

## 📚 9. Lições de projetos anteriores

As regras vieram da prática nos projetos abaixo; a tabela é para você preencher.

| Projeto | O que funcionou | O que falhou |
| :--- | :--- | :--- |
| `FluxLang` | (preencher) | (preencher) |
| `minecraft-clone` | (preencher) | (preencher) |
| `golang/learning` | (preencher) | (preencher) |
| `biblioteca-backend` | (preencher) | (preencher) |

---

## 🗺️ 10. Próximos passos

- **Fase 1 — feita:** os templates deste repositório.
- **Fase 2 — depois de 2 a 3 semanas de uso real:**
  - `log.jsonl` com o degrau máximo e se houve resgate em cada passo, mais o comando `como estou?` para ver a tendência;
  - `katas.md` com exercícios de 5 a 10 minutos sobre conceitos que precisaram do degrau 2 ou mais, espaçados em 1, 3, 7 e 21 dias, com o comando `kata`, sempre opcional;
  - prova de fim de Marco (um kata maior, opcional);
  - se aparecerem links errados, um hook que confere se cada link citado foi realmente aberto na sessão.
