export type BusinessActor = { tenantId: string; userId: string; role: string; requestId?: string }
export class BusinessError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export const hasBusinessAccess = (role?: string | null) => role === "ADMIN" || role === "MANAGER" || role === "STAFF"
