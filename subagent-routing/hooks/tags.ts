import type { RouteTier } from '../types'
import { parseTier } from './tiers'

const TAG = /(?<=^|\s)#(leve|medio|médio|pesado|max|maximo|máximo)(?=[\s.,;:!?]|$)[ \t]*/gi

export type TagResult = { text: string; tag: RouteTier | null; count: number }

/** Remove as tags de nível do texto; a última vale. Texto que ficaria vazio é mantido. */
export function extractTag(text: string): TagResult {
  let tag: RouteTier | null = null
  let count = 0
  const stripped = text.replace(TAG, (_match: string, word: string) => {
    count += 1
    tag = parseTier(word)
    return ''
  })
  if (count === 0) return { text, tag: null, count: 0 }

  // Só o fim é aparado: espaços no meio do texto (indentação de código) ficam intactos.
  const cleaned = stripped.trimEnd()
  return { text: cleaned === '' ? text : cleaned, tag, count }
}
