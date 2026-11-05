import { createClient } from "@supabase/supabase-js"
import { BusinessError } from "../policy"

export function storageConfiguration() {
  const url = process.env.SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new BusinessError(503, "Storage is not configured. Ask your platform administrator to configure Supabase Storage.")
  const parsed = new URL(url)
  if (process.env.ERP_LOCAL_DEMO === "1" && process.env.NODE_ENV === "development" && !process.env.VERCEL && !process.env.VERCEL_ENV && !process.env.VERCEL_PROJECT_ID) {
    const database = new URL(process.env.DATABASE_URL || "http://invalid")
    if (parsed.origin !== "http://127.0.0.1:55446" || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password || !["postgres:", "postgresql:"].includes(database.protocol) || !["127.0.0.1", "localhost"].includes(database.hostname) || database.port !== "55445" || database.pathname !== "/ls_salon_crm_test") throw new Error("Local demo storage requires its dedicated loopback service and database")
    return { url: parsed.origin, key }
  }
  if (parsed.protocol !== "https:" || !/^[a-z0-9]+\.supabase\.co$/.test(parsed.hostname) || parsed.pathname !== "/") throw new Error("Invalid Supabase storage origin")
  return { url: parsed.origin, key }
}
export function storageClient() {
  const { url, key } = storageConfiguration()
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) } })
}
