import { AsyncLocalStorage } from "node:async_hooks"

export type OfficeExpectation = { officeId: string; version: number }
// HTTP calls carry an explicit expectation (or explicit absence). Internal jobs
// capture the authenticated user's persisted preference at transaction start.
const requests = new AsyncLocalStorage<{ expected: OfficeExpectation | null }>()
export const databaseOfficeRequest = () => requests.getStore()
export const runWithOfficeRequest = <T>(expected: OfficeExpectation | null, operation: () => T): T => requests.run({ expected }, operation)
