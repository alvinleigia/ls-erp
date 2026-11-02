"use client"

import { createContext, useContext, useEffect, useMemo, useCallback, useState, useSyncExternalStore, type ReactNode, type Dispatch, type SetStateAction } from "react"
import { usePathname, useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { cleanListLocation, internalListUrl, listStateKey, readListValue, writeListValue, resetListPages, rememberedListHref, readListLocations, type ListStateOptions, type ListLocations } from "@/lib/list-navigation"

type Registry = { identity: string; memory: Map<string, string> }
const Context = createContext<Registry | null>(null)
const storageKey = (identity: string) => `erp:list-navigation:v1:${identity}`
function savedLocations(registry: Registry): ListLocations {
  try { return readListLocations(sessionStorage.getItem(storageKey(registry.identity))) } catch { return [] }
}
function remember(registry: Registry, location: string) {
  const href = cleanListLocation(location), path = href && internalListUrl(href)?.pathname
  if (!href || !path || registry.memory.get(path) === href) return
  registry.memory.set(path, href)
  if (registry.memory.size > 64) registry.memory.delete(registry.memory.keys().next().value!)
  try {
    const entries = savedLocations(registry).filter(entry => entry.path !== path)
    sessionStorage.setItem(storageKey(registry.identity), JSON.stringify([...entries, { path, href }].slice(-64)))
  } catch { /* URL state and the in-memory return address still work without storage. */ }
}
function restore(registry: Registry | null, fallback: string) {
  const path = internalListUrl(fallback)?.pathname
  if (!registry || !path) return fallback
  const saved = registry.memory.get(path) || savedLocations(registry).findLast(entry => entry.path === path)?.href
  return rememberedListHref(fallback, saved)
}
export function ListNavigationProvider({ identity, children }: { identity: string; children: ReactNode }) {
  const pathname = usePathname(), query = useSearchParams().toString()
  const registry = useMemo(() => ({ identity, memory: new Map<string, string>() }), [identity])
  useEffect(() => { remember(registry, pathname + (query ? `?${query}` : "") + window.location.hash) }, [registry, pathname, query])
  return <Context.Provider value={registry}>{children}</Context.Provider>
}

/** Only allowlisted list controls use this hook; editors keep ordinary local state. */
export function useListState<T>(scope: string, field: string, initial: T | (() => T), options: ListStateOptions = {}): [T, Dispatch<SetStateAction<T>>] {
  const [sample] = useState(initial), pathname = usePathname(), query = useSearchParams(), registry = useContext(Context)
  const key = listStateKey(scope, field), raw = query.get(key), kind = options.kind, validate = options.validate
  const resetScopes = options.resetScopes?.join("\n") || (options.resetPages ? scope : "")
  const value = useMemo(() => readListValue(raw, sample, field, { kind, validate }), [raw, sample, field, kind, validate])
  const setter = useCallback<Dispatch<SetStateAction<T>>>(action => {
    // Functional updates read the current URL, so several controls can update in
    // one event without losing each other's changes. This is a shallow update.
    if (window.location.pathname !== pathname) return
    const url = new URL(window.location.href), previous = readListValue(url.searchParams.get(key), sample, field, { kind, validate })
    const next = typeof action === "function" ? (action as (value: T) => T)(previous) : action
    if (!writeListValue(url.searchParams, key, next, sample) || url.href === window.location.href) return
    if (resetScopes) resetListPages(url.searchParams, resetScopes.split("\n"), key)
    window.history.replaceState(null, "", url.pathname + url.search + url.hash)
    if (registry) remember(registry, url.pathname + url.search + url.hash)
  }, [pathname, key, sample, field, kind, validate, resetScopes, registry])
  return [value, setter]
}
const subscribe = () => () => {}
export function useListReturnHref(fallback: string | undefined) {
  const registry = useContext(Context), hydrated = useSyncExternalStore(subscribe, () => true, () => false)
  return fallback && hydrated ? restore(registry, fallback) : fallback
}
export function useListRouter() {
  const router = useRouter(), registry = useContext(Context)
  return useMemo(() => ({ ...router, push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(restore(registry, href), options), replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(restore(registry, href), options) }), [router, registry])
}
export function ListBackLink(props: React.ComponentProps<typeof Link>) {
  const href = useListReturnHref(typeof props.href === "string" ? props.href : undefined)
  return <Link {...props} href={href || props.href} />
}
