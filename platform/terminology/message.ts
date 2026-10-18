import { defaultTermResolver, type TermResolver } from "./resolver"

export type TermPart = { key: string; fallback: string; template?: string }
export type TermText = string | TermPart | readonly (string | TermPart)[]

// Code-owned presentation metadata. User content belongs in literal string parts.
export const termText = (key: string, fallback: string, template = "{label}"): TermPart => ({ key, fallback, template })
export function resolveTermText(text: TermText, term: TermResolver = defaultTermResolver): string {
  if (typeof text === "string") return text
  const parts = Array.isArray(text) ? text : [text as TermPart]
  return parts.map(part => typeof part === "string" ? part : term(part.key, part.fallback, part.template)).join("")
}
