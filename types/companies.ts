export type RecordOffice = { id: string; name: string; companyName: string; active: boolean }

export type OfficeChoice = { id: string; code: string; name: string; companyId: string; companyCode: string; companyName: string }
export type MembershipCompany = { id: string; code: string; name: string; archived: boolean }
export type MembershipOffice = { id: string; code: string; name: string; archived: boolean; company: MembershipCompany }
export type OfficeMembershipDraft = { creationOfficeId: string | null; officeIds: string[]; companies: { companyId: string; includeSubsidiaries: boolean }[] }
export type OfficeMemberships = {
  userId: string; version: number; creationOfficeId: string | null; creationOffice: MembershipOffice | null
  offices: { officeId: string; office: MembershipOffice }[]
  companies: { companyId: string; includeSubsidiaries: boolean; company: MembershipCompany }[]
}
export const membershipDraftKey = (draft: OfficeMembershipDraft) => JSON.stringify([draft.creationOfficeId, draft.officeIds, draft.companies])
