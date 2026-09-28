"use client"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/form-field"
import { SearchableSelect } from "@/components/searchable-select"
import { COUNTRY_OPTIONS } from "@/lib/constants/countries"

export const emptyContact = { name: "", email: "", phone: "", alternatePhone: "", whatsappPhone: "", addressLine1: "", addressLine2: "", city: "", region: "", postalCode: "", country: "" }
export type ContactValues = typeof emptyContact
export function contactValues(record: Partial<Record<keyof ContactValues, string | null>>): ContactValues {
  return Object.fromEntries(Object.keys(emptyContact).map(key => [key, record[key as keyof ContactValues] || ""])) as ContactValues
}
const countries = COUNTRY_OPTIONS.map(value => ({ value, label: value }))

export function ContactFields({ values, onChange, errors, prefix = "", disabled = false }: {
  values: ContactValues; onChange: (values: ContactValues) => void; errors: Record<string, string>; prefix?: string; disabled?: boolean;
}) {
  const field = (key: keyof ContactValues, label: string, type = "text", maxLength = 100) => <FormField key={key} id={prefix + key} label={label} error={errors[prefix + key]} className="min-w-0"><Input id={prefix + key} type={type} required={key === "name"} maxLength={maxLength} value={values[key]} onChange={event => onChange({ ...values, [key]: event.target.value })} /></FormField>
  return <>
    {field("name", "Full name", "text", 160)}
    {field("email", "Email", "email", 254)}
    {field("phone", "Phone", "tel", 40)}
    {field("alternatePhone", "Alternate phone (optional)", "tel", 40)}
    <FormField id={prefix + "whatsappPhone"} label="WhatsApp number (optional)" error={errors[prefix + "whatsappPhone"]} className="sm:col-span-2"><div className="flex flex-wrap gap-2"><Input id={prefix + "whatsappPhone"} type="tel" maxLength={40} className="min-w-0 flex-1 basis-48" value={values.whatsappPhone} onChange={event => onChange({ ...values, whatsappPhone: event.target.value })} /><Button type="button" variant="outline" disabled={disabled || !values.phone} onClick={() => onChange({ ...values, whatsappPhone: values.phone })}>Same as phone</Button></div><p className="text-xs text-muted-foreground">Include the country code for all phone numbers. Copying the phone number does not keep the fields synchronized.</p></FormField>
    <div className="border-t pt-5 sm:col-span-2"><h3 className="text-sm font-medium">Address (optional)</h3></div>
    {field("addressLine1", "Address line 1", "text", 200)}
    {field("addressLine2", "Address line 2", "text", 200)}
    {field("city", "City")}{field("region", "State / region")}
    {field("postalCode", "Postal code", "text", 30)}
    <FormField id={prefix + "country"} label="Country" error={errors[prefix + "country"]}><SearchableSelect id={prefix + "country"} value={values.country} options={countries} disabled={disabled} onChange={country => onChange({ ...values, country })} placeholder="Choose country" />{values.country && <Button type="button" size="sm" variant="link" disabled={disabled} onClick={() => onChange({ ...values, country: "" })}>Clear country</Button>}</FormField>
  </>
}
