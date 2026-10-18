import { moduleEnabled, type BusinessModuleKey, type ModuleFlag } from "../modules"
import { BusinessError } from "../policy"

export type Term = { key: string; defaultLabel: string; moduleDefault?: string; module: BusinessModuleKey; section: string; collisionGroup: string; reservedLabels?: readonly string[] }
export type TermLabels = Record<string, string>
export const labelKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en")
export function cleanLabel(value: string): string {
  const label = value.normalize("NFKC").trim().replace(/ +/gu, " ")
  if (label.length < 1 || label.length > 60 || !/^[\p{L}\p{N}]/u.test(label) || /[\p{Cc}\p{Cf}<>\[\]]/u.test(label)) throw new BusinessError(400, "Labels must be 1–60 characters, start with a letter or number, and contain no markup or control characters.")
  return label
}
export function registerTerms(terms: readonly Term[]): readonly Term[] {
  const seen = new Set<string>()
  for (const term of terms) {
    if (!/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/.test(term.key) || seen.has(term.key)) throw new Error("Invalid or duplicate terminology key.")
    seen.add(term.key); cleanLabel(term.defaultLabel)
    if (term.moduleDefault) cleanLabel(term.moduleDefault)
  }
  validateTermLabels(terms, {})
  return terms
}
export const activeTerms = (terms: readonly Term[], flags: readonly ModuleFlag[]) => terms.filter(term => moduleEnabled(flags, term.module))
export const defaultTerm = (term: Term) => term.moduleDefault ?? term.defaultLabel
export function resolveTermLabels(terms: readonly Term[], overrides: TermLabels): TermLabels {
  return Object.fromEntries(terms.map(term => [term.key, overrides[term.key] ?? defaultTerm(term)]))
}
export function termReplacements(terms: readonly Term[], overrides: TermLabels): TermLabels {
  return Object.fromEntries(terms.flatMap(term => {
    const label = overrides[term.key] ?? term.moduleDefault
    return label === undefined ? [] : [[term.key, label]]
  }))
}
// Compare effective labels, including defaults, so a reset cannot introduce a collision.
export function validateTermLabels(terms: readonly Term[], overrides: TermLabels) {
  const groups = new Map<string, Set<string>>()
  for (const term of terms) {
    const label = cleanLabel(overrides[term.key] ?? defaultTerm(term)), normalized = labelKey(label)
    if (term.reservedLabels?.some(reserved => labelKey(reserved) === normalized)) throw new BusinessError(400, `“${label}” is already used by a standard control. Choose another label.`)
    const used = groups.get(term.collisionGroup) ?? new Set<string>()
    if (used.has(normalized)) throw new BusinessError(400, `“${label}” is already used in this group. Choose distinct labels.`)
    used.add(normalized); groups.set(term.collisionGroup, used)
  }
}

export function recordTerms(module: BusinessModuleKey, section: string, records: readonly (readonly [string, string, string])[]): Term[] {
  return records.flatMap(([key, singular, plural]) => [
    { key: `${module}.${key}.singular`, defaultLabel: singular, module, section, collisionGroup: "record.singular" },
    { key: `${module}.${key}.plural`, defaultLabel: plural, module, section, collisionGroup: "record.plural" },
  ])
}
