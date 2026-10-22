/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { cleanLabel, registerTerms, resolveTermLabels, validateTermLabels, activeTerms } = require("../platform/terminology/catalog.ts")
const { terminologyCatalog } = require("../application/terminology/catalog.ts")
const { termReplacements } = require("../platform/terminology/catalog.ts")
const { createTermResolver } = require("../platform/terminology/resolver.ts")
const { businessNavigation } = require("../application/navigation.ts")
const { crmConfigurationGroups, getCrmConfigurationGroups, isCrmConfigurationPath } = require("../modules/crm/configuration.ts")

test("configuration labels retain canonical routes and contextual defaults", () => {
  const customized = getCrmConfigurationGroups(createTermResolver({ "crm.activity.singular": "Touchpoint", "crm.activity.plural": "Touchpoints", "crm.enquiry.plural": "Prospects", "crm.opportunity.plural": "Deals" }))
  assert.deepEqual(getCrmConfigurationGroups(), crmConfigurationGroups)
  assert.deepEqual(customized.flatMap(group => group.items.map(item => item.href)), crmConfigurationGroups.flatMap(group => group.items.map(item => item.href)))
  assert.equal(customized[1].title, "Touchpoints and follow-ups")
  assert.equal(customized[1].items[0].title, "Touchpoint types")
  assert.equal(customized[0].items[2].description, "Add typed fields to Prospects, Deals and supported industry records.")
  assert.equal(crmConfigurationGroups[0].items[2].description, "Add typed fields to enquiries, opportunities and supported industry records.")
  for (const group of customized) for (const item of group.items) assert.equal(isCrmConfigurationPath(`${item.href}/new`), true)
  assert.equal(isCrmConfigurationPath("/crm/activities"), false)
})

test("contextual defaults survive reset and only explicit replacements are interpolated literally", () => {
  const key = "crm.enquiry.singular", base = terminologyCatalog[0]
  const defaults = createTermResolver(termReplacements([base], {}))
  assert.equal(defaults(key, "New lead", "New {label}"), "New lead")
  assert.equal(defaults("toString", "Fallback"), "Fallback")
  const installed = { ...base, moduleDefault: "Prospect" }
  assert.equal(createTermResolver(termReplacements([installed], {}))(key, "New lead", "New {label}"), "New Prospect")
  const custom = createTermResolver(termReplacements([installed], { [key]: "Lead $& {label}" }))
  assert.equal(custom(key, "New lead", "New {label}"), "New Lead $& {label}")
  assert.equal(custom("unknown.key", "Original wording"), "Original wording")
  assert.deepEqual(termReplacements([], { [key]: "Hidden module" }), {})
})

test("navigation changes labels without changing destinations, access or module gating", () => {
  const flags = ["crm", "salesDocuments", "realEstate"].map(key => ({ key, allowed: true, enabled: true }))
  const term = createTermResolver({ "crm.enquiry.plural": "Leads", "crm.contact.plural": "People", "realEstate.project.plural": "Developments" })
  const original = businessNavigation(flags), renamed = businessNavigation(flags, undefined, term)
  assert.deepEqual(renamed.flatMap(group => group.items.map(item => item.href)), original.flatMap(group => group.items.map(item => item.href)))
  assert.equal(renamed[0].items[0].title, "Leads")
  assert.equal(renamed.find(group => group.key === "realEstate").items[0].title, "Developments")
  assert.equal(businessNavigation(flags, ["opportunities.read"], term).flatMap(group => group.items).some(item => item.href === "/crm/enquiries"), false)
  assert.deepEqual(businessNavigation([], undefined, term), [])
  assert.equal(original.find(group => group.key === "contacts").items[0].title, "People")
  for (const reserved of ["Email", "Calendar", "Templates", "Team", "Pricing and charges"]) assert.throws(() => validateTermLabels(terminologyCatalog, { "crm.enquiry.plural": reserved }), /standard control/)
})

test("terminology resolves tenant override, installed default, then core default without mutation", () => {
  const base = terminologyCatalog[0]
  assert.equal(resolveTermLabels([base], {})[base.key], "Enquiry")
  assert.equal(resolveTermLabels([{ ...base, moduleDefault: "Lead" }], {})[base.key], "Lead")
  const overrides = { [base.key]: "Prospect", "unknown.key": "Ignored" }
  assert.deepEqual(resolveTermLabels([{ ...base, moduleDefault: "Lead" }], overrides), { [base.key]: "Prospect" })
  assert.equal(base.defaultLabel, "Enquiry"); assert.equal(overrides[base.key], "Prospect")
})
test("labels normalize spaces and unicode while rejecting controls, markup and spreadsheet formulas", () => {
  assert.equal(cleanLabel("  Sales   leads  "), "Sales leads")
  assert.equal(cleanLabel("Ｆａｒｍ"), "Farm")
  assert.equal(cleanLabel("संपर्क"), "संपर्क")
  for (const label of ["", " ", "x".repeat(61), "=SUM(1)", "+Name", "@Name", "<script>", "Name\nOther", "Name\u202eOther", "Name [key]"]) assert.throws(() => cleanLabel(label))
})
test("effective labels must be unique and cannot shadow fixed controls", () => {
  assert.throws(() => validateTermLabels(terminologyCatalog, { "crm.enquiry.singular": " contact " }), /already used/)
  assert.throws(() => validateTermLabels(terminologyCatalog, { "crm.enquiry.plural": "Ｓｔａｔｕｓ" }), /standard control/)
  assert.throws(() => registerTerms([terminologyCatalog[0], terminologyCatalog[0]]), /duplicate/)
  assert.doesNotThrow(() => validateTermLabels(terminologyCatalog, { "crm.enquiry.singular": "Lead", "crm.enquiry.plural": "Leads" }))
})
test("module dependency gates hide property and document labels without mutating the catalog", () => {
  const flags = ["crm", "realEstate", "salesDocuments", "paymentPlans"].map(key => ({ key, allowed: true, enabled: true }))
  assert.equal(activeTerms(terminologyCatalog, flags).length, 18)
  assert.equal(activeTerms(terminologyCatalog, flags.map(flag => flag.key === "crm" ? { ...flag, enabled: false } : flag)).length, 0)
  assert.equal(activeTerms(terminologyCatalog, flags.filter(flag => flag.key !== "realEstate")).length, 14)
  assert.equal(terminologyCatalog.length, 20)
  assert.equal(activeTerms(terminologyCatalog, [...flags, { key: "salesOrders", allowed: true, enabled: true }]).length, 20)
})
