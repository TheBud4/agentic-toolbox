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
