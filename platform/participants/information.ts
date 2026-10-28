import { z } from "zod"
import { COUNTRY_OPTIONS } from "@/lib/constants/countries"

// Communication values share the directory's validation. Transaction-specific
// correspondence does not update or identify/merge a customer master.
export const communicationEmail = z.string().trim().max(254).pipe(z.union([z.email(), z.literal("")])).transform(value => value.toLowerCase())
export const communicationPhone = z.string().trim().max(40).transform(value => value.replace(/[\s().-]/g, "")).refine(value => !value || /^\+[1-9]\d{6,14}$/.test(value), "Use an international number, for example +919876543210.")
const text = (max: number) => z.string().trim().max(max)
export const correspondenceSchema = z.object({
  email: communicationEmail, phone: communicationPhone,
  addressLine1: text(200), addressLine2: text(200), city: text(100), region: text(100), postalCode: text(30),
  country: text(100).refine(value => !value || (COUNTRY_OPTIONS as readonly string[]).includes(value), "Choose a country."),
}).strict()
export type Correspondence = z.infer<typeof correspondenceSchema>
export const informationFields = ["email", "phone", "addressLine1", "addressLine2", "city", "region", "postalCode", "country"] as const
export type InformationField = typeof informationFields[number]
export const informationLabels: Record<InformationField, string> = { email: "Email", phone: "Phone", addressLine1: "Address line 1", addressLine2: "Address line 2", city: "City", region: "State / region", postalCode: "Postal code", country: "Country" }
export const emptyCorrespondence: Correspondence = { email: "", phone: "", addressLine1: "", addressLine2: "", city: "", region: "", postalCode: "", country: "" }
export const informationPartyKey = (party: { kind: string; id: string }) => JSON.stringify([party.kind, party.id])
const caption = z.string().trim().min(1).max(60)
export const participantPresentationSchema = z.object({
  configurationVersion: z.number().int().min(0), title: caption,
  labels: z.object(Object.fromEntries(informationFields.map(key => [key, caption])) as Record<InformationField, typeof caption>).strict(),
  roleLabels: z.object({ CUSTOMER: caption, ADDITIONAL_CUSTOMER: caption, REPRESENTATIVE: caption }).strict(),
}).strict()
