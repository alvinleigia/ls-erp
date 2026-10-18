// Presentation only: never use resolved labels as routes, field keys or permissions.
export type TermResolver = (key: string, fallback: string, template?: string) => string

export function createTermResolver(replacements: Readonly<Record<string, string>>): TermResolver {
  return (key, fallback, template = "{label}") => {
    const label = Object.hasOwn(replacements, key) ? replacements[key] : undefined
    // Preserve contextual wording (e.g. "New lead") when no override is installed.
    return label === undefined ? fallback : template.replaceAll("{label}", () => label)
  }
}

export const defaultTermResolver = createTermResolver({})
