import { z } from "zod"

export const choiceKinds = ["project-statuses", "property-categories", "buying-timeframes"] as const
export type ChoiceKind = typeof choiceKinds[number]
export const choiceKindSchema = z.enum(choiceKinds)
export const choiceTitles: Record<ChoiceKind, string> = {
  "project-statuses": "Project statuses",
  "property-categories": "Property categories",
  "buying-timeframes": "Buying timeframes",
}
export type PropertyChoice = { id: string; name: string; position: number; isDefault: boolean; archived: boolean; version: number }
export type PropertyDefaults = Record<ChoiceKind, PropertyChoice | null>
export const choiceSchema = z.object({
  name: z.string().trim().min(1).max(100).transform(value => value.replace(/\s+/g, " ")),
  position: z.number().int().min(0).max(1000000).default(0),
  isDefault: z.boolean().default(false), archived: z.boolean().default(false),
}).strict().refine(value => !(value.isDefault && value.archived), { path: ["archived"], message: "Clear the default before archiving this choice." })
export const choiceUpdateSchema = choiceSchema.safeExtend({ version: z.number().int().positive() })
export const choiceListSchema = z.object({
  q: z.string().trim().max(100).default(""),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  archived: z.enum(["false", "true"]).default("false"), includeArchived: z.enum(["false", "true"]).default("false"),
})
