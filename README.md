# Agentic Toolbox

Repositório pessoal para reunir harnesses, plugins, skills, agentes e outras ferramentas criadas para trabalhar com IA.

## Estrutura

```text
agentic-toolbox/
├── catalog.json          # Índice dos itens para consulta/instalação via CLI
├── harnesses/            # Harnesses completos e templates de ambiente
└── plugins/              # Plugins e mods para ferramentas específicas
```

Novas categorias (`skills/`, `agents/`, `prompts/`, etc.) entram na raiz conforme forem criadas, sempre no formato `<categoria>/<nome-em-kebab-case>/` com um `README.md` em português e registro no [`catalog.json`](catalog.json).

## Itens disponíveis

### Harnesses

| Item | Descrição | Ferramentas |
| :--- | :--- | :--- |
| [learning-harness](harnesses/learning-harness/) | Harness de aprendizagem com IA para praticar programação, com ergonomia para TDAH. | Claude Code, Antigravity |

### Plugins

| Item | Descrição | Ferramentas |
| :--- | :--- | :--- |
| [claude-mods](plugins/claude-mods/) | Coleção de mods (function hooks): `subagent-routing`, `usage-band` e `cassino`. | Claude Code |

## Licença

Distribuído sob a licença [MIT](LICENSE).
