import { z } from "zod"

const text = (max: number) => z.string().trim().max(max)
const decimal = z.string().regex(/^\d{1,12}(\.\d{1,4})?$/, "Enter a positive number with up to four decimal places.")
const date = z.union([z.literal(""), z.iso.date()])
const logo = z.string().max(400000).refine(value => {
  if (!value) return true
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value)) return false
  try { const bytes = Uint8Array.from(atob(value.split(",")[1]), c => c.charCodeAt(0)), view = new DataView(bytes.buffer); return view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452 && view.getUint32(16) > 0 && view.getUint32(20) > 0 && view.getUint32(16) <= 2000 && view.getUint32(20) <= 2000 } catch { return false }
}, "Use a PNG logo up to 290 KB and 2000 by 2000 pixels.")
export const quotationContentSchema = z.object({
  logoDataUrl: logo.default(""),
  title: text(150).min(1), currency: z.string().regex(/^[A-Z]{3}$/).refine(value => { try { return Intl.supportedValuesOf("currency").includes(value) } catch { return false } }, "Choose a currency."),
  supplierName: text(200).min(1), website: z.union([z.literal(""), z.url().refine(value => /^https?:\/\//.test(value))]),
  bookingDate: date, validUntil: date, registration: text(300), registrationUrl: z.union([z.literal(""), z.url().max(1000).refine(value => /^https?:\/\//.test(value))]),
  details: z.array(z.object({ label: text(100).min(1), value: text(500) }).strict()).max(15),
  lines: z.array(z.object({ description: text(300).min(1), quantity: decimal.refine(value => Number(value) > 0), unit: text(40), rate: decimal }).strict()).min(1).max(30),
  discount: decimal,
  charges: z.array(z.object({ label: text(150).min(1), group: text(100).default(""), kind: z.enum(["FIXED", "PERCENT", "TBD"]), value: decimal, basis: z.enum(["BASE", "CONSIDERATION"]), included: z.boolean(), due: text(500) }).strict()).max(30),
  instalments: z.array(z.object({ label: text(150).min(1), percent: decimal.refine(value => Number(value) > 0 && Number(value) <= 100), days: z.number().int().min(0).max(36500), note: text(300) }).strict()).max(30),
  bank: z.object({ accountName: text(200), accountNumber: text(100), accountType: text(100), bankName: text(200), branch: text(200), routingCode: text(100) }).strict(),
  terms: text(10000),
}).strict().superRefine((data, ctx) => {
  if (data.instalments.some(item => !/^\d{1,12}(\.\d{1,4})?$/.test(item.percent))) return
  const total = data.instalments.reduce((sum, item) => { const [whole, decimal = ""] = item.percent.split("."); return sum + BigInt(whole) * BigInt(10000) + BigInt(decimal.padEnd(4, "0")) }, BigInt(0))
  if (data.instalments.length && total !== BigInt(1000000)) ctx.addIssue({ code: "custom", path: ["instalments"], message: "Instalment percentages must total exactly 100%." })
  data.charges.forEach((charge, index) => {
    if (charge.included && (charge.basis === "CONSIDERATION" || charge.kind === "TBD")) ctx.addIssue({ code: "custom", path: ["charges", index], message: "Included charges must be fixed or based on base price. Pending charges must remain extra." })
  })
})
export type QuotationContent = z.infer<typeof quotationContentSchema>
export const quotationSaveSchema = z.object({ content: quotationContentSchema, version: z.number().int().positive().optional(), templateId: z.string().max(100).optional() }).strict()
export const quotationTemplateSchema = z.object({ name: text(150).min(1), content: quotationContentSchema, archived: z.boolean().default(false), version: z.number().int().positive().optional() }).strict()
export const emptyQuotationContent: QuotationContent = {
  logoDataUrl: "",
  title: "Quotation", currency: "USD", supplierName: "", website: "", bookingDate: "", validUntil: "", registration: "", registrationUrl: "", details: [],
  lines: [{ description: "", quantity: "1", unit: "", rate: "0" }], discount: "0", charges: [],
  instalments: [],
  bank: { accountName: "", accountNumber: "", accountType: "", bankName: "", branch: "", routingCode: "" }, terms: "",
}
