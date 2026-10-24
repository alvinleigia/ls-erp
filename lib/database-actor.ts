import { AsyncLocalStorage } from "node:async_hooks"

// Request identity is transaction-local even when tenant clients share a pool.
const actors = new AsyncLocalStorage<string>()
export const databaseActorId = () => actors.getStore() || ""
export const runWithDatabaseActor = <T>(userId: string, action: () => T): T => actors.run(userId, action)
