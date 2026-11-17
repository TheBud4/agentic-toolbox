import type { RouteTier } from '../types'
import { parseTier } from './tiers'

const WORDS = 'leve|medio|médio|pesado|max|maximo|máximo'
// Tag colada em pontuação leva junto os espaços de antes ("isso #max." vira "isso.");
// nas outras, leva os espaços de depois.
const TAG = new RegExp(`[ \\t]+#(${WORDS})(?=[.,;:!?])|(?<=^|\\s)#(${WORDS})(?=[\\s.,;:!?]|$)[ \\t]*`, 'gi')

export type TagResult = { text: string; tag: RouteTier | null; count: number }

/** Remove as tags de nível do texto; a última vale. Texto que ficaria vazio é mantido. */
export function extractTag(text: string): TagResult {
  let tag: RouteTier | null = null
  let count = 0
  const stripped = text.replace(TAG, (_match: string, beforePunct: string | undefined, word: string | undefined) => {
    count += 1
    tag = parseTier(beforePunct ?? word ?? '')
    return ''
  })
  if (count === 0) return { text, tag: null, count: 0 }

  // Só o fim é aparado: espaços no meio do texto (indentação de código) ficam intactos.
  const cleaned = stripped.trimEnd()
  return { text: cleaned === '' ? text : cleaned, tag, count }
}
