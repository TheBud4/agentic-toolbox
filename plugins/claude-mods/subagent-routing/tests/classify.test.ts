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
