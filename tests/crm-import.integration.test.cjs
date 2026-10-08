/* eslint-disable @typescript-eslint/no-require-imports */
const { test, before, after } = require("node:test")
const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const { Pool } = require("pg")
const { PrismaClient } = require("@prisma/client")
const { PrismaPg } = require("@prisma/adapter-pg")
const ExcelJS = require("exceljs")
const { parse } = require("csv-parse/sync")
const { createApplicationCrmService } = require("../application/crm/service.ts")
const { parseImportFile } = require("../modules/crm/import-file.ts")
const { crmCsv } = require("../modules/crm/csv.ts")
require("../lib/logger.ts").logger.info = () => {}
const raw = process.env.CRM_TEST_DATABASE_URL, url = new URL(raw || "http://invalid")
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/ls_salon_crm_test") throw Error("Use the dedicated local CRM test database.")
const prefix = `import_${randomUUID().replaceAll("-", "")}`, a = prefix + "a", b = prefix + "b"
const pools = [], clients = []
function client(tenant, root = false) {
  const connection = new URL(raw)
  if (!root) { connection.username = "crm_test_runtime"; connection.password = "" }
  const pool = new Pool({ connectionString: connection.toString(), max: 4, ...(!root ? { options: `-c app.tenant_id=${tenant || ""} -c app.rls_bypass=off` } : {}) })
  const db = new PrismaClient({ adapter: new PrismaPg(pool) }); pools.push(pool); clients.push(db); return db
}
const root = client(null, true), dbA = client(a), dbB = client(b), none = client(null)
let admin, staff, other, service, restricted, second, project, subproject
const upload = (csv, svc = service) => svc.uploadEnquiryImport("leads.csv", Buffer.from(csv))
async function review(job, config = job.config, svc = service) {
  let result = await svc.configureEnquiryImport(job.id, config)
  while (result.status === "VALIDATING") result = await svc.processEnquiryImport(job.id, "validate")
  return result
}
async function finish(job, svc = service) {
  let result
  do { result = await svc.processEnquiryImport(job.id, "import") } while (result.status === "IMPORTING")
  return result
}
before(async () => {
  await root.tenant.createMany({ data: [{ id: a, slug: a, name: a }, { id: b, slug: b, name: b }] })
  admin = await root.user.create({ data: { tenantId: a, name: "Import admin", email: `${a}@test.example`, role: "ADMIN" } })
  staff = await root.user.create({ data: { tenantId: a, name: "Import staff", email: `${a}s@test.example`, role: "STAFF" } })
  other = await root.user.create({ data: { tenantId: b, name: "Other admin", email: `${b}@test.example`, role: "ADMIN" } })
  await root.tenantModule.createMany({ data: [a, b].flatMap(tenantId => ["crm", "realEstate"].map(key => ({ tenantId, key, allowed: true, enabled: true }))) })
  service = createApplicationCrmService(dbA, { tenantId: a, userId: admin.id })
  restricted = createApplicationCrmService(dbA, { tenantId: a, userId: staff.id })
  second = createApplicationCrmService(dbB, { tenantId: b, userId: other.id })
  project = await root.realEstateProject.create({ data: { tenantId: a, name: "Green Meadows", code: "GM", location: "Pune" } })
  subproject = await root.realEstateProject.create({ data: { tenantId: a, name: "Phase One", code: "GM-1", parentId: project.id, location: "Pune" } })
})
after(async () => { await Promise.all(clients.map(c => c.$disconnect())); await Promise.all(pools.map(p => p.end())) })

test("CSV supports quoted newlines and original row numbers; rejects malformed/oversized sheets", async () => {
  const sheet = await parseImportFile("test.csv", Buffer.from('Name,Email,Notes\n\nAlice,a@example.com,"hello,\nworld"\n'))
  assert.equal(sheet.rows[0].rowNumber, 3); assert.equal(sheet.rows[0].values[2], "hello,\nworld")
  await assert.rejects(parseImportFile("test.csv", Buffer.from('Name,Name\nA,B')), /unique/)
  await assert.rejects(parseImportFile("test.csv", Buffer.from('Name,Email\n"unclosed')), /Unable to read/)
  await assert.rejects(parseImportFile("test.csv", Buffer.from('Name,Email\n' + 'A,a@b.com\n'.repeat(1001))), /1,?000/)
  await assert.rejects(parseImportFile("test.exe", Buffer.from('Name,Email\nA,B')), /CSV or XLSX/)
})
test("XLSX imports only first sheet, preserves dates and rejects formula rows", async () => {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("Enquiries")
  sheet.addRow(["Name", "Email", "Target close date"])
  sheet.addRow(["Excel", "excel@example.com", new Date("2026-11-01T00:00:00Z")])
  sheet.addRow(["Formula", { formula: '"formula@example.com"', result: "formula@example.com" }])
  book.addWorksheet("Ignore").addRow(["not a lead"])
  const parsed = await parseImportFile("leads.xlsx", new Uint8Array(await book.xlsx.writeBuffer()))
  assert.equal(parsed.rows.length, 2); assert.equal(parsed.rows[0].values[2], "2026-11-01")
  assert.match(parsed.rows[1].errors[0].message, /formulas/)
})
let mixed
test("template follows enabled modules and editable custom fields and its headers map on upload", async () => {
  const field = await root.customFieldDefinition.create({ data: { tenantId: a, scope: "ENQUIRY", code: "template_note", name: "Contact name", type: "TEXT" } })
  try {
    const csv = await service.downloadEnquiryImportTemplate()
    const rows = parse(csv, { bom: true })
    assert.equal(rows.length, 1)
    const headers = rows[0]
    assert.ok(headers.includes("Contact name")); assert.ok(headers.includes("Project")); assert.ok(headers.includes("enquiry.template_note"))
    assert.equal(new Set(headers).size, headers.length)
    const values = headers.map(h => ({ "Contact name": "Template contact", Email: "template@example.com", "enquiry.template_note": "A note" })[h] || "")
    const job = await upload(crmCsv(headers, [values]))
    assert.equal(Object.keys(job.config.mapping).length, headers.length)
    const checked = await review(job)
    assert.equal(checked.counts.READY, 1)
    await root.tenantModule.update({ where: { tenantId_key: { tenantId: a, key: "realEstate" } }, data: { enabled: false } })
    assert.ok(!parse(await service.downloadEnquiryImportTemplate(), { bom: true })[0].includes("Project"))
  } finally {
    await root.tenantModule.update({ where: { tenantId_key: { tenantId: a, key: "realEstate" } }, data: { enabled: true } })
    await root.customFieldDefinition.update({ where: { tenantId_id: { tenantId: a, id: field.id } }, data: { archived: true } })
  }
})
test("preview writes no CRM records; duplicates, bad email, missing identity and source typos are isolated", async () => {
  await root.crmContact.create({ data: { tenantId: a, ownerUserId: admin.id, name: "Existing", email: "EXISTING@example.com", archived: true } })
  await service.createLeadSource({ name: "Website" })
  const before = await dbA.crmContact.count()
  const job = await upload('Name,Email,Phone,Source,Project,Subproject\nAlice,ALICE@example.com,+91 98765 43210,Website,GM,GM-1\nRepeat,alice@example.com,,,GM,GM-1\nExisting,existing@example.com,,,,\nBad,bad-address,,,,\nMissing,,,,,\nTypo,typo@example.com,,Webiste,,\nPhone repeat,,+919876543210,,,\n')
  mixed = await review(job)
  assert.equal(await dbA.crmContact.count(), before); assert.equal(await dbA.crmEnquiry.count(), 0)
  assert.deepEqual(mixed.counts, { READY: 1, DUPLICATE: 3, INVALID: 3 })
  assert.match(mixed.items.find(r => r.rowNumber === 7).errors[0].message, /No active matching/)
})
test("commit creates linked project context and audit once, concurrent retries are idempotent", async () => {
  await Promise.all([finish(mixed), finish(mixed)])
  const done = await service.getEnquiryImport(mixed.id)
  assert.equal(done.status, "COMPLETE"); assert.equal(done.counts.IMPORTED, 1)
  assert.equal(await dbA.crmEnquiry.count(), 1)
  const enquiry = await dbA.crmEnquiry.findFirst({ include: { contact: true, propertyContext: true } })
  assert.equal(enquiry.contact.email, "alice@example.com"); assert.equal(enquiry.contact.phone, "+919876543210")
  assert.equal(enquiry.propertyContext.subprojectId, subproject.id)
  assert.equal(await root.auditLog.count({ where: { tenantId: a, entityId: enquiry.id, event: "crm.enquiry.created" } }), 1)
  await finish(mixed); assert.equal(await dbA.crmEnquiry.count(), 1)
})
test("correction CSV contains only unsuccessful rows, is formula safe and can be reimported", async () => {
  const csv = await service.downloadEnquiryImportErrors(mixed.id)
  const records = parse(csv, { bom: true, columns: true })
  assert.equal(records.length, 6); assert.ok(records.every(r => r.Name !== "Alice"))
  assert.ok(records[0]["Import errors"].includes("Duplicate"))
  const bad = records.find(r => r.Name === "Bad"); bad.Email = "fixed@example.com"
  const headers = Object.keys(bad)
  const corrected = await review(await upload(crmCsv(headers, [headers.map(k => bad[k])])))
  assert.equal(corrected.counts.READY, 1)
  await finish(corrected)
  const unchanged = await review(await upload(csv))
  assert.equal(unchanged.counts.DUPLICATE, 3)
  assert.equal((await parseImportFile("c.csv", Buffer.from(crmCsv(["Name", "Phone"], [["=1+1", "+919111111111"]])))).rows[0].values[0], "'=1+1")
})
test("imports are private to creator and tenant and enforce RLS/module access", async () => {
  await assert.rejects(restricted.getEnquiryImport(mixed.id), e => e.status === 404)
  await assert.rejects(second.getEnquiryImport(mixed.id), e => e.status === 404)
  assert.equal(await dbB.crmEnquiryImport.count(), 0); assert.equal(await none.crmEnquiryImportRow.count(), 0)
  const own = await review(await upload('Name,Email\nAlice,alice@example.com', second), undefined, second)
  assert.equal(own.counts.READY, 1) // Another tenant's email is not a duplicate.
  await root.tenantModule.update({ where: { tenantId_key: { tenantId: b, key: "crm" } }, data: { enabled: false } })
  await assert.rejects(second.processEnquiryImport(own.id, "import"), e => e.status === 403)
})
test("required custom fields/options validate through the same form rules; bad row creates no orphan", async () => {
  const field = await root.customFieldDefinition.create({ data: { tenantId: a, scope: "ENQUIRY", code: "interest", name: "Interest", type: "SELECT", required: true, requiredSince: new Date(), options: { create: { name: "Apartment" } } }, include: { options: true } })
  const job = await upload('Name,Email,Interest\nCustom,cust@example.com,Apartment\nInvalid,invalid@example.com,Apartmnt\nMissing,miscustom@example.com,')
  const checked = await review(job)
  assert.equal(checked.counts.READY, 1); assert.equal(checked.counts.INVALID, 2)
  // A setting can change after preview; commit must revalidate without leaving a contact.
  await root.customFieldOption.update({ where: { tenantId_fieldId_id: { tenantId: a, fieldId: field.id, id: field.options[0].id } }, data: { archived: true } })
  const done = await finish(checked)
  assert.equal(done.counts.INVALID, 3); assert.equal(done.counts.IMPORTED, undefined)
  assert.equal(await dbA.crmContact.count({ where: { email: "cust@example.com" } }), 0)
  await root.customFieldDefinition.update({ where: { tenantId_id: { tenantId: a, id: field.id } }, data: { archived: true } })
})
test("unknown subprojects, invalid dates, assignment errors skip only affected rows", async () => {
  const checked = await review(await upload('Name,Email,Project,Subproject,Target close date,Salesperson\nWrong,badproject@example.com,GM,unknown,,\nDate,baddate@example.com,,,2026-02-30,\nAssignee,badassign@example.com,,,,nobody\nFine,fine@example.com,GM,GM-1,2026-12-01,'))
  assert.equal(checked.counts.INVALID, 3); assert.equal(checked.counts.READY, 1)
})
test("staff see permitted defaults only, and private duplicate contact details are never disclosed", async () => {
  const job = await upload('Name,Email\nHidden,EXISTING@example.com', restricted)
  assert.deepEqual(job.fields.find(f => f.key === "assignedUserId").choices.map(c => c.id), [staff.id])
  const checked = await review(job, undefined, restricted)
  assert.equal(checked.counts.DUPLICATE, 1)
  assert.ok(!JSON.stringify(checked.items[0].errors).includes(admin.id))
})
test("new required fields after preview roll back the entire row, including its new contact", async () => {
  const job = await review(await upload('Name,Email\nAtomic,atomic@example.com'))
  const field = await root.customFieldDefinition.create({ data: { tenantId: a, scope: "ENQUIRY", code: "required_after_preview", name: "Required after preview", type: "TEXT", required: true, requiredSince: new Date() } })
  const result = await finish(job)
  assert.equal(result.counts.INVALID, 1)
  assert.equal(await dbA.crmContact.count({ where: { email: "atomic@example.com" } }), 0)
  await root.customFieldDefinition.update({ where: { tenantId_id: { tenantId: a, id: field.id } }, data: { archived: true } })
})
test("a disabled extension after review cannot silently discard mapped project fields", async () => {
  const job = await review(await upload('Name,Email,Project\nDisabled,disabled@example.com,GM'))
  await root.tenantModule.update({ where: { tenantId_key: { tenantId: a, key: "realEstate" } }, data: { enabled: false } })
  const result = await finish(job)
  assert.equal(result.counts.INVALID, 1)
  assert.equal(await dbA.crmContact.count({ where: { email: "disabled@example.com" } }), 0)
  await root.tenantModule.update({ where: { tenantId_key: { tenantId: a, key: "realEstate" } }, data: { enabled: true } })
})
test("role without contacts.create cannot upload or inspect import history", async () => {
  const role = await root.tenantAccessRole.create({ data: { tenantId: a, name: "No contacts", nameKey: "no contacts", permissions: ["enquiries.read", "enquiries.create", "contacts.read"] } })
  await root.tenantRoleAssignment.create({ data: { tenantId: a, userId: staff.id, roleId: role.id } })
  await assert.rejects(upload('Name,Email\nDenied,denied@example.com', restricted), e => e.status === 403)
  await assert.rejects(restricted.listEnquiryImports({}), e => e.status === 403)
  await assert.rejects(restricted.downloadEnquiryImportTemplate(), e => e.status === 403)
})
