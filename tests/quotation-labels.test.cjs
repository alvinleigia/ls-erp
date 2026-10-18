/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { createTermResolver } = require("../platform/terminology/resolver.ts")
const { quotationDocumentLabels } = require("../modules/sales-documents/quotation-labels.ts")
const { validateTermLabels } = require("../platform/terminology/catalog.ts")
const { terminologyCatalog } = require("../application/terminology/catalog.ts")

test("saved document labels retain exact defaults or literal configured names", () => {
  assert.deepEqual(quotationDocumentLabels(), {
    customer: "Customer", opportunity: "Opportunity", parties: "Customer and opportunity", paymentSchedule: "Instalment schedule",
    notice: "Quotation / payment instructions only. This document is not a payment receipt.",
  })
  const labels = quotationDocumentLabels(createTermResolver({ "crm.contact.singular": "Buyer", "crm.opportunity.singular": "Deal $&", "salesDocuments.quotation.singular": "Offer", "paymentPlans.paymentPlan.singular": "Payment schedule" }))
  assert.equal(labels.parties, "Buyer and Deal $&")
  assert.equal(labels.paymentSchedule, "Payment schedule")
  assert.equal(labels.notice, "Offer / payment instructions only. This document is not a payment receipt.")
  assert.equal(labels.opportunity, "Deal $&")
  for (const label of ["Bank details", "Price", "Reference details"]) assert.throws(() => validateTermLabels(terminologyCatalog, { "paymentPlans.paymentPlan.singular": label }), /standard control/)
})
