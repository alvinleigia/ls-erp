import { resolveTermText, type TermText } from "./terminology/message"
export type BusinessActor = { tenantId: string; userId: string; collaboratorId?: string | null; role: string; requestId?: string; recordRules?: import("./access/rules").RecordRules; operation?: { resource: import("./access/catalog").Resource; action: import("./access/catalog").PermissionAction }; managedTeamIds?: string[]; memberTeamIds?: string[]; permissions?: import("./access/catalog").Permission[] }
export class BusinessError extends Error {
  readonly presentation?: Exclude<TermText, string>
  constructor(public status: number, message: TermText) {
    super(resolveTermText(message))
    if (typeof message !== "string") this.presentation = message
  }
}
export const hasBusinessAccess = (role?: string | null) => role === "ADMIN" || role === "MANAGER" || role === "STAFF"
