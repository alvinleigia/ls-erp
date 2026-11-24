import { z } from "zod"

// Item defaults and reviewed quotation-line charges share one bounded contract.
// Percentage and fixed charges apply once to the whole priced line, not per unit.
export const itemChargeSchema = z.object({
  label: z.string().trim().min(1).max(150),
  group: z.string().trim().max(100).default(""),
  kind: z.enum(["FIXED", "PERCENT"]),
  value: z.string().regex(/^\d{1,12}(\.\d{1,4})?$/, "Enter a non-negative amount or percentage with up to four decimals."),
  included: z.boolean(),
  due: z.string().trim().max(500).default(""),
}).strict().superRefine((charge, ctx) => {
  if (charge.kind === "PERCENT" && Number(charge.value) > 100) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter a percentage from 0 to 100; enter 8 for 8%." })
})
export const itemChargesSchema = z.array(itemChargeSchema).max(10).superRefine((charges, ctx) => {
  const names = new Set<string>()
  charges.forEach((charge, index) => {
    const key = charge.label.toLowerCase()
    if (names.has(key)) ctx.addIssue({ code: "custom", path: [index, "label"], message: "Use a different name for each item charge." })
    names.add(key)
  })
})
export type ItemCharge = z.infer<typeof itemChargeSchema>
