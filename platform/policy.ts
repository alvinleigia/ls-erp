export type BusinessActor = { tenantId: string; userId: string; role: string; requestId?: string; permissions?: import("./access/catalog").Permission[] }
export class BusinessError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export const hasBusinessAccess = (role?: string | null) => role === "ADMIN" || role === "MANAGER" || role === "STAFF"
