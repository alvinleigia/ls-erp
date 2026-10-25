import { z } from "zod"

const id = z.string().trim().min(1).max(200)
const fields = {
  creationOfficeId: id.nullable(),
  officeIds: z.array(id).max(200),
  companies: z.array(z.object({ companyId: id, includeSubsidiaries: z.boolean() }).strict()).max(100),
}
function uniqueGrants(value: { officeIds: string[]; companies: { companyId: string }[] }, ctx: z.RefinementCtx) {
  if (new Set(value.officeIds).size !== value.officeIds.length) ctx.addIssue({ code: "custom", path: ["officeIds"], message: "Choose each office only once." })
  if (new Set(value.companies.map(row => row.companyId)).size !== value.companies.length) ctx.addIssue({ code: "custom", path: ["companies"], message: "Choose each company only once." })
}
export const initialOfficeMembershipSchema = z.object(fields).strict().superRefine(uniqueGrants)
export const officeMembershipSchema = z.object({ version: z.number().int().nonnegative(), ...fields }).strict().superRefine(uniqueGrants)
