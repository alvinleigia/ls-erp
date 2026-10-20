import { createClient } from "@supabase/supabase-js"
import { BusinessError } from "../policy"

export function storageConfiguration() {
  const url = process.env.SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new BusinessError(503, "Storage is not configured. Ask your platform administrator to configure Supabase Storage.")
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" || !/^[a-z0-9]+\.supabase\.co$/.test(parsed.hostname) || parsed.pathname !== "/") throw new Error("Invalid Supabase storage origin")
  return { url: parsed.origin, key }
}
export function storageClient() {
  const { url, key } = storageConfiguration()
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) } })
}
