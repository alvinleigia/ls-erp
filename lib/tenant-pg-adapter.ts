import { PrismaPg } from "@prisma/adapter-pg"
import type { Pool } from "pg"

type Scope = { tenantId?: string; bypass?: boolean }
type Adapter = Awaited<ReturnType<PrismaPg["connect"]>>
type Transaction = Awaited<ReturnType<Adapter["startTransaction"]>>

// The application can multiplex serverless clients through Supavisor. CLI and
// migration connections continue to use the original DATABASE_URL / DIRECT_URL.
export function runtimeDatabaseUrl(value: string) {
  const url = new URL(value)
  if (url.hostname.endsWith(".pooler.supabase.com") && url.port === "5432") url.port = "6543"
  return url.toString()
}

export class TenantPgAdapter extends PrismaPg {
  private readonly scopeSql: string

  constructor(pool: Pool, scope: Scope = {}) {
    super(pool) // Shared pool ownership belongs to lib/prisma, never a tenant client.
    const tenantId = scope.tenantId ?? ""
    if (tenantId && !/^[A-Za-z0-9_-]+$/.test(tenantId)) throw new Error("Invalid tenantId value for database context.")
    this.scopeSql = `SELECT set_config('app.tenant_id', '${tenantId}', true), set_config('app.rls_bypass', '${scope.bypass ? "on" : "off"}', true)`
  }

  async connect() {
    const adapter = await super.connect()
    const startTransaction = adapter.startTransaction.bind(adapter)
    const finish = async (tx: Transaction, commit: boolean) => {
      // Prisma's adapter commit/rollback methods release the connection only;
      // callers that create their own transaction must send the SQL too.
      try { await tx.executeRaw({ sql: commit ? "COMMIT" : "ROLLBACK", args: [], argTypes: [] }) }
      finally { await (commit ? tx.commit() : tx.rollback()) }
    }
    adapter.startTransaction = async isolationLevel => {
      const tx = await startTransaction(isolationLevel)
      try {
        await tx.queryRaw({ sql: this.scopeSql, args: [], argTypes: [] })
        return tx
      } catch (error) {
        await finish(tx, false)
        throw error
      }
    }
    const queryInScope = async <T>(query: (tx: Transaction) => Promise<T>) => {
      const tx = await adapter.startTransaction()
      let result: T
      try { result = await query(tx) }
      catch (error) { await finish(tx, false); throw error }
      await finish(tx, true)
      return result
    }
    // Interactive/batch transactions use startTransaction above and retain one
    // scope throughout. Standalone Prisma queries get a short transaction so
    // SET LOCAL and the query can never run on different pooled backends.
    adapter.queryRaw = query => queryInScope(tx => tx.queryRaw(query))
    adapter.executeRaw = query => queryInScope(tx => tx.executeRaw(query))
    return adapter
  }
}
