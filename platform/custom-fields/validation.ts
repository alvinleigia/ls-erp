import { z } from "zod"

export const fieldTypes = ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"] as const
export const fieldScopes = ["ENQUIRY", "OPPORTUNITY", "SALES", "PROJECT"] as const
export type FieldScope = typeof fieldScopes[number]
export type FieldValue = string | number | boolean | null
export const primitive = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()])
export const fieldSchema = z.object({
  salesTeamId: z.string().min(1).max(100).nullable().default(null),
  scope: z.enum(fieldScopes), code: z.string().trim().regex(/^[a-z][a-z0-9_]{0,49}$/),
  name: z.string().trim().min(1).max(100), type: z.enum(fieldTypes), helpText: z.string().trim().max(500).default(""),
  position: z.number().int().min(0).max(1000000).default(0), required: z.boolean().default(false),
  visibility: z.enum(["ALL", "MANAGERS"]).default("ALL"), editability: z.enum(["ALL", "MANAGERS"]).default("ALL"),
  filterable: z.boolean().default(false), maxLength: z.number().int().min(1).max(2000).default(2000),
  minimum: z.string().max(32).nullable().default(null), maximum: z.string().max(32).nullable().default(null),
  defaultValue: primitive.default(null), archived: z.boolean().default(false), version: z.number().int().positive().optional(),
  options: z.array(z.object({ id: z.string().max(100).optional(), name: z.string().trim().min(1).max(100), archived: z.boolean().default(false) }).strict()).max(50).default([]),
}).strict()
export const customFilterShape = {
  customFieldId: z.string().max(100).optional(), customFieldValue: z.string().max(2000).optional(),
  customFieldOperator: z.enum(["eq", "gte", "lte"]).default("eq"),
}
export const fieldListSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  salesTeamId: z.string().min(1).max(100).optional(),
  q: z.string().max(200).default(""), scope: z.enum(fieldScopes).optional(), resource: z.string().max(50).optional(),
  archived: z.enum(["true", "false"]).default("false"), filterable: z.enum(["true", "false"]).optional(),
})
export function splitCustomFields(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { core: input, patch: {} }
  const { customFields, ...core } = input as Record<string, unknown>
  const patch = z.record(z.string().min(1).max(100), primitive).refine(value => Object.keys(value).length <= 50, "At most 50 custom fields.").parse(customFields ?? {})
  return { core, patch }
}

export type FieldView = {
  salesTeamId?: string | null; id: string; scope: FieldScope; code: string; name: string; type: typeof fieldTypes[number]; helpText: string;
  position: number; required: boolean; archived: boolean; editable: boolean; filterable: boolean; maxLength: number;
  minimum: string | null; maximum: string | null; defaultValue: FieldValue; value: FieldValue;
  savedName?: string; optionName?: string | null; options: { id: string; name: string; archived: boolean }[];
}
