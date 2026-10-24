/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
require("../modules/crm/service.ts")
const coreLoadedIndustry = Object.keys(require.cache).some(file => file.replaceAll("\\", "/").match(/\/modules\/(real-estate|sales-documents)\//))
const { noCrmExtensions } = require("../modules/crm/extensions.ts")
const { crmEnquiryCreateSchema } = require("../modules/crm/validation.ts")
const { realEstateCrmExtension: extension } = require("../modules/real-estate/crm-extension.ts")
const actor = { tenantId: "tenant-a", userId: "staff-a", role: "STAFF" }

test("import choices skip disabled modules and project tables without browse permission", async () => {
  let enabled = false, catalogReads = 0
  const tx = {
    tenantModule: { findUnique: async () => ({ allowed: true, enabled }) },
    realEstateProject: { findMany: () => { throw Error("Unauthorized project query") } },
    realEstatePropertyCategory: { findMany: async () => { catalogReads++; return [] } },
    realEstateBuyingTimeframe: { findMany: async () => { catalogReads++; return [] } },
  }
  assert.deepEqual(await extension.importFields(tx, actor), [])
  assert.equal(catalogReads, 0)
  enabled = true
  const fields = await extension.importFields(tx, { ...actor, role: "MANAGER", permissions: ["enquiries.read", "enquiries.create"] })
  assert.equal(fields.some(field => ["projectId", "subprojectId"].includes(field.key)), false)
  assert.equal(fields.some(field => field.key === "budgetMin"), true)
  assert.equal(catalogReads, 2)
})

test("preset composition preserves stable identities and leaves industry queries in their module", () => {
  const { crmPresets } = require("../application/crm/presets.ts")
  assert.deepEqual(crmPresets.map(p => [p.id, p.version, p.items.map(i => i.key)]), [
    ["general-sales", 1, ["source.Referral", "source.Website", "field.purchase_requirements", "activity.Proposal review"]],
    ["real-estate-sales", 1, ["source.Property portal", "source.Channel partner", "category.Plot", "category.Apartment", "field.preferred_locality", "activity.Site Visit"]],
  ])
  const source = fs.readFileSync(path.join(__dirname, "../application/crm/presets.ts"), "utf8")
  assert.doesNotMatch(source, /tx\.|Prisma|fieldSchema/)
})

test("operational modules own reusable rules without importing route implementations", () => {
  for (const directory of ["appointments", "inventory", "services", "workforce"]) {
    const root = path.join(__dirname, "../modules", directory)
    for (const file of fs.readdirSync(root, { recursive: true }).filter(file => /\.tsx?$/.test(file))) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /(?:from\s+|import\s*\()["'][^"']*app\/api\//, `${directory}/${file}`)
    }
  }
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../modules/inventory/stock-service.ts"), "utf8"), /Appointment|BOOKING_PRODUCT|orderId/)
})

test("operational dashboard providers skip every domain query for disabled or denied modules", async () => {
  const providers = [
    require("../modules/appointments/dashboard.ts").appointmentsDashboardData,
    require("../modules/workforce/dashboard.ts").workforceDashboardData,
    require("../modules/services/dashboard.ts").servicesDashboardData,
    require("../modules/inventory/dashboard.ts").inventoryDashboardData,
  ]
  const tx = new Proxy({}, { get() { throw new Error("Hidden module queried the database") } })
  const flags = ["appointments", "leaves", "services", "inventory"].map(key => ({ key, allowed: true, enabled: true }))
  const period = { rangeStart: new Date(), rangeEndExclusive: new Date(), todayStart: new Date(), tomorrowStart: new Date(), periodStartDateOnly: new Date(), periodEndDateOnly: new Date(), todayDateOnly: new Date(), now: new Date() }
  for (const provider of providers) {
    for (const [who, modules] of [
      [{ ...actor, role: "ADMIN" }, []],
      [{ ...actor, role: "ADMIN" }, flags.map(flag => ({ ...flag, allowed: false }))],
      [{ ...actor, role: "MANAGER", permissions: ["dashboard.read"] }, flags],
      [{ ...actor, permissions: [] }, flags],
    ]) assert.equal((await provider(tx, who, modules, period)).visible, false)
  }
})

test("extracted operational routes contain transport adapters rather than database rules", () => {
  for (const file of ["appointments", "appointments/availability", "appointments/[id]", "appointments/resolve", "appointments/orders", "appointments/orders/[id]", "appointments/coupons", "appointments/coupons/[id]", "appointments/orders/[id]/invoice", "appointments/orders/[id]/invoice-email", "inventory/products", "inventory/products/[id]", "inventory/purchases", "inventory/purchases/[id]", "inventory/categories", "inventory/categories/[id]", "inventory/suppliers", "inventory/suppliers/[id]", "service-categories", "service-categories/[id]", "services", "services/[id]", "dashboard/summary", "leaves/definitions", "leaves/definitions/[id]", "leaves/groups", "leaves/groups/[id]", "shifts/templates", "shifts/templates/[id]", "leaves/requests", "leaves/requests/[id]", "leaves/requests/[id]/review", "leaves/requests/[id]/cancel", "leaves/requests/[id]/revoke", "leaves/requests/review-bulk", "leaves/approved", "leaves/request-options", "shifts/schedules", "shifts/schedules/[id]", "shifts/assignments", "shifts/assignments/[id]", "shifts/overrides", "shifts/flexible-slots", "shifts/history", "shifts/flexible-week-plans", "shifts/flexible-patterns", "shifts/flexible-patterns/list", "shifts/flexible-patterns/impact-preview", "shifts/flexible-patterns/[id]", "shifts/flexible-patterns/[id]/clone", "shifts/flexible-patterns/[id]/deactivate"]) {
    const source = fs.readFileSync(path.join(__dirname, "../app/api", file, "route.ts"), "utf8")
    assert.doesNotMatch(source, /prisma\.|@prisma\/client|@\/lib\/prisma/, file)
  }
})

test("platform and shared dashboard presentation cannot import domain or application code", () => {
  for (const directory of ["platform", "components/dashboard", "components/erp"]) {
    const root = path.join(__dirname, "..", directory)
    for (const file of fs.readdirSync(root, { recursive: true }).filter(file => /\.tsx?$/.test(file))) {
      const source = fs.readFileSync(path.join(root, file), "utf8")
      assert.doesNotMatch(source, /(?:from\s+|import\s*\()["'][^"']*(?:modules\/|application\/)/, `${directory}/${file}`)
    }
  }
})

test("Sales Documents depends on its own contract and shared controls, not CRM implementations", () => {
  const root = path.join(__dirname, "../modules/sales-documents")
  for (const file of fs.readdirSync(root, { recursive: true }).filter(file => /\.tsx?$/.test(file))) {
    const source = fs.readFileSync(path.join(root, file), "utf8")
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()["'][^"']*(?:modules\/crm|modules\/real-estate|application\/)/, file)
  }
})

test("dashboard module gates skip database work rather than loading hidden sections", async () => {
  const { salesDashboard } = require("../application/dashboard/sales-summary.ts")
  const tx = new Proxy({}, { get() { throw new Error("Disabled dashboard section queried the database") } })
  const period = { start: new Date("2026-10-01"), end: new Date("2026-11-01"), now: new Date("2026-10-16"), today: "2026-10-16" }
  const enabled = ["crm", "realEstate", "salesDocuments", "paymentPlans"].map(key => ({ key, allowed: true, enabled: true }))
  for (const [who, flags] of [
    [actor, []],
    [{ ...actor, permissions: ["dashboard.read"] }, enabled],
    [actor, enabled.map(flag => flag.key === "crm" ? { ...flag, allowed: false } : flag)],
  ]) {
    assert.deepEqual(await salesDashboard(tx, who, flags, period), { enquiries: null, opportunities: null, activities: null, projects: null, quotations: null, paymentPlans: null })
  }
})

test("custom-field registration rejects ambiguous policies and unsafe table identifiers", () => {
  const { registerFieldResources } = require("../platform/custom-fields/resources.ts")
  const { customFieldResources } = require("../application/custom-fields/resources.ts")
  const enquiry = customFieldResources.find(resource => resource.key === "enquiry")
  assert.deepEqual(customFieldResources.map(resource => resource.key), ["enquiry", "opportunity", "project"])
  assert.throws(() => registerFieldResources([enquiry, enquiry]), /registration/)
  assert.throws(() => registerFieldResources([{ ...enquiry, table: 'Unsafe"; SELECT' }]), /registration/)
  assert.throws(() => registerFieldResources([enquiry, { ...enquiry, key: "different", context: { validate: async () => {} } }]), /same module and context/)
  assert.throws(() => registerFieldResources([enquiry, { ...enquiry, key: "different", module: "services" }]), /same module and context/)
  for (const file of ["service.ts", "values.ts"]) {
    const source = fs.readFileSync(path.join(__dirname, "../platform/custom-fields", file), "utf8")
    assert.doesNotMatch(source, /businessTeam|\.crmEnquiry|\.crmOpportunity|\.realEstateProject|resource\.table\.replace|["']PROJECT["']/)
  }
})

test("conversion retries recognize constraints when RLS hides key detail", () => {
  const { constraintTarget, serializationConflict } = require("../platform/database-errors.ts")
  assert.match(constraintTarget({ meta: { target: ["tenantId", "enquiryId"] } }), /enquiryId/)
  assert.match(constraintTarget({ meta: { target: [], driverAdapterError: { cause: { constraint: { fields: ["tenantId", "enquiryId"] } } } } }), /enquiryId/)
  assert.match(constraintTarget({ meta: { driverAdapterError: { cause: { originalMessage: 'duplicate key value violates unique constraint "CrmOpportunity_tenantId_enquiryId_key"' } } } }), /enquiryId/)
  assert.equal(serializationConflict({ code: "P2010", meta: { driverAdapterError: { cause: { originalCode: "40001" } } } }), true)
})

test("custom-field scope presentation belongs to registered resources", () => {
  const { registerFieldResources, fieldScopeOptions } = require("../platform/custom-fields/resources.ts")
  const { customFieldResources } = require("../application/custom-fields/resources.ts")
  const { resolveTermText } = require("../platform/terminology/message.ts")
  const options = fieldScopeOptions(customFieldResources)
  assert.equal(options.length, 4)
  assert.equal(options.find(option => option.scope === "PROJECT").teamScoped, false)
  assert.equal(options.find(option => option.scope === "SALES").teamScoped, true)
  const resolver = (key, fallback) => ({ "realEstate.project.plural": "Developments", "crm.enquiry.plural": "Leads", "crm.opportunity.plural": "Deals" })[key] || fallback
  assert.equal(resolveTermText(options.find(option => option.scope === "SALES").label, resolver), "Leads and Deals")
  assert.equal(resolveTermText(options.find(option => option.scope === "PROJECT").label, resolver), "Developments")
  assert.equal(fieldScopeOptions(customFieldResources.filter(r => r.module === "crm")).some(option => option.scope === "PROJECT"), false)
  const enquiry = customFieldResources[0]
  assert.throws(() => registerFieldResources([{ ...enquiry, scopeLabels: {} }]), /scope label/)
  assert.throws(() => registerFieldResources([enquiry, { ...enquiry, key: "conflict", scopeLabels: { ...enquiry.scopeLabels, SALES: "Conflicting" } }]), /same label/)
  const source = fs.readFileSync(path.join(__dirname, "../modules/crm/components/custom-field-configuration.tsx"), "utf8")
  assert.doesNotMatch(source, /PROJECT|realEstate\./)
  const control = fs.readFileSync(path.join(__dirname, "../components/erp/export-button.tsx"), "utf8")
  assert.doesNotMatch(control, /routeResource|real-estate|reports|enquiries|opportunities/)
})

test("core loads independently and cannot import an industry or application composition", () => {
  assert.equal(coreLoadedIndustry, false)
  const root = path.join(__dirname, "../modules/crm")
  for (const file of fs.readdirSync(root, { recursive: true }).filter(file => /\.tsx?$/.test(file))) {
    const source = fs.readFileSync(path.join(root, file), "utf8")
    assert.doesNotMatch(source, /(?:from\s+|import\s*\()["'][^"']*(?:real-estate|sales-documents|application\/crm)/, file)
  }
})

test("standalone CRM has no extension queries and rejects unavailable filters", async () => {
  const tx = new Proxy({}, { get() { throw new Error("Unexpected extension database access") } })
  const records = [{ id: "lead", title: "Generic lead" }]
  assert.deepEqual(await noCrmExtensions.decorate(tx, actor, "enquiry", records), { items: records, metadata: {} })
  const report = await noCrmExtensions.report(tx, actor, {})
  assert.equal(report.enquiryJoins.text, "")
  assert.equal(report.opportunityJoins.text, "")
  assert.deepEqual(report.columns, [])
  assert.deepEqual(report.dimensions, [])
  assert.doesNotMatch(report.values.text, /project|RealEstate/)
  await assert.rejects(noCrmExtensions.filters(tx, actor, { projectId: "project" }), error => error.status === 403)
  await assert.rejects(noCrmExtensions.report(tx, actor, { dimension: "project" }), error => error.status === 403)
})

test("industry filters are parsed by the extension and cannot hide core control fields", () => {
  const { crmListSchema } = require("../modules/crm/validation.ts")
  const input = { projectId: "park", subprojectId: "east", assignedUserId: "staff-a", pageSize: "10" }
  const split = extension.splitQuery(input)
  assert.deepEqual(split.extension, { projectId: "park", subprojectId: "east" })
  assert.equal(crmListSchema.strict().parse(split.core).assignedUserId, "staff-a")
  assert.equal(crmListSchema.strict().safeParse(noCrmExtensions.splitQuery(input).core).success, false)
  assert.throws(() => extension.splitQuery({ projectId: ["bad"] }))
  assert.equal(crmListSchema.strict().safeParse(extension.splitQuery({ tenantId: "other" }).core).success, false)
})

test("import choice dependencies and reset behaviour work for non-property fields", () => {
  const { importChoices, changeImportDefault } = require("../modules/crm/import-types.ts")
  const fields = [
    { key: "brand", label: "Brand", allowDefault: true },
    { key: "model", label: "Model", dependsOn: "brand", allowDefault: true, choices: [{ id: "a1", name: "Standard", parentId: "a" }, { id: "b1", name: "Standard", parentId: "b" }] },
    { key: "trim", label: "Trim", dependsOn: "model", allowDefault: true },
  ]
  assert.deepEqual(importChoices(fields[1], {}), [])
  assert.deepEqual(importChoices(fields[1], { brand: "b" }).map(c => c.id), ["b1"])
  const original = { brand: "a", model: "a1", trim: "sport", sourceId: "web" }
  assert.deepEqual(changeImportDefault(fields, original, "brand", "b"), { brand: "b", model: "", trim: "", sourceId: "web" })
  assert.equal(original.model, "a1")
})

test("shared query, report and import contracts do not hard-code property fields", () => {
  for (const file of ["extensions.ts", "validation.ts", "sales-report-validation.ts", "sales-report-service.ts", "import-service.ts", "record-exports.ts", "components/enquiry-import.tsx", "components/sales-reports.tsx", "components/record-list.tsx", "components/opportunity-views.tsx", "components/enquiry-editor.tsx", "components/opportunity-editor.tsx"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../modules/crm", file), "utf8"), /projectId|subprojectId|realEstateEnabled|propertyContext/, file)
  }
})

test("Real Estate owns URL defaults and serializes only its filter keys", () => {
  const { realEstateViewReferences, realEstateFilterQuery } = require("../modules/real-estate/crm-view-context.ts")
  assert.deepEqual(realEstateViewReferences({ projectId: "parent", subprojectId: "child", tenantId: "foreign" }), { primaryId: "parent", secondaryId: "child" })
  assert.deepEqual(realEstateViewReferences({ projectId: ["one", "two"], subprojectId: undefined }), { primaryId: "", secondaryId: "" })
  assert.deepEqual(realEstateFilterQuery("parent", "child"), { projectId: "parent", subprojectId: "child" })
  assert.deepEqual(realEstateFilterQuery("", ""), {})
  for (const resource of ["enquiries", "opportunities"]) {
    const source = fs.readFileSync(path.join(__dirname, `../app/(protected)/crm/${resource}/new/page.tsx`), "utf8")
    assert.doesNotMatch(source, /projectId|subprojectId|real-estate/)
    assert.match(source, /application\/crm\/create-pages/)
  }
})

test("shared work and document views leave property composition to the owning module", () => {
  for (const file of ["crm/components/work-list.tsx", "sales-documents/components/quotations.tsx", "sales-documents/components/quotation-content.tsx"]) {
    const source = fs.readFileSync(path.join(__dirname, "../modules", file), "utf8")
    assert.doesNotMatch(source, /projectId|subprojectId|realEstate\.|site visits|Linked project|For a plot|RERA|developer name/, file)
  }
})

test("disabled Real Estate document context never reads property records", async () => {
  const { realEstateQuotationContext } = require("../modules/real-estate/quotation-context.ts")
  let checks = 0
  const tx = {
    tenantModule: { findUnique: async ({ where }) => { checks++; assert.equal(where.tenantId_key.tenantId, actor.tenantId); return { allowed: true, enabled: false } } },
    realEstateOpportunityContext: { findFirst: () => { throw Error("Disabled property query") } },
  }
  assert.deepEqual(await realEstateQuotationContext(tx, actor, "deal"), [])
  assert.equal(checks, 1)
})

test("extension validation keeps field paths, strict core input and explicit conversion rules", () => {
  const base = { title: "Buyer", contactId: "contact", assignedUserId: "staff" }
  const { core, extension: values } = extension.splitWrite({ ...base, propertyContext: { projectId: "project", bedrooms: 2 } })
  assert.equal(crmEnquiryCreateSchema.parse(core).title, base.title)
  assert.equal("propertyContext" in core, false)
  assert.throws(() => extension.splitWrite({ ...base, propertyContext: { bedrooms: -1 } }), error => error.issues[0].path[0] === "propertyContext")
  assert.throws(() => crmEnquiryCreateSchema.parse(extension.splitWrite({ ...base, tenantId: "other" }).core))
  assert.throws(() => crmEnquiryCreateSchema.parse({ ...base, propertyContext: {} }))
  assert.throws(() => extension.assertConversionInput(values), error => error.status === 400)
  extension.assertConversionInput(extension.splitWrite(base).extension)
  assert.throws(() => extension.assertConversionInput(extension.splitWrite({ ...base, propertyContext: null }).extension), error => error.status === 400)
})

test("extension decoration batches one scoped lookup, including empty and module-off lists", async () => {
  let flags = 0, contexts = 0, enabled = true
  const records = Array.from({ length: 100 }, (_, i) => ({ id: `lead-${i}`, title: `Lead ${i}` }))
  const tx = {
    tenantModule: { findUnique: async ({ where }) => { flags++; assert.equal(where.tenantId_key.tenantId, actor.tenantId); return { allowed: true, enabled } } },
    realEstateEnquiryContext: { findMany: async ({ where }) => { contexts++; assert.equal(where.tenantId, actor.tenantId); assert.deepEqual(where.enquiryId.in, records.map(row => row.id)); return [{ enquiryId: "lead-99", bedrooms: 3 }] } },
  }
  const decorated = await extension.decorate(tx, actor, "enquiry", records)
  assert.equal(decorated.items[99].title, "Lead 99")
  assert.equal(decorated.items[99].propertyContext.bedrooms, 3)
  assert.equal(decorated.items[0].propertyContext, null)
  assert.deepEqual([flags, contexts], [1, 1])
  assert.deepEqual((await extension.decorate(tx, actor, "enquiry", [])).metadata, { realEstateEnabled: true })
  assert.deepEqual([flags, contexts], [2, 1])
  enabled = false
  const hidden = await extension.decorate(tx, actor, "enquiry", records)
  assert.equal(hidden.items.every(row => row.propertyContext === null), true)
  assert.deepEqual([flags, contexts], [3, 1])
})

test("report joins disappear when disabled and enabled filters remain parameterized", async () => {
  let enabled = false
  const tx = { tenantModule: { findUnique: async () => ({ allowed: true, enabled }) } }
  const hidden = await extension.report(tx, actor, {})
  assert.equal(hidden.enquiryJoins.text, "")
  assert.equal(hidden.opportunityJoins.text, "")
  await assert.rejects(extension.report(tx, actor, { projectId: "project" }), error => error.status === 403)
  enabled = true
  const projectId = "' OR true --"
  const visible = await extension.report(tx, actor, { projectId })
  assert.deepEqual(visible.filter.values, [projectId])
  assert.equal(visible.filter.text.includes(projectId), false)
  assert.match(visible.enquiryJoins.text, /x\."tenantId" = r\."tenantId"/)
  await assert.rejects(extension.report(tx, actor, { subprojectId: "child" }), error => error.status === 400)
})

test("operational routes stay HTTP adapters without direct database access", () => {
  for (const directory of ["appointments", "inventory", "services", "service-categories", "leaves", "shifts"]) {
    const root = path.join(__dirname, "../app/api", directory)
    for (const file of fs.readdirSync(root, { recursive: true }).filter(file => /\.ts$/.test(file))) {
      const source = fs.readFileSync(path.join(root, file), "utf8")
      assert.doesNotMatch(source, /(?:from\s+|import\s*\()["'][^"']*(?:lib\/prisma|@prisma\/client)/, `${directory}/${file}`)
      assert.doesNotMatch(source, /\$transaction|\$queryRaw|\$executeRaw/, `${directory}/${file}`)
    }
  }
})
