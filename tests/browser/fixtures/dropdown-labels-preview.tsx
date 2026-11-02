"use client"
import { useState } from "react"
import { Select } from "@/components/erp/controls"
import { SearchableSelect } from "@/components/searchable-select"
import { DropdownSelect } from "@/components/ui/dropdown-select"
import { enumLabel } from "@/lib/enum-label"
import { enquiryStatusLabel } from "@/modules/crm/display-labels"

export function DropdownLabelsPreview() {
  const [status, setStatus] = useState("NEW"), [kind, setKind] = useState("OPEN"), [tax, setTax] = useState("NON_GST"), [record, setRecord] = useState("NEW"), [fixed, setFixed] = useState("INR")
  const [submitted, setSubmitted] = useState("")
  return <form className="grid w-full min-w-0 max-w-lg gap-4" onSubmit={e => { e.preventDefault(); setSubmitted(JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))) }}>
    <h1>Dropdown label checks</h1>
    <label htmlFor="status-label-test">Status</label><Select id="status-label-test" name="status" value={status} onValueChange={setStatus}>{["NEW", "CONTACTED", "QUALIFIED", "CLOSED"].map(value => <option key={value} value={value}>{enquiryStatusLabel(value)}</option>)}</Select>
    <label htmlFor="kind-label-test">Outcome</label><Select id="kind-label-test" name="kind" value={kind} onValueChange={setKind}>{["OPEN", "WON", "LOST"].map(value => <option key={value} value={value}>{enumLabel(value)}</option>)}</Select>
    <label htmlFor="tax-label-test">Tax treatment</label><select id="tax-label-test" name="tax" value={tax} onChange={e => setTax(e.target.value)}>{["NON_GST", "ZERO_RATED", "SEZ_WITH_PAYMENT"].map(value => <option key={value} value={value}>{enumLabel(value)}</option>)}</select>
    <label htmlFor="record-label-test">Custom record</label><SearchableSelect id="record-label-test" value={record} onChange={setRecord} placeholder="Select record" options={[{ value: "NEW", label: "ACME COMPANY LTD" }, { value: "CONTACTED", label: "iPhone SERVICES" }, { value: "CLOSED", label: "CONTACTED" }]} />
    <DropdownSelect label="Currency" value={fixed} onValueChange={setFixed} options={[{ value: "INR", label: "INR" }, { value: "USD", label: "USD" }]} />
    <button type="submit">Save fixture</button><output className="min-w-0 break-all text-xs" aria-label="submitted values">{submitted}</output>
  </form>
}
