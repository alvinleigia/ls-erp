import { createHash } from "node:crypto"
import type { Prisma } from "@prisma/client"
import { z } from "zod"
import { CrmError, canManageCrm, type CrmActor } from "./policy"

export type PresetItem = {
  key: string; label: string; description: string
  inspect: (tx: Prisma.TransactionClient, tenantId: string, id: string) => Promise<{ id: string; version?: number } | null>
  create: (tx: Prisma.TransactionClient, tenantId: string, id: string) => Promise<unknown>
}
export type CrmPreset = { id: string; name: string; version: number; module: string; items: PresetItem[] }
type Context = {
  run: <T>(operation: (tx: Prisma.TransactionClient, actor: CrmActor) => Promise<T>) => Promise<T>
  audit: (tx: Prisma.TransactionClient, actor: CrmActor, event: string, id: string, before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue) => Promise<void>
}
export function createPresetService({ run, audit }: Context, presets: readonly CrmPreset[]) {
  async function preview(tx: Prisma.TransactionClient, actor: CrmActor, presetId: string) {
    if (!canManageCrm(actor.role)) throw new CrmError(403, "Only managers can apply configuration presets.")
    const preset = presets.find(preset => preset.id === presetId)
    if (!preset) throw new CrmError(404, "Preset not found.")
    if (!await tx.tenantModule.findFirst({ where: { tenantId: actor.tenantId, key: preset.module, enabled: true } })) throw new CrmError(403, "Enable the preset's business module first.")
    const items = await Promise.all(preset.items.map(async item => {
      const id = createHash("sha256").update(`${actor.tenantId}:${preset.id}:${item.key}`).digest("hex")
      const existing = await item.inspect(tx, actor.tenantId, id)
      return { id, key: item.key, label: item.label, description: item.description, action: existing ? "KEEP" : "ADD", existing }
    }))
    const token = createHash("sha256").update(JSON.stringify({ tenantId: actor.tenantId, preset: preset.id, version: preset.version, items })).digest("hex")
    return { id: preset.id, name: preset.name, version: preset.version, token, items }
  }
  return {
    listPresets() {
      return run(async (tx, actor) => {
        if (!canManageCrm(actor.role)) throw new CrmError(403, "Only managers can configure presets.")
        const modules = await tx.tenantModule.findMany({ where: { tenantId: actor.tenantId, enabled: true } })
        return presets.filter(preset => modules.some(module => module.key === preset.module)).map(({ id, name, version }) => ({ id, name, version }))
      })
    },
    previewPreset(id: string) { return run((tx, actor) => preview(tx, actor, id)) },
    applyPreset(id: string, input: unknown) {
      const { token } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(input)
      return run(async (tx, actor) => {
        const review = await preview(tx, actor, id)
        if (review.token !== token) throw new CrmError(409, "Configuration changed. Preview the preset again before applying.")
        const preset = presets.find(preset => preset.id === id)!
        for (const row of review.items.filter(row => row.action === "ADD")) {
          await preset.items.find(item => item.key === row.key)!.create(tx, actor.tenantId, row.id)
          await audit(tx, actor, "crm.preset.item.created", row.id, undefined, { presetId: id, version: preset.version, key: row.key, label: row.label })
        }
        await audit(tx, actor, "crm.preset.applied", id, undefined, { version: preset.version, added: review.items.filter(row => row.action === "ADD").map(row => row.key) })
        return preview(tx, actor, id)
      })
    },
  }
}
