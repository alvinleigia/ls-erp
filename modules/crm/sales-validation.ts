import { z } from "zod"
import { crmListSchema } from "./validation"

const id = z.string().trim().min(1).max(100)
const text = (max: number) => z.string().trim().max(max).default("")
export const stageKinds = ["OPEN", "WON", "LOST"] as const
export const stageSchema = z.object({
  id: id.optional(), name: z.string().trim().min(1).max(80),
  kind: z.enum(stageKinds), probability: z.number().int().min(0).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/), archived: z.boolean().default(false),
  isConversionDefault: z.boolean().optional(),
}).strict().refine(stage => stage.kind === "WON" ? stage.probability === 100 : stage.kind === "LOST" ? stage.probability === 0 : stage.probability < 100,
  { path: ["probability"], message: "Won must be 100%, lost 0%, and open stages below 100%." })
export const pipelineSchema = z.object({
  name: z.string().trim().min(1).max(100), archived: z.boolean().default(false),
  stages: z.array(stageSchema).min(3).max(30),
}).strict().superRefine((value, ctx) => {
  const active = value.stages.filter(stage => !stage.archived)
  const defaults = value.stages.filter(stage => stage.isConversionDefault)
  if (defaults.length > 1 || defaults.some(stage => stage.archived || stage.kind !== "OPEN")) ctx.addIssue({ code: "custom", path: ["stages"], message: "Choose only one active open stage as the default conversion stage." })
  for (const kind of stageKinds) if (!active.some(stage => stage.kind === kind)) ctx.addIssue({ code: "custom", path: ["stages"], message: `Keep at least one active ${kind.toLowerCase()} stage.` })
  if (new Set(value.stages.map(stage => stage.name.toLowerCase())).size !== value.stages.length) ctx.addIssue({ code: "custom", path: ["stages"], message: "Stage names must be unique within the pipeline." })
  const ids = value.stages.flatMap(stage => stage.id ? [stage.id] : [])
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", path: ["stages"], message: "A stage cannot appear twice." })
})
export const pipelineUpdateSchema = pipelineSchema.safeExtend({ version: z.number().int().positive() })
export const opportunitySchema = z.object({
  title: z.string().trim().min(1).max(200), pipelineId: id, stageId: id, contactId: id,
  accountId: z.string().trim().max(100).optional(), enquiryId: text(100), assignedUserId: id,
  salesTeamId: z.string().max(100).nullable().optional(),
  enquiryVersion: z.number().int().positive().optional(),
  amount: z.string().trim().regex(/^(0|[1-9]\d{0,13})(\.\d{1,4})?$/, "Enter a positive amount or zero, with up to four decimal places."),
  currency: z.string().trim().toUpperCase().refine(value => Intl.supportedValuesOf("currency").includes(value), "Choose a supported currency code."),
  expectedCloseOn: z.iso.date().optional(), description: text(5000), lossReason: text(2000), lostReasonId: z.string().trim().max(100).optional(),
  probability: z.number().int().min(0).max(100).optional(),
}).strict()
export const opportunityUpdateSchema = opportunitySchema.omit({ enquiryId: true, enquiryVersion: true }).extend({ version: z.number().int().positive(), accountId: text(100), expectedCloseOn: z.iso.date() })
export const opportunityMoveSchema = z.object({ pipelineId: id, stageId: id, version: z.number().int().positive(), lossReason: text(2000), lostReasonId: z.string().trim().max(100).optional() }).strict()
export const opportunityListSchema = crmListSchema.omit({ status: true, due: true, archived: true, sort: true }).extend({
  pipelineId: id.optional(), stageId: id.optional(), assignedUserId: id.optional(), kind: z.enum(stageKinds).optional(),
  sort: z.enum(["updatedAt", "title", "expectedCloseOn"]).default("updatedAt"),
})
export type PipelineInput = z.infer<typeof pipelineSchema>
export type OpportunityInput = z.infer<typeof opportunitySchema>
