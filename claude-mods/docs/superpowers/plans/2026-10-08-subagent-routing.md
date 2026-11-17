# subagent-routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um mod do Claude Code que roteia cada chamada da ferramenta `Agent` para um modelo/effort conforme a dificuldade da tarefa e incentiva a sessão principal a delegar de forma moderada.

**Architecture:** Um plugin de *function hooks* (`subagent-routing`) dentro do repositório `~/www/claude-mods`, que é também um marketplace local. Toda a lógica de decisão, tags, comando e textos fica em módulos puros (`tiers.ts`, `tags.ts`, `classify.ts`, `policy.ts`, `stats.ts`, `command.ts`) testados sem o motor; `register.ts` só liga os eventos (`session.start`, `prompt.compose`, `prompt.submit`, `tool.call` de `Agent`, `command.run`) a essas funções e grava estado em `$.state` (sessão) e `$.store` (global).

**Tech Stack:** TypeScript (ES modules, sem Node/DOM), API de function hooks do Claude Code 2.1.294 (`import ... from 'claude-code'`), kit de testes `claude-code/testing` rodado por `claude plugin test`, `claude plugin validate`, `tsc`.

**Spec:** `docs/superpowers/specs/2026-10-08-subagent-routing-design.md`

## Global Constraints

- Nome do mod: `subagent-routing`; versão inicial `0.1.0`. Pasta: `~/www/claude-mods/subagent-routing/`.
- Módulos: só `import` estático de `'claude-code'`, `'claude-code/testing'` (testes) e arquivos relativos do próprio plugin. Proibido `import()` dinâmico, `require`, APIs de Node ou DOM, `structuredClone`.
- Chaves de `$.state` são literais no código: `{ plugin: 'subagent-routing', key: '<chave>' } as const`, chaves `mode`, `turnTag`, `lastRoute`, `sessionStats`, declaradas em `types/index.d.ts`.
- Chaves de `$.store`: `config` e `stats`.
- Tabela padrão de níveis, exata: `leve` → haiku/high · `medio` → sonnet/high · `pesado` → opus/high · `maximo` → opus/max.
- O classificador só devolve `leve`/`medio`/`pesado`; `boost` nunca leva a `maximo`; `maximo` só por escolha explícita do Sonnet (opus com effort `max`/`xhigh`, ou o alvo exato configurado), tag `#max` ou `/route force maximo`.
- Tag e modo `force` ignoram eco/boost e os limites fixos.
- O mod nunca impede uma delegação: qualquer erro no hook de `tool.call` repassa a chamada intacta.
- Textos para o usuário (toasts, status, `/route`) em português.
- Commits sem trailer `Co-Authored-By` e sem linha `Claude-Session` (instrução global do usuário).
- Todos os comandos rodam a partir de `~/www/claude-mods`.

## Review Focus

1. **Modelo informado como ID completo ou em maiúsculas** (`claude-opus-5-5`, `HAIKU`): deve cair na família certa (pesado / leve), não em "fora da tabela". Teste na Task 3.
2. **Prompt que é só a tag** (`#max` sozinho): a tag vale, mas o texto não pode virar vazio; o modelo recebe o texto original. Teste na Task 4.
3. **Texto parecido com tag que não é tag** (`#max-width`, `a#leve`, `issue #123`): não pode ser removido nem mudar o nível. Teste na Task 4.
4. **Requisições sem a ferramenta `Agent`** (os próprios subagentes, compactação): a política de delegação não pode ser injetada nelas. Teste na Task 8.
5. **Classificador respondendo fora do formato** (`Médio.`, `**pesado**`, `não sei`): formatos com acento/pontuação/markdown são aceitos; qualquer outra coisa cai no nível de reserva `medio`. Testes nas Tasks 5 e 8.

---

### Task 1: Esqueleto do repositório, do mod e carregamento em desenvolvimento

**Files:**
- Create: `.gitignore`
- Create: `.claude-plugin/marketplace.json`
- Create: `README.md`
- Create: `subagent-routing/.claude-plugin/plugin.json`
- Create: `subagent-routing/hooks/hooks.json`
- Create: `subagent-routing/hooks/register.ts`
- Create: `subagent-routing/types/index.d.ts`
- Create: `subagent-routing/tsconfig.json`
- Create: `subagent-routing/tests/smoke.test.ts`

**Interfaces:**
- Produces: tipos `RouteTier`, `RouteModel`, `RouteEffort`, `RouteTarget`, `RouteMode`, `RouteSource`, `RouteStats`, `LastRoute` exportados de `subagent-routing/types/index.d.ts` (importados como `'../types'` a partir de `hooks/` e `tests/`).

- [ ] **Step 1: Criar os arquivos do repositório**

`.gitignore`:
```gitignore
# tipos que o motor do Claude Code escreve a cada carga do mod
*/.claude-plugin/types/
```

`.claude-plugin/marketplace.json`:
```json
{
  "name": "claude-mods",
  "owner": { "name": "TheBud4" },
  "plugins": [{ "name": "subagent-routing", "source": "./subagent-routing" }]
}
```

`README.md`:
````markdown
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
````

- [ ] **Step 2: Criar o manifesto, o hooks.json e o contrato de estado**

`subagent-routing/.claude-plugin/plugin.json`:
```json
{
  "name": "subagent-routing",
  "version": "0.1.0",
  "description": "Roteia cada subagente para um modelo/effort conforme a dificuldade e incentiva a delegação moderada",
  "types": "./types/index.d.ts"
}
```

`subagent-routing/hooks/hooks.json`:
```json
{ "modules": ["./register.ts"] }
```

`subagent-routing/types/index.d.ts`:
```ts
export type RouteTier = 'leve' | 'medio' | 'pesado' | 'maximo'
export type RouteModel = 'haiku' | 'sonnet' | 'opus' | 'fable'
export type RouteEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type RouteTarget = { model: RouteModel; effort: RouteEffort }
export type RouteMode = null | 'eco' | 'boost' | { force: RouteTier }
export type RouteSource = 'tag' | 'force' | 'sonnet' | 'classificador' | 'reserva'
export type RouteStats = {
  porNivel: Record<RouteTier, number>
  porFonte: Record<RouteSource | 'limite', number>
  fork: number
  foraDaTabela: number
}
export type LastRoute = {
  model: string
  effort: string
  tier: RouteTier | null
  reason: string
  description: string
}

declare module 'claude-code' {
  interface PluginState {
    'subagent-routing': {
      mode: RouteMode
      turnTag: RouteTier | null
      lastRoute: LastRoute | null
      sessionStats: RouteStats
    }
  }
}
```

`subagent-routing/tsconfig.json`:
```json
{
  "extends": "./.claude-plugin/types/tsconfig.json",
  "include": [".claude-plugin/types", "hooks", "types", "tests"]
}
```

`subagent-routing/hooks/register.ts` (vazio por enquanto; a Task 8 o preenche):
```ts
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

- [ ] **Step 3: Teste de fumaça do kit**

`subagent-routing/tests/smoke.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'

test('o kit de testes carrega o plugin', () => {
  expect(1 + 1).toBe(2)
})
```

- [ ] **Step 4: Validar e rodar os testes**

Run: `claude plugin validate subagent-routing && claude plugin validate .`
Expected: nenhum erro; o relatório lista o módulo `./register.ts` sem hooks e o marketplace com a entrada `subagent-routing`.

Run: `claude plugin test subagent-routing`
Expected: 1 teste passando.

- [ ] **Step 5: Ligar o mod a esta sessão com hot reload**

```bash
ln -s ~/www/claude-mods/subagent-routing /home/TheBuda/.claude/dev-mods/f116f418-123e-41b4-ae45-3c12617ff716/subagent-routing
```

O motor pergunta ao usuário "Enable hot reloading for this session?". O usuário responde `Enable for this session`. No turno seguinte chega a confirmação de que o mod carregou, e a pasta `subagent-routing/.claude-plugin/types/` passa a existir.
Se a pergunta não aparecer (sessão diferente, `claude -p`): use uma sessão nova com `claude --plugin-dir ~/www/claude-mods/subagent-routing`.

Run (depois do carregamento): `npx tsc -p subagent-routing`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add .gitignore .claude-plugin README.md subagent-routing
git commit -m "feat(subagent-routing): esqueleto do mod e marketplace"
```

---

### Task 2: `tiers.ts`: configuração, normalização e parsing

**Files:**
- Create: `subagent-routing/hooks/tiers.ts`
- Test: `subagent-routing/tests/config.test.ts`

**Interfaces:**
- Consumes: tipos de `../types` (Task 1).
- Produces:
  - `type ClassTier = Exclude<RouteTier, 'maximo'>`
  - `type RouteConfig = { tiers: Record<RouteTier, RouteTarget>; heavyKeywords: string[]; writeVerbs: string[]; readOnlyAgents: string[]; classifier: { enabled: boolean; timeoutMs: number; fallback: ClassTier } }`
  - `const TIERS: readonly RouteTier[]`, `const MODELS: readonly RouteModel[]`, `const EFFORTS: readonly RouteEffort[]`, `const DEFAULT_CONFIG: RouteConfig`
  - `normalize(text: string): string`
  - `containsTerm(text: string, term: string): boolean`
  - `parseTier(word: string): RouteTier | null`
  - `parseTarget(spec: string): RouteTarget | null`
  - `cloneConfig(config: RouteConfig): RouteConfig`
  - `mergeConfig(raw: unknown): { config: RouteConfig; isRepaired: boolean }`

- [ ] **Step 1: Escrever os testes que falham**

`subagent-routing/tests/config.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULT_CONFIG,
  containsTerm,
  mergeConfig,
  normalize,
  parseTarget,
  parseTier,
} from '../hooks/tiers'

describe('normalize e containsTerm', () => {
  test('remove acento e caixa', () => {
    expect(normalize('Migração ÁGIL')).toBe('migracao agil')
  })

  test('casa palavra inteira, nunca substring', () => {
    expect(containsTerm('corrigir o Deadlock no worker', 'deadlock')).toBe(true)
    expect(containsTerm('listar arquivos do raceway', 'race')).toBe(false)
    expect(containsTerm('há uma race condition aqui', 'race condition')).toBe(true)
    expect(containsTerm('revisar a segurança do login', 'segurança')).toBe(true)
    expect(containsTerm('qualquer coisa', '   ')).toBe(false)
  })
})

describe('parseTier e parseTarget', () => {
  test('níveis com acento e apelidos', () => {
    expect(parseTier('Médio')).toBe('medio')
    expect(parseTier('max')).toBe('maximo')
    expect(parseTier('máximo')).toBe('maximo')
    expect(parseTier('turbo')).toBe(null)
  })

  test('modelo/effort válidos, sem caixa', () => {
    expect(parseTarget('Haiku/Medium')).toEqual({ model: 'haiku', effort: 'medium' })
  })

  test('modelo/effort inválidos', () => {
    expect(parseTarget('gpt/high')).toBe(null)
    expect(parseTarget('opus/ultra')).toBe(null)
    expect(parseTarget('opus')).toBe(null)
    expect(parseTarget('opus/high/x')).toBe(null)
  })
})

describe('mergeConfig', () => {
  test('nada salvo: padrão, sem aviso', () => {
    expect(mergeConfig(undefined)).toEqual({ config: DEFAULT_CONFIG, isRepaired: false })
  })

  test('campo válido sobrescreve; ausente usa o padrão em silêncio', () => {
    const { config, isRepaired } = mergeConfig({ tiers: { leve: { model: 'haiku', effort: 'low' } } })
    expect(config.tiers.leve).toEqual({ model: 'haiku', effort: 'low' })
    expect(config.tiers.medio).toEqual(DEFAULT_CONFIG.tiers.medio)
    expect(isRepaired).toBe(false)
  })

  test('campo inválido usa o padrão e avisa', () => {
    const { config, isRepaired } = mergeConfig({
      tiers: { leve: { model: 'gpt', effort: 'low' } },
      heavyKeywords: 'deadlock',
      classifier: { timeoutMs: -1 },
    })
    expect(config.tiers.leve).toEqual(DEFAULT_CONFIG.tiers.leve)
    expect(config.heavyKeywords).toEqual(DEFAULT_CONFIG.heavyKeywords)
    expect(config.classifier.timeoutMs).toBe(4000)
    expect(isRepaired).toBe(true)
  })

  test('valor que nem é objeto: padrão e avisa', () => {
    expect(mergeConfig('lixo')).toEqual({ config: DEFAULT_CONFIG, isRepaired: true })
  })

  test('o resultado não compartilha listas com o padrão', () => {
    const { config } = mergeConfig(undefined)
    config.heavyKeywords.push('x')
    expect(DEFAULT_CONFIG.heavyKeywords).not.toContain('x')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test subagent-routing`
Expected: FAIL em `config.test.ts`, porque `../hooks/tiers` não existe.

- [ ] **Step 3: Implementar**

`subagent-routing/hooks/tiers.ts`:
```ts
import type { RouteEffort, RouteModel, RouteTarget, RouteTier } from '../types'

export type ClassTier = Exclude<RouteTier, 'maximo'>

export type RouteConfig = {
  tiers: Record<RouteTier, RouteTarget>
  heavyKeywords: string[]
  writeVerbs: string[]
  readOnlyAgents: string[]
  classifier: { enabled: boolean; timeoutMs: number; fallback: ClassTier }
}

export const TIERS: readonly RouteTier[] = ['leve', 'medio', 'pesado', 'maximo']
export const MODELS: readonly RouteModel[] = ['haiku', 'sonnet', 'opus', 'fable']
export const EFFORTS: readonly RouteEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const DEFAULT_CONFIG: RouteConfig = {
  tiers: {
    leve: { model: 'haiku', effort: 'high' },
    medio: { model: 'sonnet', effort: 'high' },
    pesado: { model: 'opus', effort: 'high' },
    maximo: { model: 'opus', effort: 'max' },
  },
  heavyKeywords: [
    'debug', 'debugar', 'depurar', 'arquitetura', 'architecture', 'race',
    'race condition', 'condição de corrida', 'concorrência', 'concurrency',
    'segurança', 'security', 'vulnerabilidade', 'vulnerability', 'deadlock',
    'migração', 'migration', 'causa raiz', 'root cause',
  ],
  writeVerbs: [
    'implementar', 'implemente', 'implementa', 'editar', 'edite', 'edita',
    'corrigir', 'corrija', 'corrige', 'refatorar', 'refatore', 'refatora',
    'criar', 'crie', 'cria', 'escrever', 'escreva', 'escreve', 'alterar',
    'altere', 'altera', 'adicionar', 'adicione', 'adiciona', 'remover',
    'remova', 'renomear', 'renomeie', 'implement', 'edit', 'fix', 'refactor',
    'write', 'create', 'modify', 'update', 'add', 'delete', 'rename', 'remove',
  ],
  readOnlyAgents: [
    'Explore', 'Plan', 'auditor', 'claude-code-guide',
    'feature-dev:code-explorer', 'feature-dev:code-reviewer',
    'feature-dev:code-architect', 'hookify:conversation-analyzer',
  ],
  classifier: { enabled: true, timeoutMs: 4000, fallback: 'medio' },
}

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `term` aparece em `text` como palavra (ou expressão) inteira, sem acento nem caixa. */
export function containsTerm(text: string, term: string): boolean {
  const wanted = normalize(term).trim()
  if (wanted === '') return false
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(wanted)}([^a-z0-9]|$)`).test(normalize(text))
}

export function parseTier(word: string): RouteTier | null {
  const w = normalize(word).trim()
  if (w === 'max') return 'maximo'
  return (TIERS as readonly string[]).includes(w) ? (w as RouteTier) : null
}

export function parseTarget(spec: string): RouteTarget | null {
  const [model, effort, ...rest] = normalize(spec).trim().split('/')
  if (model === undefined || effort === undefined || rest.length > 0) return null
  if (!(MODELS as readonly string[]).includes(model)) return null
  if (!(EFFORTS as readonly string[]).includes(effort)) return null
  return { model: model as RouteModel, effort: effort as RouteEffort }
}

export function cloneConfig(config: RouteConfig): RouteConfig {
  return JSON.parse(JSON.stringify(config)) as RouteConfig
}

function isTarget(value: unknown): value is RouteTarget {
  if (typeof value !== 'object' || value === null) return false
  const { model, effort } = value as Record<string, unknown>
  return (
    typeof model === 'string' && (MODELS as readonly string[]).includes(model) &&
    typeof effort === 'string' && (EFFORTS as readonly string[]).includes(effort)
  )
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/** Mescla a config salva sobre o padrão. Ausente: padrão em silêncio. Inválido: padrão e `isRepaired`. */
export function mergeConfig(raw: unknown): { config: RouteConfig; isRepaired: boolean } {
  const config = cloneConfig(DEFAULT_CONFIG)
  if (raw === undefined || raw === null) return { config, isRepaired: false }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { config, isRepaired: true }

  const saved = raw as Record<string, unknown>
  let isRepaired = false

  if (typeof saved.tiers === 'object' && saved.tiers !== null) {
    const tiers = saved.tiers as Record<string, unknown>
    for (const tier of TIERS) {
      const value = tiers[tier]
      if (value === undefined) continue
      if (isTarget(value)) config.tiers[tier] = { model: value.model, effort: value.effort }
      else isRepaired = true
    }
  } else if (saved.tiers !== undefined) {
    isRepaired = true
  }

  for (const key of ['heavyKeywords', 'writeVerbs', 'readOnlyAgents'] as const) {
    const value = saved[key]
    if (value === undefined) continue
    if (isStringList(value)) config[key] = [...value]
    else isRepaired = true
  }

  if (typeof saved.classifier === 'object' && saved.classifier !== null) {
    const { enabled, timeoutMs, fallback } = saved.classifier as Record<string, unknown>
    if (typeof enabled === 'boolean') config.classifier.enabled = enabled
    else if (enabled !== undefined) isRepaired = true
    if (typeof timeoutMs === 'number' && timeoutMs > 0) config.classifier.timeoutMs = timeoutMs
    else if (timeoutMs !== undefined) isRepaired = true
    if (fallback === 'leve' || fallback === 'medio' || fallback === 'pesado') config.classifier.fallback = fallback
    else if (fallback !== undefined) isRepaired = true
  } else if (saved.classifier !== undefined) {
    isRepaired = true
  }

  return { config, isRepaired }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `claude plugin test subagent-routing`
Expected: todos os testes de `config.test.ts` e `smoke.test.ts` passam.

- [ ] **Step 5: Commit**

```bash
git add subagent-routing/hooks/tiers.ts subagent-routing/tests/config.test.ts
git commit -m "feat(subagent-routing): config padrão, normalização e parsing"
```

---

### Task 3: `tiers.ts`: a decisão de rota

**Files:**
- Modify: `subagent-routing/hooks/tiers.ts` (acrescentar ao fim)
- Test: `subagent-routing/tests/decide.test.ts`

**Interfaces:**
- Consumes: tudo de `tiers.ts` da Task 2; tipos `RouteMode`, `RouteSource`, `RouteTier`, `RouteTarget` de `../types`.
- Produces:
  - `type DecideInput = { subagentType: string | undefined; description: string; prompt: string; model: string | undefined; effort: string | undefined; turnTag: RouteTier | null; mode: RouteMode }`
  - `type RouteDecision = { kind: 'fork' } | { kind: 'fora'; model: string } | { kind: 'route'; tier: RouteTier; target: RouteTarget; source: RouteSource; reasons: string[]; isLimited: boolean }`
  - `isForced(mode: RouteMode): mode is { force: RouteTier }`
  - `tierFromChoice(model: string | undefined, effort: string | undefined, config: RouteConfig): RouteTier | 'fora' | null`
  - `shiftTier(tier: RouteTier, mode: 'eco' | 'boost'): RouteTier`
  - `editsFiles(subagentType: string | undefined, text: string, config: RouteConfig): boolean`
  - `findHeavyKeyword(text: string, config: RouteConfig): string | null`
  - `needsClassifier(input: DecideInput, config: RouteConfig): boolean`
  - `decide(input: DecideInput, classified: ClassTier | null, config: RouteConfig): RouteDecision`

- [ ] **Step 1: Escrever os testes que falham**

`subagent-routing/tests/decide.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULT_CONFIG,
  cloneConfig,
  decide,
  needsClassifier,
  shiftTier,
  tierFromChoice,
  type ClassTier,
  type DecideInput,
} from '../hooks/tiers'

const BASE: DecideInput = {
  subagentType: 'general-purpose',
  description: 'tarefa',
  prompt: 'olhar o código',
  model: undefined,
  effort: undefined,
  turnTag: null,
  mode: null,
}

function route(over: Partial<DecideInput>, classified: ClassTier | null = null) {
  return decide({ ...BASE, ...over }, classified, DEFAULT_CONFIG)
}

describe('tierFromChoice', () => {
  test('aliases do Agent', () => {
    expect(tierFromChoice('haiku', 'high', DEFAULT_CONFIG)).toBe('leve')
    expect(tierFromChoice('sonnet', undefined, DEFAULT_CONFIG)).toBe('medio')
    expect(tierFromChoice('opus', 'high', DEFAULT_CONFIG)).toBe('pesado')
    expect(tierFromChoice('opus', 'max', DEFAULT_CONFIG)).toBe('maximo')
    expect(tierFromChoice('opus', 'xhigh', DEFAULT_CONFIG)).toBe('maximo')
  })

  test('ID completo e maiúsculas caem na família', () => {
    expect(tierFromChoice('claude-opus-5-5', undefined, DEFAULT_CONFIG)).toBe('pesado')
    expect(tierFromChoice('HAIKU', undefined, DEFAULT_CONFIG)).toBe('leve')
  })

  test('modelo fora da tabela e ausente', () => {
    expect(tierFromChoice('fable', 'high', DEFAULT_CONFIG)).toBe('fora')
    expect(tierFromChoice(undefined, 'high', DEFAULT_CONFIG)).toBe(null)
  })

  test('modelo configurado fora das famílias vira o nível configurado', () => {
    const config = cloneConfig(DEFAULT_CONFIG)
    config.tiers.maximo = { model: 'fable', effort: 'max' }
    expect(tierFromChoice('fable', 'high', config)).toBe('maximo')
  })
})

describe('shiftTier', () => {
  test('eco desce até leve', () => {
    expect(shiftTier('maximo', 'eco')).toBe('pesado')
    expect(shiftTier('pesado', 'eco')).toBe('medio')
    expect(shiftTier('medio', 'eco')).toBe('leve')
    expect(shiftTier('leve', 'eco')).toBe('leve')
  })

  test('boost sobe até pesado e nunca cria maximo', () => {
    expect(shiftTier('leve', 'boost')).toBe('medio')
    expect(shiftTier('medio', 'boost')).toBe('pesado')
    expect(shiftTier('pesado', 'boost')).toBe('pesado')
    expect(shiftTier('maximo', 'boost')).toBe('maximo')
  })
})

describe('decide: fontes', () => {
  test('fork passa sem roteamento', () => {
    expect(route({ subagentType: 'fork', model: 'opus' })).toEqual({ kind: 'fork' })
  })

  test('tag vence force e escolha do Sonnet', () => {
    expect(route({ turnTag: 'leve', mode: { force: 'pesado' }, model: 'opus' })).toEqual({
      kind: 'route', tier: 'leve', target: { model: 'haiku', effort: 'high' },
      source: 'tag', reasons: ['tag #leve'], isLimited: false,
    })
  })

  test('force vence a escolha do Sonnet', () => {
    const d = route({ mode: { force: 'pesado' }, model: 'haiku' })
    expect(d).toEqual({
      kind: 'route', tier: 'pesado', target: { model: 'opus', effort: 'high' },
      source: 'force', reasons: ['force pesado'], isLimited: false,
    })
  })

  test('escolha do Sonnet', () => {
    expect(route({ subagentType: 'Explore', model: 'haiku' })).toEqual({
      kind: 'route', tier: 'leve', target: { model: 'haiku', effort: 'high' },
      source: 'sonnet', reasons: ['sonnet'], isLimited: false,
    })
  })

  test('sem model: classificador', () => {
    const d = route({}, 'pesado')
    expect(d).toEqual({
      kind: 'route', tier: 'pesado', target: { model: 'opus', effort: 'high' },
      source: 'classificador', reasons: ['classificador'], isLimited: false,
    })
  })

  test('sem model e classificador falhou: reserva medio', () => {
    expect(route({}, null)).toEqual({
      kind: 'route', tier: 'medio', target: { model: 'sonnet', effort: 'high' },
      source: 'reserva', reasons: ['classificador falhou'], isLimited: false,
    })
  })

  test('modelo fora da tabela passa como pedido', () => {
    expect(route({ model: 'fable', effort: 'high' })).toEqual({ kind: 'fora', model: 'fable' })
  })

  test('tag vence até modelo fora da tabela', () => {
    expect(route({ model: 'fable', turnTag: 'medio' })).toMatchObject({ kind: 'route', tier: 'medio', source: 'tag' })
  })
})

describe('decide: eco, boost e limites', () => {
  test('eco desce a escolha do Sonnet', () => {
    expect(route({ mode: 'eco', model: 'sonnet', subagentType: 'Explore' })).toMatchObject({
      tier: 'leve', reasons: ['sonnet', 'eco'],
    })
  })

  test('limite de edição vem depois do eco', () => {
    expect(route({ mode: 'eco', model: 'sonnet', prompt: 'corrigir o bug no parser' })).toEqual({
      kind: 'route', tier: 'medio', target: { model: 'sonnet', effort: 'high' },
      source: 'sonnet', reasons: ['sonnet', 'eco', 'limite: edita arquivos'], isLimited: true,
    })
  })

  test('boost não passa de pesado e mantém maximo', () => {
    expect(route({ mode: 'boost', model: 'opus' })).toMatchObject({ tier: 'pesado' })
    expect(route({ mode: 'boost', model: 'opus', effort: 'max' })).toMatchObject({ tier: 'maximo' })
    expect(route({ mode: 'eco', model: 'opus', effort: 'max' })).toMatchObject({ tier: 'pesado' })
  })

  test('palavra pesada eleva a pesado', () => {
    expect(route({ model: 'sonnet', prompt: 'corrigir o deadlock no worker' })).toEqual({
      kind: 'route', tier: 'pesado', target: { model: 'opus', effort: 'high' },
      source: 'sonnet', reasons: ['sonnet', 'limite: "deadlock"'], isLimited: true,
    })
  })

  test('palavra pesada nunca rebaixa maximo', () => {
    expect(route({ model: 'opus', effort: 'max', prompt: 'deadlock' })).toMatchObject({ tier: 'maximo', isLimited: false })
  })

  test('substring não dispara palavra pesada', () => {
    expect(route({ subagentType: 'Explore', model: 'haiku', prompt: 'listar arquivos do raceway' })).toMatchObject({ tier: 'leve' })
  })

  test('tag ignora os limites', () => {
    expect(route({ turnTag: 'leve', prompt: 'corrigir o deadlock' })).toMatchObject({ tier: 'leve', isLimited: false })
  })

  test('agente somente leitura não conta como edição', () => {
    expect(route({ subagentType: 'Explore', model: 'haiku', prompt: 'descobrir como corrigir o bug' })).toMatchObject({ tier: 'leve' })
  })

  test('verbo de escrita em inglês conta como edição', () => {
    expect(route({ model: 'haiku', prompt: 'implement the parser' })).toMatchObject({ tier: 'medio', isLimited: true })
  })

  test('tipo desconhecido sem verbo de escrita não é edição', () => {
    expect(route({ subagentType: 'my-agent', model: 'haiku', prompt: 'resumir o README' })).toMatchObject({ tier: 'leve' })
  })
})

describe('needsClassifier', () => {
  test('só sem model, sem tag, sem force, não fork e ligado', () => {
    expect(needsClassifier(BASE, DEFAULT_CONFIG)).toBe(true)
    expect(needsClassifier({ ...BASE, model: 'haiku' }, DEFAULT_CONFIG)).toBe(false)
    expect(needsClassifier({ ...BASE, turnTag: 'leve' }, DEFAULT_CONFIG)).toBe(false)
    expect(needsClassifier({ ...BASE, mode: { force: 'medio' } }, DEFAULT_CONFIG)).toBe(false)
    expect(needsClassifier({ ...BASE, subagentType: 'fork' }, DEFAULT_CONFIG)).toBe(false)
    const off = cloneConfig(DEFAULT_CONFIG)
    off.classifier.enabled = false
    expect(needsClassifier(BASE, off)).toBe(false)
  })

  test('classificador desligado: motivo diz desligado', () => {
    const off = cloneConfig(DEFAULT_CONFIG)
    off.classifier.enabled = false
    expect(decide(BASE, null, off)).toMatchObject({ tier: 'medio', source: 'reserva', reasons: ['classificador desligado'] })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test subagent-routing`
Expected: FAIL em `decide.test.ts`, porque `decide`, `needsClassifier`, `shiftTier` e `tierFromChoice` não são exportados.

- [ ] **Step 3: Implementar (acrescentar ao fim de `tiers.ts`)**

Trocar a primeira linha de `tiers.ts` por:
```ts
import type { RouteEffort, RouteMode, RouteModel, RouteSource, RouteTarget, RouteTier } from '../types'
```

E acrescentar ao fim do arquivo:
```ts
export type DecideInput = {
  subagentType: string | undefined
  description: string
  prompt: string
  model: string | undefined
  effort: string | undefined
  turnTag: RouteTier | null
  mode: RouteMode
}

export type RouteDecision =
  | { kind: 'fork' }
  | { kind: 'fora'; model: string }
  | {
      kind: 'route'
      tier: RouteTier
      target: RouteTarget
      source: RouteSource
      reasons: string[]
      isLimited: boolean
    }

const RANK: Record<RouteTier, number> = { leve: 0, medio: 1, pesado: 2, maximo: 3 }
const HIGHEST_FIRST: readonly RouteTier[] = ['maximo', 'pesado', 'medio', 'leve']

export function isForced(mode: RouteMode): mode is { force: RouteTier } {
  return typeof mode === 'object' && mode !== null
}

/** Nível que o Sonnet pediu: alvo exato configurado, depois família do modelo. */
export function tierFromChoice(
  model: string | undefined,
  effort: string | undefined,
  config: RouteConfig,
): RouteTier | 'fora' | null {
  if (model === undefined || model.trim() === '') return null
  const m = normalize(model).trim()
  const e = effort === undefined ? undefined : normalize(effort).trim()

  const exact = HIGHEST_FIRST.find(tier => config.tiers[tier].model === m && config.tiers[tier].effort === e)
  if (exact !== undefined) return exact
  if (m.includes('haiku')) return 'leve'
  if (m.includes('sonnet')) return 'medio'
  if (m.includes('opus')) return e === 'max' || e === 'xhigh' ? 'maximo' : 'pesado'
  return HIGHEST_FIRST.find(tier => config.tiers[tier].model === m) ?? 'fora'
}

export function shiftTier(tier: RouteTier, mode: 'eco' | 'boost'): RouteTier {
  if (mode === 'eco') {
    if (tier === 'maximo') return 'pesado'
    if (tier === 'pesado') return 'medio'
    return 'leve'
  }
  if (tier === 'leve') return 'medio'
  if (tier === 'medio') return 'pesado'
  return tier
}

export function editsFiles(subagentType: string | undefined, text: string, config: RouteConfig): boolean {
  const type = normalize(subagentType ?? 'general-purpose')
  if (config.readOnlyAgents.some(agent => normalize(agent) === type)) return false
  return config.writeVerbs.some(verb => containsTerm(text, verb))
}

export function findHeavyKeyword(text: string, config: RouteConfig): string | null {
  return config.heavyKeywords.find(word => containsTerm(text, word)) ?? null
}

export function needsClassifier(input: DecideInput, config: RouteConfig): boolean {
  return (
    config.classifier.enabled &&
    input.subagentType !== 'fork' &&
    input.turnTag === null &&
    !isForced(input.mode) &&
    tierFromChoice(input.model, input.effort, config) === null
  )
}

export function decide(input: DecideInput, classified: ClassTier | null, config: RouteConfig): RouteDecision {
  if (input.subagentType === 'fork') return { kind: 'fork' }

  const route = (tier: RouteTier, source: RouteSource, reasons: string[], isLimited = false): RouteDecision => ({
    kind: 'route', tier, target: { ...config.tiers[tier] }, source, reasons, isLimited,
  })

  if (input.turnTag !== null) return route(input.turnTag, 'tag', [`tag #${input.turnTag}`])
  if (isForced(input.mode)) return route(input.mode.force, 'force', [`force ${input.mode.force}`])

  const choice = tierFromChoice(input.model, input.effort, config)
  if (choice === 'fora') return { kind: 'fora', model: input.model ?? '' }

  let tier: RouteTier
  let source: RouteSource
  const reasons: string[] = []
  if (choice !== null) {
    tier = choice
    source = 'sonnet'
    reasons.push('sonnet')
  } else if (classified !== null) {
    tier = classified
    source = 'classificador'
    reasons.push('classificador')
  } else {
    tier = config.classifier.fallback
    source = 'reserva'
    reasons.push(config.classifier.enabled ? 'classificador falhou' : 'classificador desligado')
  }

  if (input.mode === 'eco' || input.mode === 'boost') {
    const shifted = shiftTier(tier, input.mode)
    if (shifted !== tier) {
      tier = shifted
      reasons.push(input.mode)
    }
  }

  const text = `${input.description}\n${input.prompt}`
  let isLimited = false
  if (RANK[tier] < RANK.medio && editsFiles(input.subagentType, text, config)) {
    tier = 'medio'
    reasons.push('limite: edita arquivos')
    isLimited = true
  }
  const keyword = RANK[tier] < RANK.pesado ? findHeavyKeyword(text, config) : null
  if (keyword !== null) {
    tier = 'pesado'
    reasons.push(`limite: "${keyword}"`)
    isLimited = true
  }

  return route(tier, source, reasons, isLimited)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `claude plugin test subagent-routing`
Expected: todos os testes passam (smoke, config, decide).

- [ ] **Step 5: Commit**

```bash
git add subagent-routing/hooks/tiers.ts subagent-routing/tests/decide.test.ts
git commit -m "feat(subagent-routing): decisão de rota com precedência, eco/boost e limites"
```

---

### Task 4: `tags.ts`: tags no prompt

**Files:**
- Create: `subagent-routing/hooks/tags.ts`
- Test: `subagent-routing/tests/tags.test.ts`

**Interfaces:**
- Consumes: `parseTier(word: string): RouteTier | null` de `./tiers`.
- Produces: `type TagResult = { text: string; tag: RouteTier | null; count: number }`, `extractTag(text: string): TagResult`.

- [ ] **Step 1: Escrever os testes que falham**

`subagent-routing/tests/tags.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'

import { extractTag } from '../hooks/tags'

test('tag no fim', () => {
  expect(extractTag('corrige isso #pesado')).toEqual({ text: 'corrige isso', tag: 'pesado', count: 1 })
})

test('tag no meio, com acento e maiúsculas', () => {
  expect(extractTag('faça #MÉDIO agora')).toEqual({ text: 'faça agora', tag: 'medio', count: 1 })
})

test('várias tags: vale a última', () => {
  expect(extractTag('#leve olha #max isso')).toEqual({ text: 'olha isso', tag: 'maximo', count: 2 })
})

test('pontuação logo depois ainda é tag', () => {
  expect(extractTag('veja isso #max.').tag).toBe('maximo')
})

test('prompt que é só a tag mantém o texto original', () => {
  expect(extractTag('#max')).toEqual({ text: '#max', tag: 'maximo', count: 1 })
})

test('texto parecido com tag não é tag', () => {
  const text = 'ajuste o css #max-width e a#leve, veja a issue #123'
  expect(extractTag(text)).toEqual({ text, tag: null, count: 0 })
})

test('tag em linha própria', () => {
  expect(extractTag('linha 1\n#pesado\nlinha 3')).toEqual({ text: 'linha 1\n\nlinha 3', tag: 'pesado', count: 1 })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test subagent-routing`
Expected: FAIL em `tags.test.ts`, porque `../hooks/tags` não existe.

- [ ] **Step 3: Implementar**

`subagent-routing/hooks/tags.ts`:
```ts
import type { RouteTier } from '../types'
import { parseTier } from './tiers'

const TAG = /(^|\s)#(leve|medio|médio|pesado|max|maximo|máximo)(?=[\s.,;:!?]|$)/gi

export type TagResult = { text: string; tag: RouteTier | null; count: number }

/** Remove as tags de nível do texto; a última vale. Texto que ficaria vazio é mantido. */
export function extractTag(text: string): TagResult {
  let tag: RouteTier | null = null
  let count = 0
  const stripped = text.replace(TAG, (_match: string, lead: string, word: string) => {
    count += 1
    tag = parseTier(word)
    return lead
  })
  if (count === 0) return { text, tag: null, count: 0 }

  const cleaned = stripped.replace(/[ \t]{2,}/g, ' ').trim()
  return { text: cleaned === '' ? text : cleaned, tag, count }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `claude plugin test subagent-routing`
Expected: todos os testes passam.

- [ ] **Step 5: Commit**

```bash
git add subagent-routing/hooks/tags.ts subagent-routing/tests/tags.test.ts
git commit -m "feat(subagent-routing): extração das tags de nível do prompt"
```

---

### Task 5: `classify.ts`: classificador Haiku

**Files:**
- Create: `subagent-routing/hooks/classify.ts`
- Test: `subagent-routing/tests/classify.test.ts`

**Interfaces:**
- Consumes: `normalize`, tipos `ClassTier`, `DecideInput`, `RouteConfig` de `./tiers`.
- Produces:
  - `const CLASSIFIER_SYSTEM: string`
  - `buildClassifierPrompt(input: Pick<DecideInput, 'subagentType' | 'description' | 'prompt'>): string`
  - `parseClassification(text: string): ClassTier | null`
  - `classify($: Pick<EngineInterface, 'model'>, input: Pick<DecideInput, 'subagentType' | 'description' | 'prompt'>, config: RouteConfig): Promise<ClassTier | null>` (nunca rejeita; falha = `null`)

- [ ] **Step 1: Escrever os testes que falham**

`subagent-routing/tests/classify.test.ts`:
```ts
import { expect, test } from 'claude-code/testing'

import { buildClassifierPrompt, parseClassification } from '../hooks/classify'

test('respostas aceitas', () => {
  expect(parseClassification('leve')).toBe('leve')
  expect(parseClassification('Médio.')).toBe('medio')
  expect(parseClassification('**pesado**')).toBe('pesado')
  expect(parseClassification('  PESADO\n')).toBe('pesado')
})

test('respostas recusadas', () => {
  expect(parseClassification('não sei')).toBe(null)
  expect(parseClassification('maximo')).toBe(null)
  expect(parseClassification('')).toBe(null)
})

test('prompt do classificador: tipo padrão e tarefa cortada em 2000 caracteres', () => {
  const text = buildClassifierPrompt({ subagentType: undefined, description: 'desc', prompt: 'x'.repeat(5000) })
  expect(text).toContain('Tipo de agente: general-purpose')
  expect(text).toContain('Descrição: desc')
  expect(text.length).toBeLessThan(2100)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test subagent-routing`
Expected: FAIL em `classify.test.ts`, porque `../hooks/classify` não existe.

- [ ] **Step 3: Implementar**

`subagent-routing/hooks/classify.ts`:
```ts
import type { EngineInterface } from 'claude-code'

import { normalize, type ClassTier, type DecideInput, type RouteConfig } from './tiers'

type TaskText = Pick<DecideInput, 'subagentType' | 'description' | 'prompt'>

export const CLASSIFIER_SYSTEM = [
  'Você classifica, por dificuldade, uma tarefa que será delegada a um subagente de programação.',
  'Responda com exatamente uma palavra: leve, medio ou pesado.',
  '- leve: buscar, ler, listar, resumir, rodar comandos e relatar; nenhuma decisão difícil.',
  '- medio: implementar algo já especificado, escrever testes, refatoração local, corrigir bug de causa conhecida.',
  '- pesado: arquitetura, design, debug de causa desconhecida, concorrência, segurança, planos, revisão crítica.',
].join('\n')

export function buildClassifierPrompt(input: TaskText): string {
  return [
    `Tipo de agente: ${input.subagentType ?? 'general-purpose'}`,
    `Descrição: ${input.description}`,
    'Tarefa:',
    input.prompt.slice(0, 2000),
  ].join('\n')
}

export function parseClassification(text: string): ClassTier | null {
  const word = normalize(text).replace(/^[^a-z]+/, '').match(/^[a-z]+/)?.[0]
  return word === 'leve' || word === 'medio' || word === 'pesado' ? word : null
}

/** Pergunta ao Haiku o nível da tarefa. Qualquer falha devolve `null`. */
export async function classify(
  $: Pick<EngineInterface, 'model'>,
  input: TaskText,
  config: RouteConfig,
): Promise<ClassTier | null> {
  try {
    const reply = await $.model.complete({
      model: 'haiku',
      system: CLASSIFIER_SYSTEM,
      prompt: buildClassifierPrompt(input),
      effort: 'low',
      timeoutMs: config.classifier.timeoutMs,
    })
    return reply.isAnswered ? parseClassification(reply.text) : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `claude plugin test subagent-routing`
Expected: todos os testes passam.

- [ ] **Step 5: Commit**

```bash
git add subagent-routing/hooks/classify.ts subagent-routing/tests/classify.test.ts
git commit -m "feat(subagent-routing): classificador Haiku"
```

---

### Task 6: `policy.ts` e `stats.ts`: política injetada, contadores e textos

**Files:**
- Create: `subagent-routing/hooks/policy.ts`
- Create: `subagent-routing/hooks/stats.ts`
- Test: `subagent-routing/tests/policy-stats.test.ts`

**Interfaces:**
- Consumes: `TIERS`, `isForced`, tipos `RouteConfig`, `RouteDecision` de `./tiers`; tipos `LastRoute`, `RouteMode`, `RouteSource`, `RouteStats`, `RouteTier` de `../types`.
- Produces:
  - `const POLICY_SECTION_ID = 'subagent-routing:policy'`, `policyText(config: RouteConfig): string`
  - `const SOURCES: readonly (RouteSource | 'limite')[]`
  - `emptyStats(): RouteStats`, `coerceStats(raw: unknown): RouteStats`, `addToStats(stats: RouteStats, decision: RouteDecision): RouteStats` (não muta a entrada)
  - `toastText(decision: RouteDecision, description: string): string`
  - `lastRouteOf(decision: RouteDecision, description: string, askedEffort: string | undefined): LastRoute`
  - `modeLabel(mode: RouteMode): string`, `statusText(mode: RouteMode, last: LastRoute | null): string`
  - `formatStats(session: RouteStats, total: RouteStats): string`

- [ ] **Step 1: Escrever os testes que falham**

`subagent-routing/tests/policy-stats.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { POLICY_SECTION_ID, policyText } from '../hooks/policy'
import {
  addToStats,
  coerceStats,
  emptyStats,
  formatStats,
  lastRouteOf,
  modeLabel,
  statusText,
  toastText,
} from '../hooks/stats'
import { DEFAULT_CONFIG, cloneConfig, type RouteDecision } from '../hooks/tiers'

const ROUTED: RouteDecision = {
  kind: 'route', tier: 'pesado', target: { model: 'opus', effort: 'high' },
  source: 'sonnet', reasons: ['sonnet', 'limite: "deadlock"'], isLimited: true,
}

describe('policyText', () => {
  test('lista cada nível com o alvo configurado', () => {
    const text = policyText(DEFAULT_CONFIG)
    expect(POLICY_SECTION_ID).toBe('subagent-routing:policy')
    expect(text).toContain('- leve (')
    expect(text).toContain('model: "haiku", effort: "high"')
    expect(text).toContain('model: "opus", effort: "max"')
    expect(text).toContain('fork')
  })

  test('reflete a config alterada', () => {
    const config = cloneConfig(DEFAULT_CONFIG)
    config.tiers.leve = { model: 'haiku', effort: 'low' }
    expect(policyText(config)).toContain('model: "haiku", effort: "low"')
  })
})

describe('stats', () => {
  test('rota limitada conta nível, fonte e limite, sem mutar a entrada', () => {
    const before = emptyStats()
    const after = addToStats(before, ROUTED)
    expect(after.porNivel.pesado).toBe(1)
    expect(after.porFonte.sonnet).toBe(1)
    expect(after.porFonte.limite).toBe(1)
    expect(before.porNivel.pesado).toBe(0)
  })

  test('fork e fora da tabela', () => {
    const stats = addToStats(addToStats(emptyStats(), { kind: 'fork' }), { kind: 'fora', model: 'fable' })
    expect(stats.fork).toBe(1)
    expect(stats.foraDaTabela).toBe(1)
  })

  test('coerceStats tolera lixo e campos faltando', () => {
    expect(coerceStats('lixo')).toEqual(emptyStats())
    expect(coerceStats({ porNivel: { leve: 3, medio: -1 }, fork: 'x' }).porNivel).toEqual({
      leve: 3, medio: 0, pesado: 0, maximo: 0,
    })
  })

  test('formatStats tem as linhas de nível e fonte', () => {
    const text = formatStats(addToStats(emptyStats(), ROUTED), emptyStats())
    expect(text).toContain('pesado')
    expect(text).toContain('fora da tabela')
    expect(text).toContain('limite')
  })
})

describe('textos', () => {
  test('toast de rota, fork e fora da tabela', () => {
    expect(toastText(ROUTED, 'corrigir deadlock')).toBe('→ opus/high · "corrigir deadlock" · sonnet, limite: "deadlock"')
    expect(toastText({ kind: 'fork' }, 'x')).toBe('fork · sem roteamento · "x"')
    expect(toastText({ kind: 'fora', model: 'fable' }, 'x')).toBe('fable · fora da tabela · "x"')
  })

  test('descrição longa é cortada', () => {
    expect(toastText({ kind: 'fork' }, 'a'.repeat(100))).toBe(`fork · sem roteamento · "${'a'.repeat(39)}…"`)
  })

  test('status', () => {
    const last = lastRouteOf(ROUTED, 'corrigir deadlock', undefined)
    expect(last).toEqual({ model: 'opus', effort: 'high', tier: 'pesado', reason: 'sonnet, limite: "deadlock"', description: 'corrigir deadlock' })
    expect(statusText(null, null)).toBe('rota: sem delegações')
    expect(statusText('eco', last)).toBe('rota: eco · última opus/high')
    expect(statusText({ force: 'pesado' }, null)).toBe('rota: force pesado · sem delegações')
    expect(modeLabel(null)).toBe('normal')
  })

  test('lastRouteOf de fora da tabela usa o effort pedido', () => {
    expect(lastRouteOf({ kind: 'fora', model: 'fable' }, 'x', 'medium')).toMatchObject({ model: 'fable', effort: 'medium', tier: null })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test subagent-routing`
Expected: FAIL em `policy-stats.test.ts`, porque `../hooks/policy` e `../hooks/stats` não existem.

- [ ] **Step 3: Implementar `policy.ts`**

`subagent-routing/hooks/policy.ts`:
```ts
import type { RouteTier } from '../types'
import { TIERS, type RouteConfig } from './tiers'

export const POLICY_SECTION_ID = 'subagent-routing:policy'

const TASKS: Record<RouteTier, string> = {
  leve: 'busca, leitura, resumo, rodar comandos e relatar',
  medio: 'implementação já especificada, testes, refatoração local, bug de causa conhecida',
  pesado: 'arquitetura, debug de causa desconhecida, concorrência, segurança, planos, revisão crítica',
  maximo: 'só para problemas excepcionalmente difíceis, quando pesado não basta',
}

export function policyText(config: RouteConfig): string {
  const tiers = TIERS.map(tier => {
    const { model, effort } = config.tiers[tier]
    return `- ${tier} (${TASKS[tier]}) → model: "${model}", effort: "${effort}"`
  })
  return [
    '# Delegação de trabalho (subagent-routing)',
    '',
    'Você coordena; subagentes executam. Delegue a um subagente (ferramenta Agent) toda tarefa que exija mais de ~3 chamadas de ferramenta ou a leitura de vários arquivos. Faça você mesmo o que for rápido: uma edição pontual, um grep, ler um arquivo que já está em discussão.',
    '',
    'Ao chamar Agent, sempre informe `model` e `effort` conforme o nível da tarefa. Esta instrução é a autorização explícita para definir `effort`.',
    '',
    ...tiers,
    '',
    'Prefira subagentes novos com prompt autocontido. Use subagent_type "fork" só quando o contexto desta conversa for indispensável: fork não é roteado.',
    'Um hook pode ajustar model/effort da sua chamada; isso é esperado, não repita a chamada.',
  ].join('\n')
}
```

- [ ] **Step 4: Implementar `stats.ts`**

`subagent-routing/hooks/stats.ts`:
```ts
import type { LastRoute, RouteMode, RouteSource, RouteStats } from '../types'
import { TIERS, isForced, type RouteDecision } from './tiers'

export const SOURCES: readonly (RouteSource | 'limite')[] = [
  'tag', 'force', 'sonnet', 'classificador', 'reserva', 'limite',
]

export function emptyStats(): RouteStats {
  return {
    porNivel: { leve: 0, medio: 0, pesado: 0, maximo: 0 },
    porFonte: { tag: 0, force: 0, sonnet: 0, classificador: 0, reserva: 0, limite: 0 },
    fork: 0,
    foraDaTabela: 0,
  }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/** Lê estatísticas salvas tolerando lixo; sempre devolve um objeto novo. */
export function coerceStats(raw: unknown): RouteStats {
  const stats = emptyStats()
  const saved = record(raw)
  const porNivel = record(saved.porNivel)
  const porFonte = record(saved.porFonte)
  for (const tier of TIERS) stats.porNivel[tier] = count(porNivel[tier])
  for (const source of SOURCES) stats.porFonte[source] = count(porFonte[source])
  stats.fork = count(saved.fork)
  stats.foraDaTabela = count(saved.foraDaTabela)
  return stats
}

export function addToStats(stats: RouteStats, decision: RouteDecision): RouteStats {
  const next = coerceStats(stats)
  if (decision.kind === 'fork') {
    next.fork += 1
  } else if (decision.kind === 'fora') {
    next.foraDaTabela += 1
  } else {
    next.porNivel[decision.tier] += 1
    next.porFonte[decision.source] += 1
    if (decision.isLimited) next.porFonte.limite += 1
  }
  return next
}

function clip(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function toastText(decision: RouteDecision, description: string): string {
  const desc = `"${clip(description)}"`
  if (decision.kind === 'fork') return `fork · sem roteamento · ${desc}`
  if (decision.kind === 'fora') return `${decision.model} · fora da tabela · ${desc}`
  return `→ ${decision.target.model}/${decision.target.effort} · ${desc} · ${decision.reasons.join(', ')}`
}

export function lastRouteOf(decision: RouteDecision, description: string, askedEffort: string | undefined): LastRoute {
  if (decision.kind === 'fork') return { model: 'fork', effort: '-', tier: null, reason: 'fork', description }
  if (decision.kind === 'fora') {
    return { model: decision.model, effort: askedEffort ?? '-', tier: null, reason: 'fora da tabela', description }
  }
  return {
    model: decision.target.model,
    effort: decision.target.effort,
    tier: decision.tier,
    reason: decision.reasons.join(', '),
    description,
  }
}

export function modeLabel(mode: RouteMode): string {
  if (mode === null) return 'normal'
  if (isForced(mode)) return `force ${mode.force}`
  return mode
}

export function statusText(mode: RouteMode, last: LastRoute | null): string {
  const parts = mode === null ? [] : [modeLabel(mode)]
  parts.push(last === null ? 'sem delegações' : `última ${last.model}/${last.effort}`)
  return `rota: ${parts.join(' · ')}`
}

function row(label: string, session: number | string, total: number | string): string {
  return `${label.padEnd(16)}${String(session).padStart(8)}${String(total).padStart(8)}`
}

export function formatStats(session: RouteStats, total: RouteStats): string {
  return [
    row('nível', 'sessão', 'total'),
    ...TIERS.map(tier => row(tier, session.porNivel[tier], total.porNivel[tier])),
    row('fork', session.fork, total.fork),
    row('fora da tabela', session.foraDaTabela, total.foraDaTabela),
    '',
    row('fonte', 'sessão', 'total'),
    ...SOURCES.map(source => row(source, session.porFonte[source], total.porFonte[source])),
    '',
    '"limite" conta as decisões que um limite fixo elevou (também contadas na fonte original).',
  ].join('\n')
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `claude plugin test subagent-routing`
Expected: todos os testes passam.

- [ ] **Step 6: Commit**

```bash
git add subagent-routing/hooks/policy.ts subagent-routing/hooks/stats.ts subagent-routing/tests/policy-stats.test.ts
git commit -m "feat(subagent-routing): política injetada, estatísticas e textos de toast/status"
```

---

### Task 7: `command.ts`: o comando `/route`

**Files:**
- Create: `subagent-routing/hooks/command.ts`
- Test: `subagent-routing/tests/command.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_CONFIG`, `EFFORTS`, `MODELS`, `TIERS`, `cloneConfig`, `normalize`, `parseTarget`, `parseTier`, tipo `RouteConfig` de `./tiers`; `formatStats`, `modeLabel` de `./stats`; tipos `RouteMode`, `RouteStats` de `../types`.
- Produces:
  - `type RouteCommandContext = { config: RouteConfig; mode: RouteMode; session: RouteStats; total: RouteStats }`
  - `type RouteCommandOutcome = { text: string; config?: RouteConfig; mode?: RouteMode; isResettingStats?: boolean }`. `mode` ausente = não muda; `mode: null` = volta ao normal.
  - `const USAGE: string`
  - `runRouteCommand(args: string, ctx: RouteCommandContext): RouteCommandOutcome` (pura; nunca muta `ctx`)

- [ ] **Step 1: Escrever os testes que falham**

`subagent-routing/tests/command.test.ts`:
```ts
import { describe, expect, test } from 'claude-code/testing'

import { USAGE, runRouteCommand, type RouteCommandContext } from '../hooks/command'
import { emptyStats } from '../hooks/stats'
import { DEFAULT_CONFIG, cloneConfig } from '../hooks/tiers'

function ctx(): RouteCommandContext {
  return { config: cloneConfig(DEFAULT_CONFIG), mode: null, session: emptyStats(), total: emptyStats() }
}

describe('mostrar', () => {
  test('sem argumentos e show mostram a config', () => {
    for (const args of ['', '  ', 'show']) {
      const out = runRouteCommand(args, ctx())
      expect(out.text).toContain('leve    → haiku/high')
      expect(out.text).toContain('Modo: normal')
      expect(out.config).toBe(undefined)
      expect('mode' in out).toBe(false)
    }
  })

  test('subcomando desconhecido mostra o uso', () => {
    expect(runRouteCommand('xyz', ctx()).text).toBe(USAGE)
  })
})

describe('set', () => {
  test('altera um nível sem mutar o contexto', () => {
    const c = ctx()
    const out = runRouteCommand('set Leve Haiku/Low', c)
    expect(out.config?.tiers.leve).toEqual({ model: 'haiku', effort: 'low' })
    expect(c.config.tiers.leve).toEqual({ model: 'haiku', effort: 'high' })
  })

  test('valores inválidos recusam com a lista aceita', () => {
    for (const args of ['set turbo haiku/low', 'set leve gpt/low', 'set leve', 'set leve haiku/low extra']) {
      const out = runRouteCommand(args, ctx())
      expect(out.config).toBe(undefined)
      expect(out.text).toContain('Uso: /route set')
      expect(out.text).toContain('fable')
    }
  })
})

describe('listas', () => {
  test('keywords add aceita expressão e recusa repetida', () => {
    expect(runRouteCommand('keywords add memory leak', ctx()).config?.heavyKeywords).toContain('memory leak')
    const again = runRouteCommand('keywords add Deadlock', ctx())
    expect(again.config).toBe(undefined)
    expect(again.text).toContain('já está')
  })

  test('keywords rm remove sem caixa nem acento', () => {
    expect(runRouteCommand('keywords rm SEGURANCA', ctx()).config?.heavyKeywords).not.toContain('segurança')
  })

  test('verbs e readonly', () => {
    expect(runRouteCommand('verbs add consertar', ctx()).config?.writeVerbs).toContain('consertar')
    expect(runRouteCommand('readonly add my-reviewer', ctx()).config?.readOnlyAgents).toContain('my-reviewer')
  })

  test('uso errado das listas', () => {
    expect(runRouteCommand('keywords drop x', ctx()).text).toContain('Uso: /route keywords add|rm')
    expect(runRouteCommand('verbs add', ctx()).config).toBe(undefined)
  })
})

describe('classificador', () => {
  test('on/off', () => {
    expect(runRouteCommand('classifier off', ctx()).config?.classifier.enabled).toBe(false)
    expect(runRouteCommand('classifier on', ctx()).config?.classifier.enabled).toBe(true)
    expect(runRouteCommand('classifier talvez', ctx()).config).toBe(undefined)
  })
})

describe('modos', () => {
  test('force, eco, boost e reset', () => {
    expect(runRouteCommand('force pesado', ctx()).mode).toEqual({ force: 'pesado' })
    expect(runRouteCommand('force max', ctx()).mode).toEqual({ force: 'maximo' })
    expect(runRouteCommand('eco', ctx()).mode).toBe('eco')
    expect(runRouteCommand('boost', ctx()).mode).toBe('boost')
    const reset = runRouteCommand('reset', ctx())
    expect('mode' in reset && reset.mode === null).toBe(true)
  })

  test('force sem nível válido não muda o modo', () => {
    const out = runRouteCommand('force', ctx())
    expect('mode' in out).toBe(false)
    expect(out.text).toContain('Uso: /route force')
  })
})

describe('stats e defaults', () => {
  test('stats mostra a tabela; stats reset pede para zerar', () => {
    expect(runRouteCommand('stats', ctx()).text).toContain('fora da tabela')
    expect(runRouteCommand('stats reset', ctx()).isResettingStats).toBe(true)
  })

  test('defaults restaura a config padrão', () => {
    const c = ctx()
    c.config.tiers.leve = { model: 'sonnet', effort: 'low' }
    expect(runRouteCommand('defaults', c).config).toEqual(DEFAULT_CONFIG)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test subagent-routing`
Expected: FAIL em `command.test.ts`, porque `../hooks/command` não existe.

- [ ] **Step 3: Implementar**

`subagent-routing/hooks/command.ts`:
```ts
import type { RouteMode, RouteStats } from '../types'
import { formatStats, modeLabel } from './stats'
import {
  DEFAULT_CONFIG,
  EFFORTS,
  MODELS,
  TIERS,
  cloneConfig,
  normalize,
  parseTarget,
  parseTier,
  type RouteConfig,
} from './tiers'

export type RouteCommandContext = { config: RouteConfig; mode: RouteMode; session: RouteStats; total: RouteStats }
export type RouteCommandOutcome = { text: string; config?: RouteConfig; mode?: RouteMode; isResettingStats?: boolean }

export const USAGE = [
  'Uso: /route [subcomando]',
  '  show                               config, modo e resumo (padrão)',
  '  set <nível> <modelo>/<effort>      altera um nível',
  '  keywords|verbs|readonly add|rm <termo>   edita as listas',
  '  classifier on|off                  liga/desliga o classificador',
  '  force <nível> | eco | boost        modo desta sessão',
  '  reset                              volta ao modo normal',
  '  stats [reset]                      estatísticas (ou zera)',
  '  defaults                           restaura a config padrão',
].join('\n')

const LISTS = { keywords: 'heavyKeywords', verbs: 'writeVerbs', readonly: 'readOnlyAgents' } as const

function delegations(stats: RouteStats): number {
  return TIERS.reduce((sum, tier) => sum + stats.porNivel[tier], 0) + stats.fork + stats.foraDaTabela
}

function showText({ config, mode, session }: RouteCommandContext): string {
  const c = config.classifier
  return [
    'Níveis:',
    ...TIERS.map(tier => `  ${tier.padEnd(7)} → ${config.tiers[tier].model}/${config.tiers[tier].effort}`),
    `Modo: ${modeLabel(mode)}`,
    `Classificador: ${c.enabled ? 'ligado' : 'desligado'} (timeout ${c.timeoutMs} ms, reserva ${c.fallback})`,
    `Palavras pesadas: ${config.heavyKeywords.join(', ')}`,
    `Verbos de escrita: ${config.writeVerbs.join(', ')}`,
    `Agentes somente leitura: ${config.readOnlyAgents.join(', ')}`,
    `Delegações nesta sessão: ${delegations(session)}`,
  ].join('\n')
}

export function runRouteCommand(args: string, ctx: RouteCommandContext): RouteCommandOutcome {
  const [sub = 'show', ...rest] = args.trim().split(/\s+/).filter(word => word !== '')
  const name = normalize(sub)

  switch (name) {
    case 'show':
      return { text: showText(ctx) }

    case 'set': {
      const tier = parseTier(rest[0] ?? '')
      const target = parseTarget(rest[1] ?? '')
      if (tier === null || target === null || rest.length !== 2) {
        return {
          text: `Uso: /route set <nível> <modelo>/<effort>\nNíveis: ${TIERS.join(', ')} · modelos: ${MODELS.join(', ')} · efforts: ${EFFORTS.join(', ')}`,
        }
      }
      const config = cloneConfig(ctx.config)
      config.tiers[tier] = target
      return { text: `${tier} → ${target.model}/${target.effort}`, config }
    }

    case 'keywords':
    case 'verbs':
    case 'readonly': {
      const key = LISTS[name]
      const op = normalize(rest[0] ?? '')
      const term = rest.slice(1).join(' ').trim()
      if ((op !== 'add' && op !== 'rm') || term === '') return { text: `Uso: /route ${name} add|rm <termo>` }
      const isSame = (item: string) => normalize(item) === normalize(term)
      const list = ctx.config[key]
      if (op === 'add') {
        if (list.some(isSame)) return { text: `"${term}" já está em ${name}.` }
        const config = cloneConfig(ctx.config)
        config[key] = [...list, term]
        return { text: `"${term}" adicionado a ${name}.`, config }
      }
      if (!list.some(isSame)) return { text: `"${term}" não está em ${name}.` }
      const config = cloneConfig(ctx.config)
      config[key] = list.filter(item => !isSame(item))
      return { text: `"${term}" removido de ${name}.`, config }
    }

    case 'classifier': {
      const value = normalize(rest[0] ?? '')
      if (value !== 'on' && value !== 'off') return { text: 'Uso: /route classifier on|off' }
      const config = cloneConfig(ctx.config)
      config.classifier.enabled = value === 'on'
      return { text: `Classificador ${value === 'on' ? 'ligado' : 'desligado'}.`, config }
    }

    case 'force': {
      const tier = parseTier(rest[0] ?? '')
      if (tier === null) return { text: `Uso: /route force <nível> (${TIERS.join(', ')})` }
      const { model, effort } = ctx.config.tiers[tier]
      return {
        text: `Modo forçado: toda delegação desta sessão vai para ${tier} (${model}/${effort}). /route reset volta ao normal.`,
        mode: { force: tier },
      }
    }

    case 'eco':
      return { text: 'Modo eco: delegações descem um nível nesta sessão (limites fixos continuam valendo).', mode: 'eco' }

    case 'boost':
      return { text: 'Modo boost: delegações sobem um nível nesta sessão (no máximo até pesado).', mode: 'boost' }

    case 'reset':
      return { text: 'Modo normal.', mode: null }

    case 'stats':
      if (normalize(rest[0] ?? '') === 'reset') return { text: 'Estatísticas zeradas.', isResettingStats: true }
      return { text: formatStats(ctx.session, ctx.total) }

    case 'defaults':
      return { text: 'Configuração padrão restaurada.', config: cloneConfig(DEFAULT_CONFIG) }

    default:
      return { text: USAGE }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `claude plugin test subagent-routing`
Expected: todos os testes passam.

- [ ] **Step 5: Commit**

```bash
git add subagent-routing/hooks/command.ts subagent-routing/tests/command.test.ts
git commit -m "feat(subagent-routing): comando /route"
```

---

### Task 8: `register.ts`: ligar os eventos

**Files:**
- Modify: `subagent-routing/hooks/register.ts` (substituir inteiro)
- Test: `subagent-routing/tests/register.test.ts`

**Interfaces:**
- Consumes: `classify` (Task 5); `runRouteCommand` (Task 7); `POLICY_SECTION_ID`, `policyText`, `addToStats`, `coerceStats`, `emptyStats`, `lastRouteOf`, `statusText`, `toastText` (Task 6); `extractTag` (Task 4); `decide`, `mergeConfig`, `needsClassifier`, tipos `DecideInput`, `RouteConfig`, `RouteDecision` (Tasks 2–3); `atom`, `read`, `update`, tipos `EngineInterface`, `On`, `Register` de `'claude-code'`.
- Produces: o mod completo; nenhum símbolo novo para outras tasks.

- [ ] **Step 1: Escrever os testes que falham**

`subagent-routing/tests/register.test.ts`:
```ts
import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type Seen = Record<string, unknown>

/** Fundo da cadeia de tool.call: guarda o que chegou ao "motor" depois do mod. */
function captureAgent(on: On): Seen[] {
  const seen: Seen[] = []
  on('tool.call', { tool: 'Agent' }, ($, e) => {
    seen.push(e as unknown as Seen)
    return { result: { status: 'completed' } as never }
  })
  return seen
}

function captureToasts(on: On): string[] {
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
  })
  return toasts
}

function agent(fields: Record<string, unknown>) {
  return { tool: 'Agent' as const, tool_use_id: 't1', description: 'tarefa', prompt: 'olhar o código', ...fields } as never
}

function classifierSays(on: On, text: string) {
  on('model.complete', () => ({ isAnswered: true as const, text, usage: USAGE }))
}

function routeCommand(args: string) {
  return { command: 'route', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 120 } } as never
}

describe('tool.call de Agent', () => {
  test('Sonnet escolhe haiku para Explore: haiku/high e toast', async ($, on) => {
    mock.store(on)
    const seen = captureAgent(on)
    const toasts = captureToasts(on)
    await $.tool.call(agent({ subagent_type: 'Explore', description: 'achar token', model: 'haiku' }))
    expect(seen[0]).toMatchObject({ model: 'haiku', effort: 'high' })
    expect(toasts).toContain('→ haiku/high · "achar token" · sonnet')
  })

  test('palavra pesada eleva a opus/high', async ($, on) => {
    mock.store(on)
    const seen = captureAgent(on)
    await $.tool.call(agent({ prompt: 'corrigir o deadlock no worker', model: 'sonnet' }))
    expect(seen[0]).toMatchObject({ model: 'opus', effort: 'high' })
  })

  test('sem model: o classificador decide', async ($, on) => {
    mock.store(on)
    classifierSays(on, 'pesado')
    const seen = captureAgent(on)
    await $.tool.call(agent({}))
    expect(seen[0]).toMatchObject({ model: 'opus', effort: 'high' })
  })

  test('classificador com resposta inválida: reserva medio', async ($, on) => {
    mock.store(on)
    classifierSays(on, 'não sei')
    const seen = captureAgent(on)
    await $.tool.call(agent({}))
    expect(seen[0]).toMatchObject({ model: 'sonnet', effort: 'high' })
  })

  test('fork passa intacto', async ($, on) => {
    mock.store(on)
    const seen = captureAgent(on)
    await $.tool.call(agent({ subagent_type: 'fork' }))
    expect(seen[0]?.model).toBe(undefined)
    expect(seen[0]?.effort).toBe(undefined)
  })

  test('erro interno: a chamada segue intacta', async ($, on) => {
    mock.store(on)
    const seen = captureAgent(on)
    const toasts = captureToasts(on)
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'opus', description: undefined }))
    expect(seen[0]?.model).toBe('opus')
    expect(seen[0]?.effort).toBe(undefined)
    expect(toasts).toContain('subagent-routing: erro, seguiu sem roteamento')
  })

  test('estatísticas acumuladas vão para o store', async ($, on) => {
    mock.store(on)
    captureAgent(on)
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'haiku' }))
    const stats = (await $.store.get('stats')) as { porNivel: Record<string, number> }
    expect(stats.porNivel.leve).toBe(1)
  })
})

describe('prompt.submit', () => {
  test('tag força o nível do turno e some do texto', async ($, on) => {
    mock.store(on)
    let submitted = ''
    on('prompt.submit', ($, e) => {
      submitted = e.text
      return { text: e.text }
    })
    const seen = captureAgent(on)
    await $.prompt.submit({ text: 'olha isso #pesado', origin: { kind: 'composer' }, wait: false } as never)
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'haiku' }))
    expect(submitted).toBe('olha isso')
    expect(seen[0]).toMatchObject({ model: 'opus', effort: 'high' })
  })

  test('próximo prompt sem tag limpa a tag', async ($, on) => {
    mock.store(on)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    const seen = captureAgent(on)
    await $.prompt.submit({ text: 'a #pesado', origin: { kind: 'composer' }, wait: false } as never)
    await $.prompt.submit({ text: 'b', origin: { kind: 'composer' }, wait: false } as never)
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'haiku' }))
    expect(seen[0]).toMatchObject({ model: 'haiku' })
  })
})

describe('prompt.compose', () => {
  const COMPOSE = {
    model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: ['terminal'],
    outputStyle: null, traits: [],
  }

  test('injeta a política quando a requisição oferece Agent', async ($, on) => {
    mock.store(on)
    on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'base', scope: 'shared' as const }] }))
    const result = await $.prompt.compose({ ...COMPOSE, tools: ['Agent', 'Read'] } as never)
    expect(result.sections.map(s => s.id)).toEqual(['base', 'subagent-routing:policy'])
  })

  test('não injeta sem a ferramenta Agent', async ($, on) => {
    mock.store(on)
    on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'base', scope: 'shared' as const }] }))
    const result = await $.prompt.compose({ ...COMPOSE, tools: ['Read'] } as never)
    expect(result.sections.map(s => s.id)).toEqual(['base'])
  })
})

describe('/route', () => {
  test('eco rebaixa a escolha do Sonnet', async ($, on) => {
    mock.store(on)
    const seen = captureAgent(on)
    const out = await $.command.run(routeCommand('eco'))
    expect(out.text).toContain('Modo eco')
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'sonnet' }))
    expect(seen[0]).toMatchObject({ model: 'haiku', effort: 'high' })
  })

  test('set grava a config e vale na próxima delegação', async ($, on) => {
    mock.store(on)
    const seen = captureAgent(on)
    await $.command.run(routeCommand('set leve haiku/low'))
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'haiku' }))
    expect(seen[0]).toMatchObject({ model: 'haiku', effort: 'low' })
  })

  test('config inválida no store: usa o padrão e avisa uma vez', async ($, on) => {
    mock.store(on, { config: { tiers: { leve: { model: 'gpt', effort: 'x' } } } })
    const toasts = captureToasts(on)
    const seen = captureAgent(on)
    await $.tool.call(agent({ subagent_type: 'Explore', model: 'haiku' }))
    expect(seen[0]).toMatchObject({ model: 'haiku', effort: 'high' })
    expect(toasts.filter(t => t.includes('configuração com campos inválidos'))).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `claude plugin test subagent-routing`
Expected: FAIL em `register.test.ts` (o `register` vazio não reescreve nada; por exemplo, `seen[0].effort` chega `undefined` onde se espera `'high'`).

- [ ] **Step 3: Implementar**

`subagent-routing/hooks/register.ts`:
```ts
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { classify } from './classify'
import { runRouteCommand } from './command'
import { POLICY_SECTION_ID, policyText } from './policy'
import { addToStats, coerceStats, emptyStats, lastRouteOf, statusText, toastText } from './stats'
import { extractTag } from './tags'
import { decide, mergeConfig, needsClassifier, type DecideInput, type RouteConfig, type RouteDecision } from './tiers'

const modeAtom = atom({ plugin: 'subagent-routing', key: 'mode' } as const, null)
const turnTagAtom = atom({ plugin: 'subagent-routing', key: 'turnTag' } as const, null)
const lastRouteAtom = atom({ plugin: 'subagent-routing', key: 'lastRoute' } as const, null)
const sessionStatsAtom = atom({ plugin: 'subagent-routing', key: 'sessionStats' } as const, emptyStats())

const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

let hasWarnedConfig = false
let totalQueue: Promise<void> = Promise.resolve()

async function loadConfig($: EngineInterface): Promise<RouteConfig> {
  const { config, isRepaired } = mergeConfig(await $.store.get('config'))
  if (isRepaired && !hasWarnedConfig) {
    hasWarnedConfig = true
    $.ui.toast('subagent-routing: configuração com campos inválidos; usando o padrão neles (/route defaults restaura tudo)')
  }
  return config
}

/** Delegações em paralelo: serializa o read-modify-write das estatísticas acumuladas. */
function bumpTotal($: EngineInterface, decision: RouteDecision): Promise<void> {
  totalQueue = totalQueue
    .then(async () => {
      await $.store.set('stats', addToStats(coerceStats(await $.store.get('stats')), decision))
    })
    .catch(() => undefined)
  return totalQueue
}

async function report($: EngineInterface, decision: RouteDecision, description: string, askedEffort: string | undefined) {
  const last = lastRouteOf(decision, description, askedEffort)
  await update($, lastRouteAtom, () => last)
  await update($, sessionStatsAtom, stats => addToStats(stats, decision))
  await bumpTotal($, decision)
  $.ui.toast(toastText(decision, description))
  $.ui.status(statusText(await read($, modeAtom), last))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'route',
      description: 'Roteamento de subagentes: níveis, modos e estatísticas',
      argumentHint: '[show|set|keywords|verbs|readonly|classifier|force|eco|boost|reset|stats|defaults]',
      immediate: true,
    })
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes('Agent')) return composed
    const config = await loadConfig($)
    return {
      ...composed,
      sections: [...composed.sections, { id: POLICY_SECTION_ID, text: policyText(config), scope: 'session' as const }],
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!PERSON_ORIGINS.has(e.origin.kind) || e.text.trimStart().startsWith('/')) return next(e)
    const { text, tag, count } = extractTag(e.text)
    await update($, turnTagAtom, () => tag)
    if (count > 1) $.ui.toast(`subagent-routing: várias tags; vale #${tag}`)
    return next(count > 0 ? { ...e, text } : e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const config = await loadConfig($)
    const input: DecideInput = {
      subagentType: e.subagent_type,
      description: e.description,
      prompt: e.prompt,
      model: e.model,
      effort: e.effort,
      turnTag: await read($, turnTagAtom),
      mode: await read($, modeAtom),
    }
    const classified = needsClassifier(input, config) ? await classify($, input, config) : null
    const decision = decide(input, classified, config)
    await report($, decision, e.description, e.effort)
    return next(
      decision.kind === 'route' ? { ...e, model: decision.target.model, effort: decision.target.effort } : e,
    )
  }).catch(($, e, next) => {
    if (!next.called) {
      try {
        $.ui.toast('subagent-routing: erro, seguiu sem roteamento')
      } catch {
        // o toast é cortesia; a delegação segue de qualquer jeito
      }
    }
    return next(e)
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const outcome = runRouteCommand(e.args, {
      config: await loadConfig($),
      mode: await read($, modeAtom),
      session: await read($, sessionStatsAtom),
      total: coerceStats(await $.store.get('stats')),
    })
    if (outcome.config !== undefined) await $.store.set('config', outcome.config)
    if (outcome.mode !== undefined) {
      const mode = outcome.mode
      await update($, modeAtom, () => mode)
      $.ui.status(statusText(mode, await read($, lastRouteAtom)))
    }
    if (outcome.isResettingStats === true) {
      await update($, sessionStatsAtom, () => emptyStats())
      await $.store.set('stats', emptyStats())
    }
    return { text: outcome.text }
  })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `claude plugin test subagent-routing`
Expected: todos os testes passam.

Se o kit recusar alguma chamada de teste por formato de entrada (por exemplo, `$.prompt.submit` exigir um campo a mais), abra a declaração do evento em `subagent-routing/.claude-plugin/types/claude-code/index.d.ts` (procure `'prompt.submit': `, `'prompt.compose': `, `'command.run': `) e acrescente o campo que falta no objeto do teste. Não mude o código do mod para acomodar o teste.

- [ ] **Step 5: Validar e checar tipos**

Run: `claude plugin validate subagent-routing`
Expected: sem erros. Lista os hooks `session.start`, `prompt.compose`, `prompt.submit`, `tool.call` (Agent), `command.run` (route), as chaves de estado `mode`, `turnTag`, `lastRoute` e `sessionStats`, o `tool.call` como `gating hook with .catch:` e `command.run` como `answers its own command:`.

Run: `npx tsc -p subagent-routing`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add subagent-routing/hooks/register.ts subagent-routing/tests/register.test.ts
git commit -m "feat(subagent-routing): liga política, tags, roteamento e /route aos eventos"
```

---

### Task 9: Verificação real na sessão e documentação

**Files:**
- Create: `subagent-routing/README.md`
- Delete: `subagent-routing/tests/smoke.test.ts`

**Interfaces:**
- Consumes: o mod completo (Task 8), carregado nesta sessão pelo link da Task 1.

- [ ] **Step 1: Conferir que o mod recarregou**

Ao fim do turno da Task 8, o hot reload recarrega o mod. Confirme que não apareceu nenhuma linha `subagent-routing: ... refused` / `skipped` no transcript.
Run (na sessão): `/route`
Expected: a tabela de níveis com `leve    → haiku/high` etc. e `Modo: normal`.

- [ ] **Step 2: Delegações de teste**

Peça à sessão cada uma destas delegações (uma por vez) e anote o toast:

| Pedido à sessão | Toast esperado |
|---|---|
| "Use um subagente Explore para listar os arquivos .ts de ~/www/claude-mods" | `→ haiku/high · ... · sonnet` (ou `classificador`) |
| "Delegue a um subagente: corrigir um typo no README de ~/www/claude-mods" | `→ sonnet/high · ...` (contém `limite: edita arquivos` se o Sonnet tiver pedido haiku) |
| "Delegue a um subagente: investigar um possível deadlock no worker (é só um teste, ele pode responder que não há worker)" | `→ opus/high · ... · limite: "deadlock"` ou `sonnet`→pesado |
| "#max delegue a um subagente: listar os arquivos do repo" | `→ opus/max · ... · tag #max` |
| `/route eco`, depois "delegue a um subagente Explore: ler o README" | status `rota: eco · ...`; toast `→ haiku/high` |
| `/route reset` | status sem `eco` |

Run (na sessão): `/route stats`
Expected: as contagens batem com as delegações acima (sessão e total).

Se algum resultado divergir, use superpowers:systematic-debugging antes de mudar código.

- [ ] **Step 3: README do mod**

`subagent-routing/README.md`:
````markdown
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
arquitetura...) fica no mínimo em `pesado`. Forks não são roteados.

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
npx tsc -p subagent-routing
```
````

- [ ] **Step 4: Remover o teste de fumaça e rodar tudo**

```bash
git rm subagent-routing/tests/smoke.test.ts
```

Run: `claude plugin test subagent-routing && claude plugin validate subagent-routing && claude plugin validate . && npx tsc -p subagent-routing`
Expected: tudo passa, sem erros.

- [ ] **Step 5: Commit**

```bash
git add subagent-routing/README.md
git commit -m "docs(subagent-routing): README e verificação real"
```

- [ ] **Step 6: Instalação permanente (só depois de o usuário confirmar)**

Pergunte ao usuário se quer instalar agora. Se sim:

```bash
rm /home/TheBuda/.claude/dev-mods/f116f418-123e-41b4-ae45-3c12617ff716/subagent-routing
claude plugin marketplace add ~/www/claude-mods
claude plugin install subagent-routing@claude-mods
```

Remova o link de desenvolvimento antes de instalar, para o mod não carregar duas vezes. A partir da próxima sessão o mod está ativo; numa sessão aberta, `/reload-plugins`.
