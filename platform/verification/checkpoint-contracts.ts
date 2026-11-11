import { z } from "zod"
import { verificationRoles } from "./contracts"
export const verificationCheckpoints = ["ORDER_CONFIRMATION", "UNIT_ALLOCATION", "ORDER_DOCUMENT"] as const
export const checkpointNames = { ORDER_CONFIRMATION: "Order confirmation", UNIT_ALLOCATION: "Unit allocation", ORDER_DOCUMENT: "Order document issuance" }
export const checkpointModes = ["OFF", "WARN", "REQUIRED"] as const
export const checkpointDefinitionSchema = z.object({
  format: z.literal(1), roles: z.array(z.enum(verificationRoles)).min(1).max(3).refine(r => r.includes("CUSTOMER") && new Set(r).size === r.length, "Always include the main customer and choose each role once."),
  checkpoints: z.object({ ORDER_CONFIRMATION: z.enum(checkpointModes), UNIT_ALLOCATION: z.enum(checkpointModes), ORDER_DOCUMENT: z.enum(checkpointModes) }).strict(),
}).strict()
export type CheckpointDefinition = z.infer<typeof checkpointDefinitionSchema>
export const emptyCheckpoints = (): CheckpointDefinition => ({ format: 1, roles: ["CUSTOMER", "ADDITIONAL_CUSTOMER"], checkpoints: { ORDER_CONFIRMATION: "OFF", UNIT_ALLOCATION: "OFF", ORDER_DOCUMENT: "OFF" } })
export const checkpointInputSchema = z.object({ version: z.number().int().min(0).max(2147483646), definition: checkpointDefinitionSchema }).strict()
export const checkpointPublishSchema = checkpointInputSchema.extend({ previewHash: z.string().regex(/^[a-f0-9]{64}$/) })
export const verificationSourceSchema = z.object({ kind: z.enum(["OPPORTUNITY", "ORDER"]), id: z.string().min(1).max(100) }).strict()
export type VerificationSource = z.infer<typeof verificationSourceSchema>
export type CheckpointReview = { mode: typeof checkpointModes[number]; configurationVersion: number; eligible: boolean; missingCount: number; token: string }
export const checkpointOff: CheckpointReview = { mode: "OFF", configurationVersion: 0, eligible: true, missingCount: 0, token: "off" }
