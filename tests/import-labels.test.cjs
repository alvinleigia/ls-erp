/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { baseImportFields, suggestImportMapping } = require("../modules/crm/import-types.ts")
const { importTemplateHeader, importFieldLabel } = require("../modules/crm/import-labels.ts")
const { createTermResolver } = require("../platform/terminology/resolver.ts")
const { enquiryCsv, opportunityCsv } = require("../modules/crm/record-exports.ts")
const { parse } = require("csv-parse/sync")
const { readTermReplacements } = require("../platform/terminology/read.ts")
const { terminologyCatalog } = require("../application/terminology/catalog.ts")
const { validateTermLabels } = require("../platform/terminology/catalog.ts")

test("renamed import headings round trip after reset, without changing canonical fields or custom codes", () => {
  const field = { key: "brandId", label: "Brand", terminologyKey: "catalog.brand.singular" }
  const custom = { key: "custom:123", label: "Custom name", aliases: ["Custom name", "enquiry.custom_name"] }
  const fields = [...baseImportFields, field, custom]
  const term = createTermResolver({ "crm.contact.singular": "Person $&", "crm.enquiry.singular": "Prospect", "catalog.brand.singular": "Maker" })
  assert.equal(importFieldLabel(baseImportFields[0], term), "Person $& name")
  const headers = fields.map(f => importTemplateHeader(f, term))
  assert.ok(headers.includes("Prospect title [title]")); assert.ok(headers.includes("Maker [brandId]"))
  assert.equal(headers.at(-1), "enquiry.custom_name")
  assert.equal(Object.keys(suggestImportMapping(headers, fields)).length, fields.length)
  assert.equal(baseImportFields[0].label, "Contact name")
  assert.equal(importTemplateHeader(baseImportFields[0], createTermResolver({})), "Contact name")
  assert.deepEqual(suggestImportMapping(["Contact name", "Email", "Enquiry title"], fields), { name: 0, email: 1, title: 2 })
  assert.deepEqual(suggestImportMapping(["Contact name [brandId]", "Whatever [name]", "Email [notAField]"], fields), { name: 1, brandId: 0 })
})

test("exports change only code-owned labels, leaving values and tenant custom headers intact", () => {
  const row = { id: "a", title: "Project", contact: { name: "Customer" }, assignee: { name: "Owner" }, source: null, createdAt: new Date("2026-01-01Z"), lostReasonName: null, status: "NEW", targetCloseOn: null, outcome: null, pipeline: { name: "Pipeline" }, stage: { name: "Qualified", kind: "OPEN" }, amount: "123", currency: "INR", expectedCloseOn: new Date("2026-02-01Z"), closedAt: null, lossReason: null }
  const page = { items: [row], extensionExport: { headers: ["Brand"], terminologyKeys: ["catalog.brand.singular"], values: { a: ["Brand"] } }, customFieldExport: { headers: ["Customer"], values: { a: ["Original value"] } } }
  const exportTerms = { "crm.contact.singular": "Person", "crm.opportunity.singular": "Sale", "catalog.brand.singular": "Maker" }
  for (const csv of [enquiryCsv, opportunityCsv]) {
    const original = parse(csv(page), { bom: true }), renamed = parse(csv({ ...page, exportTerms }), { bom: true })
    assert.deepEqual(renamed[1], original[1]); assert.ok(renamed[0].includes("Maker")); assert.equal(renamed[0][2], "Person")
    assert.equal(renamed[0].at(-1), "Customer")
  }
  assert.ok(parse(opportunityCsv({ ...page, exportTerms }), { bom: true })[0].includes("Sale value"))
})

test("custom import scope captions preserve literal user names, codes and shared scope", () => {
  const name = "Enquiry {label} $&", field = { key: "custom:123", label: `${name} (enquiry, team field)`, customField: { name, scope: "ENQUIRY" }, salesTeamId: "team", aliases: [name, "enquiry.original_code"] }
  const original = structuredClone(field)
  const renamed = createTermResolver({ "crm.enquiry.singular": "Prospect $&" })
  assert.equal(importFieldLabel(field, renamed), `${name} (Prospect $&, team field)`)
  assert.equal(importFieldLabel(field, createTermResolver({})), field.label)
  assert.equal(importTemplateHeader(field, renamed), "enquiry.original_code")
  assert.deepEqual(suggestImportMapping(["enquiry.original_code"], [field]), { "custom:123": 0 })
  assert.equal(importFieldLabel({ ...field, customField: { name, scope: "SALES" } }, renamed), `${name} (sales, team field)`)
  assert.deepEqual(field, original)
})

test("document terminology uses two scoped reads and ignores disabled modules and unknown keys", async () => {
  const calls = []
  const tx = {
    tenantTerminology: { findMany: async query => { calls.push(query); return [{ key: "crm.contact.singular", label: "Buyer" }, { key: "realEstate.project.singular", label: "Estate" }, { key: "unknown.label", label: "Untrusted" }] } },
    tenantModule: { findMany: async query => { calls.push(query); return [{ key: "crm", allowed: true, enabled: true }, { key: "realEstate", allowed: true, enabled: false }] } },
  }
  assert.deepEqual(await readTermReplacements(tx, "tenant-a", terminologyCatalog), { "crm.contact.singular": "Buyer" })
  assert.equal(calls.length, 2)
  for (const call of calls) assert.deepEqual(call.where, { tenantId: "tenant-a" })
  for (const label of ["City", "Bedrooms", "Import errors", "Record type", "Closing note"]) assert.throws(() => validateTermLabels(terminologyCatalog, { "realEstate.project.singular": label }), /standard control/)
})
