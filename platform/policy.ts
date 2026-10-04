export type BusinessActor = { tenantId: string; userId: string; role: string; requestId?: string; crmRecordScope?: import("./access/record-scope").CrmRecordScope; managedTeamIds?: string[]; permissions?: import("./access/catalog").Permission[] }
export class BusinessError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export const hasBusinessAccess = (role?: string | null) => role === "ADMIN" || role === "MANAGER" || role === "STAFF"
