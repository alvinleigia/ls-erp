import { accessResources, type Requirement, type Resource } from "../access/catalog"
import { resourceRegistry, type ResourceOwnership, type OwnershipPart } from "../access/resource-registry"
import type { BusinessModuleKey } from "../modules"

type AuditFamily = {
  prefix: string
  boundary: "security" | "shared" | "source" | "composed"
  read?: Requirement
  modules?: readonly BusinessModuleKey[]
  adminOnly?: boolean
  fullAudit?: boolean
  unscoped?: readonly Resource[]
}

// Reuse resource ownership/module contracts for simple audit families. Split
// resources require an explicit component, so stock cannot become shared history.
function resourceFamily(resource: Resource, prefix: string, component?: string): AuditFamily {
  const contract: ResourceOwnership = resourceRegistry[resource].ownership
  let ownership: OwnershipPart
  if (contract.kind === "split") {
    if (!component || !Object.hasOwn(contract.parts, component)) throw new Error("Select a registered ownership component for this audit family.")
    ownership = contract.parts[component]
  } else {
    if (component) throw new Error("This audit resource has no ownership components.")
    ownership = contract
  }
  const boundary = ownership.kind === "office" || ownership.kind === "personal" ? "source" : ownership.kind
  const moduleKey = accessResources[resource].module
  return { prefix, boundary, read: `${resource}.read`, ...(moduleKey === "core" ? {} : { modules: [moduleKey] }) }
}

// Closed report registry. A more specific prefix always overrides its parent,
// even when that family's module or permission is unavailable. Unknown events
// stay stored but cannot enter the composed report through a broad fallback.
export const auditFamilies: readonly AuditFamily[] = [
  ...["collaborator.", "workspace.", "structure.", "access.", "module.", "tenant.", "organization.", "core.invitations.", "crm.team.", "team."].map(prefix => ({ prefix, boundary: "security" as const, adminOnly: true })),
  resourceFamily("businessSettings", "core.businessSettings."),
  resourceFamily("taxRates", "core.taxRates."),
  resourceFamily("branding", "branding."),
  resourceFamily("businessSettings", "terminology."),
  ...(["inventoryProducts", "inventoryCategories", "inventorySuppliers", "inventoryPurchases"] as const).map(resource => resourceFamily(resource, `inventory.${resource}.`, resource === "inventoryProducts" ? "catalog" : undefined)),
  resourceFamily("inventoryProducts", "inventory.stock.", "stock"),
  ...(["services", "serviceCategories"] as const).map(resource => resourceFamily(resource, `services.${resource}.`)),
  { prefix: "services.eligibility.", boundary: "composed", modules: ["services"], adminOnly: true, fullAudit: true },
  ...(["leaveDefinitions", "leaveGroups", "shiftTemplates", "shiftSchedules", "shiftPlans", "shiftRoster"] as const).map(resource => resourceFamily(resource, `workforce.${resource}.`, resource === "shiftRoster" ? "daily" : undefined)),
  { ...resourceFamily("leaveApprovals", "leave.request."), fullAudit: true, adminOnly: true },
  ...["appointment.", "appointments.order.", "appointments.invoice."].map(prefix => resourceFamily("appointments", prefix)),
  resourceFamily("appointmentCoupons", "appointments.coupon."),
  // These composed sales snapshots remain administrator-only. Non-admin users
  // use scoped record timelines; this report must not broaden that audience.
  { prefix: "crm.", boundary: "composed", modules: ["crm"], adminOnly: true },
  { ...resourceFamily("quotations", "crm.quotation."), adminOnly: true },
  { ...resourceFamily("quotationTemplates", "crm.quotationTemplate."), adminOnly: true },
  { prefix: "crm.customField", boundary: "composed", modules: ["crm"], read: ["customFields.read", "restrictedFields.read"], adminOnly: true },
  { prefix: "realEstate.", boundary: "composed", modules: ["realEstate"], read: "projects.read", adminOnly: true },
  { prefix: "catalog.", boundary: "composed", modules: ["catalog"], read: "catalogItems.read", unscoped: ["projects"] },
  { prefix: "catalog.reservation.", boundary: "source", modules: ["catalog", "salesOrders"], read: ["catalogItems.read", "unitReservations.read", "salesOrders.read"], fullAudit: true, unscoped: ["enquiries", "opportunities", "contacts", "accounts", "activities", "quotations", "salesOrders", "receivables", "orderPayments", "projects"] },
  { ...resourceFamily("salesOrders", "salesOrder."), adminOnly: true },
  { ...resourceFamily("receivables", "receivable."), read: ["salesOrders.read", "receivables.read", "orderPayments.read"], fullAudit: true, adminOnly: true },
]
