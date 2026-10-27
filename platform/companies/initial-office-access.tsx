"use client"
import { OfficeMembershipFields } from "./membership-fields"
import type { MembershipValidation } from "./membership-choice"
import { emptyOfficeMembership, membershipPreviewKey, type OfficeMembershipDraft } from "@/types/companies"
import type { Role } from "@/lib/permissions"
import type { UserStatus } from "@/types/users"

export const initialOfficeEligible = (role: Role, status: UserStatus) => status === "ACTIVE" && ["ADMIN", "MANAGER", "STAFF"].includes(role)
export function initialOfficeReady(role: Role, status: UserStatus, draft: OfficeMembershipDraft | undefined, validation: MembershipValidation | null) {
  return !initialOfficeEligible(role, status) || validation?.key === membershipPreviewKey({ kind: "new", role, status }, draft ?? emptyOfficeMembership) && validation.valid
}
export function InitialOfficeAccess({ role, status, draft, onChange, validation, onValidation, onDenied, denied, saving, refresh }: {
  role: Role; status: UserStatus; draft?: OfficeMembershipDraft; onChange: (value: OfficeMembershipDraft) => void
  validation: MembershipValidation | null; onValidation: (value: MembershipValidation) => void; onDenied: () => void
  denied: boolean; saving: boolean; refresh: number
}) {
  if (denied) return <p role="alert" className="text-sm text-destructive">Office administration is not permitted. Close and reopen this form to check your current access.</p>
  if (!initialOfficeEligible(role, status)) return <p className="text-sm text-muted-foreground">Initial office access is available for active business accounts. Changing to Customer or an inactive status clears the proposed office grants.</p>
  return <div className="min-w-0 space-y-4"><h3 className="text-base font-semibold">Initial office access</h3><p className="text-sm text-muted-foreground">Optional. Leaving this empty creates an unassigned account. Invitations apply these grants only after acceptance, when eligibility is checked again.</p><OfficeMembershipFields subject={{ kind: "new", role, status }} draft={draft ?? emptyOfficeMembership} onChange={onChange} validation={validation} onValidation={onValidation} onDenied={onDenied} saving={saving} refresh={refresh} /></div>
}
