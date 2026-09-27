import { AsyncLocalStorage } from "node:async_hooks"

import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool, type PoolClient } from "pg"

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to initialize Prisma.")
}

const RLS_CLIENT_CACHE_LIMIT = Number(process.env.RLS_CLIENT_CACHE_LIMIT ?? 8)
const RLS_POOL_MAX = Number(process.env.RLS_POOL_MAX ?? (process.env.NODE_ENV === "production" ? 1 : 2))
const RLS_POOL_IDLE_TIMEOUT_MS = 30_000

type ScopedClientEntry = {
  client: PrismaClient
  lastUsedAt: number
}

type RlsSessionSettings = {
  tenantId?: string
  bypass?: boolean
}

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  prismaPool?: Pool
  prismaBypassClient?: PrismaClient
  prismaScopedClientCache?: Map<string, ScopedClientEntry>
}

const prismaContext = new AsyncLocalStorage<PrismaClient>()

const basePool =
  globalForPrisma.prismaPool ??
  new Pool({
    connectionString: databaseUrl,
    // Unscoped reads (including tenant lookup) must share the same connection
    // budget as scoped clients; pg's default of ten exhausts session poolers.
    max: RLS_POOL_MAX,
    idleTimeoutMillis: RLS_POOL_IDLE_TIMEOUT_MS,
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prismaPool = basePool
}

const basePrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg(basePool),
    log: ["error", "warn"],
  })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = basePrismaClient
}

const getScopedClientCache = () => {
  if (!globalForPrisma.prismaScopedClientCache) {
    globalForPrisma.prismaScopedClientCache = new Map()
  }
  return globalForPrisma.prismaScopedClientCache
}

const assertSafeSettingValue = (value: string, settingName: string) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${settingName} value for database session context.`)
  }
  return value
}

const applyRlsSessionSettings = async (
  client: PoolClient,
  settings: RlsSessionSettings
) => {
  await client.query(
    `
    SELECT
      set_config('app.tenant_id', $1, false),
      set_config('app.rls_bypass', $2, false)
    `,
    [settings.tenantId ?? "", settings.bypass ? "on" : "off"]
  )
}

const createScopedPool = (settings: RlsSessionSettings) => {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: RLS_POOL_MAX,
    idleTimeoutMillis: RLS_POOL_IDLE_TIMEOUT_MS,
  })

  const originalConnect = pool.connect.bind(pool)
  pool.connect = ((callback?: Parameters<Pool["connect"]>[0]) => {
    if (typeof callback === "function") {
      originalConnect(async (error, client, done) => {
        if (error || !client) {
          callback(error, client, done)
          return
        }
        try {
          await applyRlsSessionSettings(client, settings)
          callback(undefined, client, done)
        } catch (settingsError) {
          done(settingsError as Error)
          callback(settingsError as Error, client, done)
        }
      })
      return
    }

    return (async () => {
      const client = await originalConnect()
      try {
        await applyRlsSessionSettings(client, settings)
        return client
      } catch (error) {
        client.release(error as Error)
        throw error
      }
    })()
  }) as Pool["connect"]

  return pool
}

const createScopedPrismaClient = (settings: RlsSessionSettings) => {
  const pool = createScopedPool(settings)

  return new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: true }),
    log: ["error", "warn"],
  })
}

const evictOldScopedClientsIfNeeded = async () => {
  const cache = getScopedClientCache()
  if (cache.size <= RLS_CLIENT_CACHE_LIMIT) return

  const oldestEntry = [...cache.entries()].sort(
    (left, right) => left[1].lastUsedAt - right[1].lastUsedAt
  )[0]

  if (!oldestEntry) return

  cache.delete(oldestEntry[0])
  await oldestEntry[1].client.$disconnect()
}

const touchScopedClient = (cacheKey: string, entry: ScopedClientEntry) => {
  entry.lastUsedAt = Date.now()
  getScopedClientCache().set(cacheKey, entry)
  return entry.client
}

const getBypassPrismaClient = () => {
  if (!globalForPrisma.prismaBypassClient) {
    globalForPrisma.prismaBypassClient = createScopedPrismaClient({
      bypass: true,
    })
  }
  return globalForPrisma.prismaBypassClient
}

const getTenantPrismaClient = (tenantId: string) => {
  const safeTenantId = assertSafeSettingValue(tenantId, "tenantId")
  const cacheKey = `tenant:${safeTenantId}`
  const cache = getScopedClientCache()
  const cached = cache.get(cacheKey)

  if (cached) {
    return touchScopedClient(cacheKey, cached)
  }

  const client = createScopedPrismaClient({
    tenantId: safeTenantId,
    bypass: false,
  })
  cache.set(cacheKey, {
    client,
    lastUsedAt: Date.now(),
  })
  void evictOldScopedClientsIfNeeded()
  return client
}

const getActivePrismaClient = () => prismaContext.getStore() ?? basePrismaClient

export const enterTenantDbContext = (tenantId: string) => {
  prismaContext.enterWith(getTenantPrismaClient(tenantId))
}

export const runWithTenantDbContext = async <T>(
  tenantId: string,
  callback: () => Promise<T>
) => prismaContext.run(getTenantPrismaClient(tenantId), callback)

export const enterRlsBypassDbContext = () => {
  prismaContext.enterWith(getBypassPrismaClient())
}

export const runWithRlsBypassDbContext = async <T>(callback: () => Promise<T>) =>
  prismaContext.run(getBypassPrismaClient(), callback)

export const prisma = new Proxy(basePrismaClient, {
  get(_target, property) {
    const client = getActivePrismaClient() as unknown as Record<PropertyKey, unknown>
    const value = client[property]
    return typeof value === "function" ? value.bind(client) : value
  },
}) as PrismaClient
