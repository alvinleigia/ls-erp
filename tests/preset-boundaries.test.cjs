/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { createPresetService } = require("../modules/crm/preset-service.ts")
const { crmPresets } = require("../application/crm/presets.ts")
const { requirePermission } = require("../platform/access/policy.ts")

test("disabled preset preview and apply do not inspect or write business tables", async () => {
  const actor = { tenantId: "preset-tenant", userId: "manager", role: "MANAGER" }
  const tx = new Proxy({ tenantModule: { findFirst: async ({ where }) => {
    assert.equal(where.tenantId, actor.tenantId)
    assert.equal(where.key, "realEstate")
    return null
  } } }, { get(target, key) { if (!(key in target)) throw Error(`Unexpected business access: ${String(key)}`); return target[key] } })
  const service = createPresetService({ run: async (requirement, operation) => { requirePermission(actor, requirement); return operation(tx, actor) }, audit: () => { throw Error("Unexpected audit write") } }, crmPresets)
  await assert.rejects(service.previewPreset("real-estate-sales"), e => e.status === 403)
  await assert.rejects(service.applyPreset("real-estate-sales", { token: "a".repeat(64) }), e => e.status === 403)
})

test("preset resource permissions are checked before that resource is inspected", async () => {
  const actor = { tenantId: "preset-tenant", userId: "manager", role: "MANAGER", permissions: ["pipelines.read"] }
  const tx = new Proxy({ tenantModule: { findFirst: async () => ({ enabled: true, allowed: true }) } }, { get(target, key) { if (!(key in target)) throw Error(`Unauthorized query: ${String(key)}`); return target[key] } })
  const service = createPresetService({ run: async (requirement, operation) => { requirePermission(actor, requirement); return operation(tx, actor) }, audit: () => { throw Error("Unexpected audit write") } }, crmPresets)
  await assert.rejects(service.previewPreset("real-estate-sales"), e => e.status === 403)
  await assert.rejects(service.applyPreset("real-estate-sales", { token: "a".repeat(64) }), e => e.status === 403)
})
