/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { salesReportLabels, reportLabel, reportBucketLabel } = require("../modules/crm/report-labels.ts")
const { createTermResolver, defaultTermResolver } = require("../platform/terminology/resolver.ts")

test("report terminology preserves metric keys and contextual defaults", () => {
  const original = salesReportLabels(defaultTermResolver)
  const renamed = salesReportLabels(createTermResolver({ "crm.enquiry.plural": "Prospects", "crm.opportunity.plural": "Deals" }))
  assert.deepEqual(Object.keys(renamed), Object.keys(original))
  assert.equal(original.leads, "Leads created")
  assert.equal(original.gaps, "Deals without open work")
  assert.equal(renamed.leads, "Prospects created")
  assert.equal(renamed.pipeline, "Open Deals")
  assert.equal(renamed.overdue, original.overdue)
})

test("extension-owned metadata resolves only labels and the explicit unassigned bucket", () => {
  const dimension = { key: "region", label: "Territory", terminologyKey: "example.region.singular", emptyLabel: "Unassigned territory" }
  const term = createTermResolver({ "example.region.singular": "Area $&" })
  assert.equal(reportLabel(defaultTermResolver, dimension, true), "By territory")
  assert.equal(reportLabel(term, dimension, true), "By Area $&")
  assert.equal(reportBucketLabel(term, dimension, "__none__", "Unassigned territory"), "No Area $&")
  assert.equal(reportBucketLabel(term, dimension, "real-record-id", "Unassigned territory"), "Unassigned territory")
  assert.equal(reportBucketLabel(defaultTermResolver, dimension, "__none__", "Unassigned territory"), "Unassigned territory")
  assert.equal(reportLabel(term, { key: "source", label: "Source" }), "Source")
  assert.equal(reportBucketLabel(term, undefined, "__none__", "Unclassified"), "Unclassified")
  assert.equal(dimension.key, "region")
})
