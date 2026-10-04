import { withBusinessApi, readJson } from "@/platform/business-api"
import { BusinessError } from "@/platform/policy"
import { requireBusinessModule } from "@/platform/module-server"
import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import {
  AppointmentOrderStatus,
  AppointmentStatus,
  InventoryCategoryStatus,
  InventoryProductStatus,
  LeaveDefinitionAllowedUsers,
  LeaveDefinitionStatus,
  LeaveDefinitionType,
  LeaveGroupAssignmentMode,
  LeaveGroupStatus,
  PurchaseOrderStatus,
  Role,
  ServiceType,
  SupplierStatus,
  UserStatus,
  Weekday,
} from "@prisma/client"
import bcrypt from "bcryptjs"
import { z } from "zod"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { checkStaffAppointmentAvailability } from "@/app/api/appointments/_availability"
import { canManageUsers } from "@/lib/permissions"
import { prisma } from "@/lib/prisma"
import { requireTenantSession } from "@/lib/tenant-auth"

export const dynamic = "force-dynamic"

const seedGroupValues = [
  "taxes",
  "users",
  "serviceCatalog",
  "inventoryCatalog",
  "purchases",
  "leaves",
  "shifts",
  "appointments",
  "coupons",
] as const

type SeedGroup = (typeof seedGroupValues)[number]

const clearModuleValues = [
  "appointments",
  "coupons",
  "purchases",
  "inventory",
  "shifts",
  "services",
  "taxes",
  "users",
] as const

type ClearModule = (typeof clearModuleValues)[number]
type ClearMode = "strict" | "include_dependents"

const requestSchema = z.object({
  action: z.enum(["seed", "clear", "previewClear", "previewModulesClear", "clearModules"]),
  groups: z.array(z.enum(seedGroupValues)).optional(),
  modules: z.array(z.enum(clearModuleValues)).optional(),
  mode: z.enum(["strict", "include_dependents"]).optional(),
})

const seededUsers = [
  { name: "Manager One", email: "manager1@ls-salon.test", role: Role.MANAGER },
  { name: "Manager Two", email: "manager2@ls-salon.test", role: Role.MANAGER },
  { name: "Staff One", email: "staff1@ls-salon.test", role: Role.STAFF },
  { name: "Staff Two", email: "staff2@ls-salon.test", role: Role.STAFF },
  { name: "Staff Three", email: "staff3@ls-salon.test", role: Role.STAFF },
  { name: "Staff Four", email: "staff4@ls-salon.test", role: Role.STAFF },
  { name: "Staff Five", email: "staff5@ls-salon.test", role: Role.STAFF },
  { name: "Customer One", email: "customer1@ls-salon.test", role: Role.CUSTOMER },
  { name: "Customer Two", email: "customer2@ls-salon.test", role: Role.CUSTOMER },
  { name: "Customer Three", email: "customer3@ls-salon.test", role: Role.CUSTOMER },
  { name: "Customer Four", email: "customer4@ls-salon.test", role: Role.CUSTOMER },
  { name: "Customer Five", email: "customer5@ls-salon.test", role: Role.CUSTOMER },
]

const seededFlexibleStaffBaseEmails = ["staff4@ls-salon.test", "staff5@ls-salon.test"] as const

const serviceCategorySeeds = [
  { name: "Hair Services", description: "Haircut, styling, and coloring." },
  { name: "Skin Services", description: "Facials and skin care services." },
]

const serviceSeeds = [
  {
    name: "Haircut",
    description: "Standard haircut.",
    durationMinutes: 45,
    priceCents: 3500,
    type: ServiceType.STANDARD,
    categoryName: "Hair Services",
    taxNames: ["GST 18%"],
  },
  {
    name: "Hair Coloring",
    description: "Global hair coloring.",
    durationMinutes: 90,
    priceCents: 6500,
    type: ServiceType.STANDARD,
    categoryName: "Hair Services",
    taxNames: ["GST 18%"],
  },
  {
    name: "Classic Facial",
    description: "Cleansing and hydration facial.",
    durationMinutes: 60,
    priceCents: 5000,
    type: ServiceType.STANDARD,
    categoryName: "Skin Services",
    taxNames: ["GST 18%"],
  },
  {
    name: "Beard Trim",
    description: "Precision beard shaping.",
    durationMinutes: 30,
    priceCents: 2200,
    type: ServiceType.STANDARD,
    categoryName: "Hair Services",
    taxNames: ["GST 18%"],
  },
  {
    name: "Hair Spa",
    description: "Repair and hydration treatment.",
    durationMinutes: 60,
    priceCents: 4200,
    type: ServiceType.STANDARD,
    categoryName: "Hair Services",
    taxNames: ["GST 18%"],
  },
  {
    name: "Keratin Treatment",
    description: "Smoothing and anti-frizz treatment.",
    durationMinutes: 120,
    priceCents: 9800,
    type: ServiceType.STANDARD,
    categoryName: "Hair Services",
    taxNames: ["GST 18%"],
  },
  {
    name: "Express Cleanup Facial",
    description: "Quick refresh facial.",
    durationMinutes: 35,
    priceCents: 2800,
    type: ServiceType.STANDARD,
    categoryName: "Skin Services",
    taxNames: ["GST 18%"],
  },
  {
    name: "Detan Facial",
    description: "Pigmentation-focused facial.",
    durationMinutes: 75,
    priceCents: 5600,
    type: ServiceType.STANDARD,
    categoryName: "Skin Services",
    taxNames: ["GST 18%"],
  },
  {
    name: "Glow Ritual Package",
    description: "Hair + skin glow combo package.",
    durationMinutes: 105,
    priceCents: 8200,
    type: ServiceType.PACKAGE,
    categoryName: "Skin Services",
    taxNames: ["GST 18%"],
    packageItemNames: ["Hair Spa", "Classic Facial"],
  },
  {
    name: "Bridal Prep Package",
    description: "Pre-event hair and skin prep package.",
    durationMinutes: 165,
    priceCents: 12400,
    type: ServiceType.PACKAGE,
    categoryName: "Hair Services",
    taxNames: ["GST 18%"],
    packageItemNames: ["Hair Coloring", "Detan Facial"],
  },
]

const inventoryCategorySeeds = [
  { name: "Hair Care", description: "Shampoo, conditioner, and treatment products." },
  { name: "Skin Care", description: "Cleansers and masks." },
]

const supplierSeeds = [
  { name: "Glow Supplies", email: "sales@glow-supplies.test", phone: "555-0101" },
  { name: "Pro Beauty Wholesale", email: "orders@probeauty.test", phone: "555-0102" },
]

const productSeeds = [
  {
    sku: "HC-SHAMPOO-001",
    name: "Repair Shampoo",
    categoryName: "Hair Care",
    supplierName: "Glow Supplies",
    costPriceCents: 900,
    mrpCents: 1500,
    reorderPoint: 10,
    reorderQty: 30,
    initialQty: 60,
    taxNames: ["VAT 5%"],
  },
  {
    sku: "HC-SERUM-001",
    name: "Hair Serum",
    categoryName: "Hair Care",
    supplierName: "Pro Beauty Wholesale",
    costPriceCents: 700,
    mrpCents: 1200,
    reorderPoint: 8,
    reorderQty: 25,
    initialQty: 40,
    taxNames: ["VAT 5%"],
  },
  {
    sku: "SC-MASK-001",
    name: "Hydration Face Mask",
    categoryName: "Skin Care",
    supplierName: "Glow Supplies",
    costPriceCents: 500,
    mrpCents: 900,
    reorderPoint: 12,
    reorderQty: 40,
    initialQty: 80,
    taxNames: ["VAT 5%"],
  },
]

const couponSeeds = [
  {
    code: "WELCOME10",
    name: "Welcome 10%",
    discountType: "PERCENT" as const,
    discountValue: 10,
    appliesTo: "ORDER" as const,
  },
  {
    code: "SKIN500",
    name: "Skin care flat 5.00",
    discountType: "AMOUNT" as const,
    discountValue: 5,
    appliesTo: "SERVICE_LINES" as const,
  },
]

const shiftTemplateSeeds = [
  {
    name: "Morning Shift",
    description: "Morning operations template.",
    color: "#0ea5e9",
    startTime: "09:00",
    endTime: "17:00",
    breaks: [{ startTime: "13:00", endTime: "13:30", sortOrder: 0 }],
  },
  {
    name: "Evening Shift",
    description: "Evening operations template.",
    color: "#f59e0b",
    startTime: "12:00",
    endTime: "20:00",
    breaks: [{ startTime: "16:00", endTime: "16:30", sortOrder: 0 }],
  },
]

const leaveDefinitionSeeds = [
  {
    code: "PAID",
    name: "Paid Leave",
    leaveType: LeaveDefinitionType.PAID,
    allowedUsers: LeaveDefinitionAllowedUsers.ALL,
    minDaysPerRequest: 1,
    maxDaysPerRequest: 15,
    allowWithOtherLeaves: true,
    priorEntryAllowed: true,
    noticeDays: 1,
    allowCarryForward: true,
    weekOffSingleSideAllowed: true,
    weekOffBothSideAllowed: true,
    holidaySingleSideAllowed: true,
    holidayBothSideAllowed: true,
    maxPendingRequests: 2,
    status: LeaveDefinitionStatus.ACTIVE,
    sortOrder: 1,
    blockedCodes: ["LAYOFF"],
  },
  {
    code: "LAYOFF",
    name: "Lay Off",
    leaveType: LeaveDefinitionType.LAY_OFF,
    allowedUsers: LeaveDefinitionAllowedUsers.ALL,
    minDaysPerRequest: 1,
    maxDaysPerRequest: 30,
    allowWithOtherLeaves: false,
    priorEntryAllowed: false,
    noticeDays: 0,
    allowCarryForward: false,
    weekOffSingleSideAllowed: true,
    weekOffBothSideAllowed: false,
    holidaySingleSideAllowed: true,
    holidayBothSideAllowed: false,
    maxPendingRequests: 1,
    status: LeaveDefinitionStatus.ACTIVE,
    sortOrder: 2,
    blockedCodes: ["PAID", "COMP"],
  },
  {
    code: "UNPAID",
    name: "Unpaid Leave",
    leaveType: LeaveDefinitionType.UNPAID,
    allowedUsers: LeaveDefinitionAllowedUsers.ALL,
    minDaysPerRequest: 1,
    maxDaysPerRequest: 30,
    allowWithOtherLeaves: true,
    priorEntryAllowed: true,
    noticeDays: 0,
    allowCarryForward: false,
    weekOffSingleSideAllowed: true,
    weekOffBothSideAllowed: true,
    holidaySingleSideAllowed: true,
    holidayBothSideAllowed: true,
    maxPendingRequests: 3,
    status: LeaveDefinitionStatus.ACTIVE,
    sortOrder: 3,
    blockedCodes: [],
  },
  {
    code: "RESTRICTED",
    name: "Restricted Holiday",
    leaveType: LeaveDefinitionType.RESTRICTED,
    allowedUsers: LeaveDefinitionAllowedUsers.ALL,
    minDaysPerRequest: 1,
    maxDaysPerRequest: 2,
    allowWithOtherLeaves: true,
    priorEntryAllowed: false,
    noticeDays: 3,
    allowCarryForward: false,
    weekOffSingleSideAllowed: false,
    weekOffBothSideAllowed: false,
    holidaySingleSideAllowed: false,
    holidayBothSideAllowed: false,
    maxPendingRequests: 2,
    status: LeaveDefinitionStatus.ACTIVE,
    sortOrder: 4,
    blockedCodes: [],
  },
  {
    code: "COMP",
    name: "Compensatory Off",
    leaveType: LeaveDefinitionType.COMPENSATORY,
    allowedUsers: LeaveDefinitionAllowedUsers.ALL,
    minDaysPerRequest: 1,
    maxDaysPerRequest: 3,
    allowWithOtherLeaves: false,
    priorEntryAllowed: true,
    noticeDays: 0,
    allowCarryForward: false,
    weekOffSingleSideAllowed: false,
    weekOffBothSideAllowed: false,
    holidaySingleSideAllowed: false,
    holidayBothSideAllowed: false,
    maxPendingRequests: 2,
    status: LeaveDefinitionStatus.ACTIVE,
    sortOrder: 5,
    blockedCodes: ["LAYOFF"],
  },
  {
    code: "TOD",
    name: "Tour / On Duty",
    leaveType: LeaveDefinitionType.TOUR_ON_DUTY,
    allowedUsers: LeaveDefinitionAllowedUsers.ALL,
    minDaysPerRequest: 1,
    maxDaysPerRequest: 20,
    allowWithOtherLeaves: false,
    priorEntryAllowed: true,
    noticeDays: 2,
    allowCarryForward: false,
    weekOffSingleSideAllowed: true,
    weekOffBothSideAllowed: false,
    holidaySingleSideAllowed: true,
    holidayBothSideAllowed: false,
    maxPendingRequests: 2,
    status: LeaveDefinitionStatus.ACTIVE,
    sortOrder: 6,
    blockedCodes: [],
  },
] as const

const leaveGroupSeeds = [
  {
    code: "DEFAULT_ALL",
    name: "Default Staff Leave Group",
    description: "Baseline leave policy for all active staff.",
    assignmentMode: LeaveGroupAssignmentMode.ALL_STAFF,
    status: LeaveGroupStatus.ACTIVE,
    sortOrder: 1,
    leaveCodes: ["PAID", "UNPAID", "RESTRICTED", "COMP", "TOD"],
    staffCount: 0,
  },
  {
    code: "FIELD_TEAM",
    name: "Field Team Leave Group",
    description: "Leave policy for selected field staff members.",
    assignmentMode: LeaveGroupAssignmentMode.SELECTED_STAFF,
    status: LeaveGroupStatus.ACTIVE,
    sortOrder: 2,
    leaveCodes: ["LAYOFF", "UNPAID", "TOD"],
    staffCount: 2,
  },
] as const

const ensureAuthorized = async (request: Request) => {
  const tenantSession = await requireTenantSession(request)
  if (tenantSession.error) return { error: tenantSession.error }
  const role = tenantSession.context.role as Role | null
  if (!canManageUsers(role ?? null)) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  return { context: tenantSession.context }
}

const seededEmailForTenant = (tenantSlug: string, baseEmail: string) => {
  const [localPart, domainPart] = baseEmail.split("@")
  if (!localPart || !domainPart) return `${tenantSlug}.${baseEmail}`
  return `${localPart}.${tenantSlug}@${domainPart}`
}

const seededStaffEmailsForTenant = (tenantSlug: string) =>
  seededUsers
    .filter((user) => user.role === Role.STAFF)
    .map((user) => seededEmailForTenant(tenantSlug, user.email))

const seedTaxes = async (tenantId: string) => {
  const taxes = [
    { name: "GST 18%", percent: 18, sortOrder: 1 },
    { name: "VAT 5%", percent: 5, sortOrder: 2 },
  ]
  const created: string[] = []
  for (const tax of taxes) {
    const row = await prisma.tax.upsert({
      where: { tenantId_name: { tenantId: tenantId, name: tax.name } },
      update: {
        percent: tax.percent,
        isActive: true,
        sortOrder: tax.sortOrder,
      },
      create: {
        tenantId: tenantId,
        name: tax.name,
        percent: tax.percent,
        isActive: true,
        sortOrder: tax.sortOrder,
      },
    })
    created.push(row.id)
  }
  return { count: created.length }
}

const seedUsers = async (tenantId: string, tenantSlug: string) => {
  const passwordHash = await bcrypt.hash("password123", 10)
  let touched = 0
  const managerIds: string[] = []
  const staffUserIds: string[] = []
  for (const user of seededUsers) {
    const email = seededEmailForTenant(tenantSlug, user.email)
    const existing = await prisma.user.findFirst({
      where: { tenantId, email },
      select: { id: true },
    })
    const row = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            name: user.name,
            role: user.role,
            status: UserStatus.ACTIVE,
            passwordHash,
          },
        })
      : await prisma.user.create({
          data: {
            tenantId,
            name: user.name,
            email,
            role: user.role,
            status: UserStatus.ACTIVE,
            passwordHash,
          },
        })
    touched += 1
    if (row.role === Role.MANAGER) managerIds.push(row.id)
    if (row.role === Role.STAFF) staffUserIds.push(row.id)
  }

  for (const [index, staffUserId] of staffUserIds.entries()) {
    const managerUserId =
      managerIds.length > 0 ? managerIds[index % managerIds.length] : null
    await prisma.staffProfile.upsert({
      where: { userId: staffUserId },
      update: { managerUserId },
      create: { userId: staffUserId, managerUserId },
    })
  }
  return { count: touched }
}

const seedServiceCatalog = async (tenantId: string, tenantSlug: string) => {
  const categoryByName = new Map<string, string>()
  for (const item of serviceCategorySeeds) {
    const category = await prisma.serviceCategory.upsert({
      where: { tenantId_name: { tenantId: tenantId, name: item.name } },
      update: {
        description: item.description,
        status: "ACTIVE",
      },
      create: {
        tenantId: tenantId,
        name: item.name,
        description: item.description,
        status: "ACTIVE",
      },
    })
    categoryByName.set(item.name, category.id)
  }

  const taxByName = new Map(
    (
      await prisma.tax.findMany({
        where: { tenantId: tenantId, name: { in: ["GST 18%", "VAT 5%"] } },
        select: { id: true, name: true },
      })
    ).map((tax) => [tax.name, tax.id])
  )

  let touched = 0
  const seededServiceIds: string[] = []
  const serviceIdByName = new Map<string, string>()
  for (const item of serviceSeeds) {
    const categoryId = categoryByName.get(item.categoryName)
    if (!categoryId) continue
    const existing = await prisma.service.findFirst({
      where: { tenantId, name: item.name },
      select: { id: true },
    })
    const service = existing
      ? await prisma.service.update({
          where: { id: existing.id },
          data: {
            description: item.description,
            durationMinutes: item.durationMinutes,
            priceCents: item.priceCents,
            tenantId: tenantId,
            categoryId,
            status: "ACTIVE",
            type: item.type,
            taxMode: "EXCLUSIVE",
          },
        })
      : await prisma.service.create({
          data: {
            tenantId: tenantId,
            name: item.name,
            description: item.description,
            durationMinutes: item.durationMinutes,
            priceCents: item.priceCents,
            categoryId,
            status: "ACTIVE",
            type: item.type,
            taxMode: "EXCLUSIVE",
          },
        })

    const nextTaxIds = item.taxNames
      .map((name) => taxByName.get(name))
      .filter((id): id is string => Boolean(id))
    await prisma.serviceTax.deleteMany({ where: { serviceId: service.id } })
    if (nextTaxIds.length > 0) {
      await prisma.serviceTax.createMany({
        data: nextTaxIds.map((taxId) => ({
          serviceId: service.id,
          taxId,
        })),
      })
    }
    seededServiceIds.push(service.id)
    serviceIdByName.set(item.name, service.id)
    touched += 1
  }

  for (const item of serviceSeeds) {
    if (item.type !== ServiceType.PACKAGE) continue
    const packageId = serviceIdByName.get(item.name)
    if (!packageId) continue
    await prisma.servicePackageItem.deleteMany({ where: { packageId } })
    const packageItemNames = "packageItemNames" in item ? (item.packageItemNames ?? []) : []
    const packageItems = packageItemNames
      .map((itemName, index) => ({
        itemServiceId: serviceIdByName.get(itemName),
        sortOrder: index,
      }))
      .filter((entry): entry is { itemServiceId: string; sortOrder: number } => Boolean(entry.itemServiceId))
    if (packageItems.length > 0) {
      await prisma.servicePackageItem.createMany({
        data: packageItems.map((entry) => ({
          packageId,
          itemServiceId: entry.itemServiceId,
          sortOrder: entry.sortOrder,
        })),
      })
    }
  }

  const staffUsers = await prisma.user.findMany({
    where: {
      tenantId,
      role: Role.STAFF,
      email: {
        in: seededUsers
          .filter((user) => user.role === Role.STAFF)
          .map((user) => seededEmailForTenant(tenantSlug, user.email)),
      },
    },
    select: { id: true },
  })

  if (staffUsers.length > 0 && seededServiceIds.length > 0) {
    await prisma.staffServiceEligibility.deleteMany({
      where: {
        userId: { in: staffUsers.map((user) => user.id) },
        serviceId: { in: seededServiceIds },
      },
    })
    await prisma.staffServiceEligibility.createMany({
      data: staffUsers.flatMap((user) =>
        seededServiceIds.map((serviceId) => ({
          userId: user.id,
          serviceId,
        }))
      ),
      skipDuplicates: true,
    })
  }

  return { count: touched }
}

const seedInventoryCatalog = async (tenantId: string) => {
  const categoryByName = new Map<string, string>()
  for (const item of inventoryCategorySeeds) {
    const category = await prisma.inventoryCategory.upsert({
      where: { tenantId_name: { tenantId: tenantId, name: item.name } },
      update: {
        description: item.description,
        status: InventoryCategoryStatus.ACTIVE,
      },
      create: {
        tenantId: tenantId,
        name: item.name,
        description: item.description,
        status: InventoryCategoryStatus.ACTIVE,
      },
    })
    categoryByName.set(item.name, category.id)
  }

  const supplierByName = new Map<string, string>()
  for (const item of supplierSeeds) {
    const existing = await prisma.supplier.findFirst({
      where: { tenantId: tenantId, name: item.name },
    })
    const supplier = existing
      ? await prisma.supplier.update({
          where: { id: existing.id },
          data: {
            email: item.email,
            phone: item.phone,
            status: SupplierStatus.ACTIVE,
          },
        })
      : await prisma.supplier.create({
          data: {
            tenantId: tenantId,
            name: item.name,
            email: item.email,
            phone: item.phone,
            status: SupplierStatus.ACTIVE,
          },
        })
    supplierByName.set(item.name, supplier.id)
  }

  const taxByName = new Map(
    (
      await prisma.tax.findMany({
        where: { tenantId: tenantId, name: { in: ["GST 18%", "VAT 5%"] } },
        select: { id: true, name: true },
      })
    ).map((tax) => [tax.name, tax.id])
  )

  let touched = 0
  for (const item of productSeeds) {
    const categoryId = categoryByName.get(item.categoryName)
    const supplierId = supplierByName.get(item.supplierName)
    if (!categoryId || !supplierId) continue
    const product = await prisma.inventoryProduct.upsert({
      where: { tenantId_sku: { tenantId: tenantId, sku: item.sku } },
      update: {
        tenantId: tenantId,
        name: item.name,
        categoryId,
        status: InventoryProductStatus.ACTIVE,
        costPriceCents: item.costPriceCents,
        mrpCents: item.mrpCents,
        reorderPoint: item.reorderPoint,
        reorderQty: item.reorderQty,
        onHandQty: item.initialQty,
      },
      create: {
        tenantId: tenantId,
        sku: item.sku,
        name: item.name,
        categoryId,
        status: InventoryProductStatus.ACTIVE,
        costPriceCents: item.costPriceCents,
        mrpCents: item.mrpCents,
        reorderPoint: item.reorderPoint,
        reorderQty: item.reorderQty,
        onHandQty: item.initialQty,
      },
    })

    await prisma.inventoryProductSupplier.upsert({
      where: { productId_supplierId: { productId: product.id, supplierId } },
      update: {
        supplierCostCents: item.costPriceCents,
        isPreferred: true,
      },
      create: {
        productId: product.id,
        supplierId,
        supplierCostCents: item.costPriceCents,
        isPreferred: true,
      },
    })

    const taxIds = item.taxNames
      .map((name) => taxByName.get(name))
      .filter((id): id is string => Boolean(id))
    await prisma.inventoryProductTax.deleteMany({ where: { productId: product.id } })
    if (taxIds.length > 0) {
      await prisma.inventoryProductTax.createMany({
        data: taxIds.map((taxId) => ({ productId: product.id, taxId })),
      })
    }
    touched += 1
  }
  return { count: touched }
}

const seedPurchases = async (tenantId: string) => {
  const supplier = await prisma.supplier.findFirst({
    where: { tenantId: tenantId, name: supplierSeeds[0].name },
  })
  if (!supplier) {
    throw new Error("Supplier seeds are missing. Seed inventory catalog first.")
  }

  const products = await prisma.inventoryProduct.findMany({
    where: {
      tenantId: tenantId,
      sku: { in: [productSeeds[0].sku, productSeeds[1].sku] },
    },
    select: { id: true, sku: true },
  })
  if (products.length < 2) {
    throw new Error("Product seeds are missing. Seed inventory catalog first.")
  }
  const bySku = new Map(products.map((product) => [product.sku, product.id]))

  const orderNumber = "SEED-PO-001"
  const existing = await prisma.purchaseOrder.findUnique({
    where: { tenantId_orderNumber: { tenantId: tenantId, orderNumber } },
    select: { id: true },
  })
  if (existing) {
    return { count: 1 }
  }

  const lineInputs = [
    { sku: productSeeds[0].sku, quantity: 20, unitCostCents: 900, taxPercent: 5 },
    { sku: productSeeds[1].sku, quantity: 15, unitCostCents: 700, taxPercent: 5 },
  ]
  const lines = lineInputs.flatMap((line) => {
    const productId = bySku.get(line.sku)
    if (!productId) return []
    const lineSubtotalCents = line.quantity * line.unitCostCents
    const lineTaxCents = Math.round((lineSubtotalCents * line.taxPercent) / 100)
    return [{
      productId,
      quantity: line.quantity,
      receivedQty: line.quantity,
      unitCostCents: line.unitCostCents,
      taxPercent: line.taxPercent,
      lineSubtotalCents,
      lineTaxCents,
      lineTotalCents: lineSubtotalCents + lineTaxCents,
    }]
  })
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineSubtotalCents, 0)
  const taxCents = lines.reduce((sum, line) => sum + line.lineTaxCents, 0)

  const order = await prisma.purchaseOrder.create({
    data: {
      tenantId: tenantId,
      orderNumber,
      supplierId: supplier.id,
      status: PurchaseOrderStatus.RECEIVED,
      orderDate: new Date(),
      expectedDate: new Date(),
      receivedAt: new Date(),
      subtotalCents,
      taxCents,
      totalCents: subtotalCents + taxCents,
      items: { create: lines },
    },
    include: { items: true },
  })

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      await tx.inventoryProduct.update({
        where: { id: item.productId },
        data: { onHandQty: { increment: item.receivedQty } },
      })
      await tx.inventoryStockMovement.create({
        data: {
          tenantId: tenantId,
          productId: item.productId,
          orderItemId: item.id,
          type: "PURCHASE_RECEIPT",
          quantityDelta: item.receivedQty,
          unitCostCents: item.unitCostCents,
          note: `Seed purchase ${order.orderNumber}`,
        },
      })
    }
  })

  return { count: 1 }
}

const seedCoupons = async (tenantId: string) => {
  let touched = 0
  for (const item of couponSeeds) {
    await prisma.coupon.upsert({
      where: { tenantId_code: { tenantId: tenantId, code: item.code } },
      update: {
        name: item.name,
        discountType: item.discountType,
        discountValue: item.discountValue,
        appliesTo: item.appliesTo,
        isActive: true,
      },
      create: {
        tenantId: tenantId,
        code: item.code,
        name: item.name,
        discountType: item.discountType,
        discountValue: item.discountValue,
        appliesTo: item.appliesTo,
        isActive: true,
      },
    })
    touched += 1
  }
  return { count: touched }
}

const getDatePartsInTimeZone = (value: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const parts = formatter.formatToParts(value)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0")

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  }
}

const toDateKeyInTimeZone = (value: Date, timeZone: string) => {
  const parts = getDatePartsInTimeZone(value, timeZone)
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
}

const dateKeyToUtcDate = (value: string) => new Date(`${value}T00:00:00.000Z`)

const addDaysToDateKey = (value: string, days: number) => {
  const base = dateKeyToUtcDate(value)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

const zonedDateTimeToUtc = (
  dateKey: string,
  hour: number,
  minute: number,
  timeZone: string
) => {
  let probe = new Date(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`)

  // Converges quickly and keeps local time aligned to the tenant timezone.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const zoned = getDatePartsInTimeZone(probe, timeZone)
    const current = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute)
    const target = Date.UTC(
      Number(dateKey.slice(0, 4)),
      Number(dateKey.slice(5, 7)) - 1,
      Number(dateKey.slice(8, 10)),
      hour,
      minute
    )
    const deltaMinutes = Math.round((target - current) / 60000)
    if (deltaMinutes === 0) break
    probe = new Date(probe.getTime() + deltaMinutes * 60000)
  }

  return probe
}

const seedAppointments = async (tenantId: string, tenantSlug: string) => {
  const settings = await prisma.appSetting.findUnique({
    where: { tenantId },
    select: { timeZone: true },
  })
  const timeZone = settings?.timeZone || "America/New_York"
  const todayDateKey = toDateKeyInTimeZone(new Date(), timeZone)

  const customers = await prisma.user.findMany({
    where: {
      tenantId,
      role: Role.CUSTOMER,
      email: {
        in: seededUsers
          .filter((user) => user.role === Role.CUSTOMER)
          .map((user) => seededEmailForTenant(tenantSlug, user.email)),
      },
    },
    orderBy: { email: "asc" },
    take: 5,
    select: { id: true },
  })
  const staffProfiles = await prisma.staffProfile.findMany({
    where: {
      user: {
        tenantId,
        role: Role.STAFF,
        email: { in: seededStaffEmailsForTenant(tenantSlug) },
      },
    },
    orderBy: { user: { email: "asc" } },
    take: 5,
    select: { id: true },
  })
  const services = await prisma.service.findMany({
    where: {
      tenantId,
      type: ServiceType.STANDARD,
      name: { in: serviceSeeds.map((service) => service.name) },
    },
    orderBy: { name: "asc" },
    take: 5,
    select: {
      id: true,
      durationMinutes: true,
      priceCents: true,
      taxMode: true,
      defaultTaxes: {
        select: {
          tax: {
            select: {
              id: true,
              name: true,
              percent: true,
            },
          },
        },
      },
    },
  })
  if (!customers.length || !staffProfiles.length || !services.length) {
    throw new Error("User and service seeds are required before seeding appointments.")
  }

  // Rebuild only seeded appointment rows so reruns stay deterministic without touching user-entered data.
  const existingSeededOrders = await prisma.appointmentOrder.findMany({
    where: {
      tenantId,
      internalNote: { startsWith: "SEED_APPT_" },
    },
    select: {
      id: true,
      lines: { select: { id: true } },
    },
  })
  if (existingSeededOrders.length > 0) {
    const seededOrderIds = existingSeededOrders.map((order) => order.id)
    const seededLineIds = existingSeededOrders.flatMap((order) => order.lines.map((line) => line.id))
    if (seededLineIds.length > 0) {
      await prisma.appointment.deleteMany({
        where: {
          tenantId,
          orderLineId: { in: seededLineIds },
        },
      })
    }
    await prisma.appointmentOrder.deleteMany({
      where: {
        id: { in: seededOrderIds },
      },
    })
  }

  const weightedServiceIndices = Array.from(
    { length: Math.max(services.length, 5) * 2 },
    (_, index) => {
      if (services.length === 1) return 0
      if (services.length === 2) return index % 2 === 0 ? 0 : 1
      if (services.length === 3) return [0, 0, 1, 1, 2, 0][index % 6]
      if (services.length === 4) return [0, 0, 1, 1, 2, 3, 0, 1][index % 8]
      return [0, 0, 1, 1, 2, 3, 4, 0, 1, 2][index % 10]
    }
  )
  const weightedStaffIndices = Array.from(
    { length: Math.max(staffProfiles.length, 5) * 2 },
    (_, index) => {
      if (staffProfiles.length === 1) return 0
      if (staffProfiles.length === 2) return index % 3 === 0 ? 1 : 0
      if (staffProfiles.length === 3) return [0, 0, 1, 2, 0, 1][index % 6]
      if (staffProfiles.length === 4) return [0, 0, 1, 2, 3, 0, 1, 2][index % 8]
      return [0, 0, 1, 1, 2, 3, 4, 0, 1, 2][index % 10]
    }
  )

  const buildScenario = (
    index: number,
    phase: "past" | "today" | "future",
    appointmentStatus: AppointmentStatus
  ) => {
    const orderStatus =
      appointmentStatus === AppointmentStatus.CANCELED ||
      appointmentStatus === AppointmentStatus.NO_SHOW
        ? AppointmentOrderStatus.CANCELED
        : appointmentStatus === AppointmentStatus.COMPLETED
          ? AppointmentOrderStatus.COMPLETED
          : AppointmentOrderStatus.CONFIRMED

    const dayOffset =
      phase === "past"
        ? -1 - (index % 21)
        : phase === "today"
          ? 0
          : 1 + Math.floor(index / 2)

    const hourBase = phase === "today" ? 9 : phase === "past" ? 10 : 11
    const hour = hourBase + (index % 8)
    const minute = (index % 2) * 30

    return {
      marker: `SEED_APPT_${phase.toUpperCase()}_${String(index + 1).padStart(3, "0")}`,
      phase,
      daysFromToday: dayOffset,
      hour,
      minute,
      orderStatus,
      appointmentStatus,
    }
  }

  const pastStatuses: AppointmentStatus[] = [
    ...Array.from({ length: 24 }, () => AppointmentStatus.COMPLETED),
    ...Array.from({ length: 6 }, () => AppointmentStatus.CANCELED),
    ...Array.from({ length: 5 }, () => AppointmentStatus.NO_SHOW),
  ]
  const todayStatuses: AppointmentStatus[] = [
    ...Array.from({ length: 2 }, () => AppointmentStatus.COMPLETED),
    ...Array.from({ length: 2 }, () => AppointmentStatus.IN_PROGRESS),
    ...Array.from({ length: 8 }, () => AppointmentStatus.CONFIRMED),
    ...Array.from({ length: 6 }, () => AppointmentStatus.SCHEDULED),
  ]
  const futureStatuses: AppointmentStatus[] = [
    ...Array.from({ length: 17 }, () => AppointmentStatus.SCHEDULED),
    ...Array.from({ length: 8 }, () => AppointmentStatus.CONFIRMED),
    ...Array.from({ length: 2 }, () => AppointmentStatus.CANCELED),
  ]

  const scenarios = [
    ...pastStatuses.map((status, index) => buildScenario(index, "past", status)),
    ...todayStatuses.map((status, index) => buildScenario(index, "today", status)),
    ...futureStatuses.map((status, index) => buildScenario(index, "future", status)),
  ]

  const activeBlockingStatuses: AppointmentStatus[] = [
    AppointmentStatus.SCHEDULED,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.IN_PROGRESS,
    AppointmentStatus.COMPLETED,
  ]

  const slotTemplates = [
    { hour: 9, minute: 0 },
    { hour: 10, minute: 30 },
    { hour: 12, minute: 30 },
    { hour: 14, minute: 0 },
    { hour: 15, minute: 30 },
    { hour: 17, minute: 0 },
  ]

  const expandOffsets = (baseOffset: number, phase: "past" | "today" | "future") => {
    if (phase === "past") {
      return [baseOffset, baseOffset - 1, baseOffset - 2, baseOffset - 3, baseOffset - 5, baseOffset - 7]
    }
    if (phase === "today") {
      return [0, 1, 2, 3, 4, 5, 6]
    }
    return [baseOffset, baseOffset + 1, baseOffset + 2, baseOffset + 3, baseOffset + 5, baseOffset + 7]
  }

  const buildPreferredSlots = (hour: number, minute: number) => {
    const preferred = [{ hour, minute }, ...slotTemplates]
    const deduped: Array<{ hour: number; minute: number }> = []
    for (const slot of preferred) {
      if (!deduped.some((item) => item.hour === slot.hour && item.minute === slot.minute)) {
        deduped.push(slot)
      }
    }
    return deduped.slice(0, 4)
  }

  const pickBookingServices = (scenarioIndex: number) => {
    const roll = (scenarioIndex * 37 + 17) % 100
    const requestedCount = roll < 18 ? 3 : roll < 52 ? 2 : 1
    const serviceCount = Math.min(requestedCount, services.length)
    const picked: (typeof services)[number][] = []
    const usedIds = new Set<string>()
    let step = 0

    while (picked.length < serviceCount && step < services.length * 3) {
      const weightedIndex = (scenarioIndex + step) % weightedServiceIndices.length
      const candidate = services[weightedServiceIndices[weightedIndex] % services.length]
      if (!usedIds.has(candidate.id)) {
        picked.push(candidate)
        usedIds.add(candidate.id)
      }
      step += 1
    }

    if (picked.length === 0) {
      picked.push(services[weightedServiceIndices[scenarioIndex % weightedServiceIndices.length] % services.length])
    }

    return picked
  }

  const findPlacement = async (
    scenario: (typeof scenarios)[number],
    bookingServices: (typeof services),
    scenarioIndex: number
  ) => {
    const candidateOffsets = expandOffsets(scenario.daysFromToday, scenario.phase)
    const preferredSlots = buildPreferredSlots(scenario.hour, scenario.minute)
    const maxAttempts = Math.max(1, candidateOffsets.length * preferredSlots.length)
    let attempts = 0

    for (const dayOffset of candidateOffsets) {
      const dateKey = addDaysToDateKey(todayDateKey, dayOffset)
      for (const slot of preferredSlots) {
        if (attempts >= maxAttempts) return null
        attempts += 1

        const startAt = zonedDateTimeToUtc(dateKey, slot.hour, slot.minute, timeZone)
        const weightedIndex = (scenarioIndex + attempts) % weightedStaffIndices.length
        const staffProfileId =
          staffProfiles[weightedStaffIndices[weightedIndex] % staffProfiles.length].id
        const lines: Array<{
          sortOrder: number
          startAt: Date
          endAt: Date
          service: (typeof services)[number]
        }> = []
        let cursor = startAt
        let isValidPlacement = true

        for (let lineIndex = 0; lineIndex < bookingServices.length; lineIndex += 1) {
          const service = bookingServices[lineIndex]
          const lineStartAt = cursor
          const lineEndAt = new Date(lineStartAt.getTime() + service.durationMinutes * 60000)

          const availability = await checkStaffAppointmentAvailability(
            staffProfileId,
            lineStartAt,
            lineEndAt,
            tenantId
          )
          if (!availability.ok) {
            isValidPlacement = false
            break
          }

          const conflict = await prisma.appointment.findFirst({
            where: {
              tenantId,
              staffProfileId,
              status: { in: activeBlockingStatuses },
              startAt: { lt: lineEndAt },
              endAt: { gt: lineStartAt },
            },
            select: { id: true },
          })
          if (conflict) {
            isValidPlacement = false
            break
          }

          lines.push({
            sortOrder: lineIndex,
            startAt: lineStartAt,
            endAt: lineEndAt,
            service,
          })
          cursor = lineEndAt
        }

        if (!isValidPlacement || lines.length === 0) continue

        return {
          staffProfileId,
          appointmentStartAt: lines[0].startAt,
          appointmentEndAt: lines[lines.length - 1].endAt,
          lines,
        }
      }
    }

    return null
  }

  let created = 0
  for (let index = 0; index < scenarios.length; index += 1) {
    const scenario = scenarios[index]

    const customerId = customers[index % customers.length].id
    const bookingServices = pickBookingServices(index)
    const placement = await findPlacement(scenario, bookingServices, index)
    if (!placement) continue
    const appointmentDate = dateKeyToUtcDate(toDateKeyInTimeZone(placement.appointmentStartAt, timeZone))

    const orderLineCreates = placement.lines.map((line) => {
      const lineSubtotalCents = line.service.priceCents
      const lineTaxEntries = line.service.defaultTaxes
        .map((entry) => entry.tax)
        .map((tax) => ({
          taxId: tax.id,
          name: tax.name,
          percent: tax.percent,
          taxCents: Math.max(0, Math.round((lineSubtotalCents * tax.percent) / 100)),
        }))
      const lineTaxCents = lineTaxEntries.reduce((sum, entry) => sum + entry.taxCents, 0)
      const lineTotalCents = lineSubtotalCents + lineTaxCents

      return {
        serviceId: line.service.id,
        staffProfileId: placement.staffProfileId,
        sortOrder: line.sortOrder,
        quantity: 1,
        durationMinutes: line.service.durationMinutes,
        unitPriceCents: line.service.priceCents,
        discountType: "NONE" as const,
        discountValue: 0,
        taxMode: line.service.taxMode,
        taxIds: lineTaxEntries.map((entry) => entry.taxId),
        lineSubtotalCents,
        lineDiscountCents: 0,
        lineTaxCents,
        lineTotalCents,
        startAt: line.startAt,
        endAt: line.endAt,
        note: "Seeded appointment",
        _taxEntries: lineTaxEntries,
      }
    })

    const subtotalCents = orderLineCreates.reduce((sum, line) => sum + line.lineSubtotalCents, 0)
    const taxCents = orderLineCreates.reduce((sum, line) => sum + line.lineTaxCents, 0)
    const totalCents = orderLineCreates.reduce((sum, line) => sum + line.lineTotalCents, 0)

    const orderTaxMap = new Map<string, { taxId: string; name: string; percent: number; taxCents: number }>()
    for (const line of orderLineCreates) {
      for (const entry of line._taxEntries) {
        const key = entry.taxId
        const existing = orderTaxMap.get(key)
        if (existing) {
          existing.taxCents += entry.taxCents
        } else {
          orderTaxMap.set(key, { ...entry })
        }
      }
    }
    const orderTaxes = Array.from(orderTaxMap.values())

    await prisma.$transaction(async (tx) => {
      const order = await tx.appointmentOrder.create({
        data: {
          tenantId,
          customerId,
          appointmentDate,
          appointmentStartAt: placement.appointmentStartAt,
          status: scenario.orderStatus,
          internalNote: scenario.marker,
          subtotalCents,
          lineDiscountCents: 0,
          couponDiscountCents: 0,
          taxCents,
          totalCents,
          taxes: {
            create: orderTaxes.map((entry) => ({
              taxId: entry.taxId,
              name: entry.name,
              percent: entry.percent,
              taxCents: entry.taxCents,
            })),
          },
          lines: {
            create: orderLineCreates.map((line) => ({
              serviceId: line.serviceId,
              staffProfileId: line.staffProfileId,
              sortOrder: line.sortOrder,
              quantity: line.quantity,
              durationMinutes: line.durationMinutes,
              unitPriceCents: line.unitPriceCents,
              discountType: line.discountType,
              discountValue: line.discountValue,
              taxMode: line.taxMode,
              taxIds: line.taxIds,
              lineSubtotalCents: line.lineSubtotalCents,
              lineDiscountCents: line.lineDiscountCents,
              lineTaxCents: line.lineTaxCents,
              lineTotalCents: line.lineTotalCents,
              startAt: line.startAt,
              endAt: line.endAt,
              note: line.note,
            })),
          },
        },
        include: { lines: true },
      })

      await tx.appointment.createMany({
        data: order.lines.map((line) => ({
          tenantId,
          customerId,
          staffProfileId: line.staffProfileId,
          serviceId: line.serviceId,
          orderLineId: line.id,
          startAt: line.startAt,
          endAt: line.endAt,
          status: scenario.appointmentStatus,
        })),
      })
    })

    created += 1
  }

  return { count: created }
}

const seedShifts = async (tenantId: string, tenantSlug: string) => {
  const templateByName = new Map<string, string>()
  for (const item of shiftTemplateSeeds) {
    const existing = await prisma.shiftTemplate.findFirst({
      where: { tenantId, name: item.name },
      select: { id: true },
    })
    const template = existing
      ? await prisma.shiftTemplate.update({
          where: { id: existing.id },
          data: {
            description: item.description,
            color: item.color,
            isActive: true,
            tenantId,
            startTime: item.startTime,
            endTime: item.endTime,
            breaks: {
              deleteMany: {},
              create: item.breaks,
            },
          },
        })
      : await prisma.shiftTemplate.create({
          data: {
            tenantId,
            name: item.name,
            description: item.description,
            color: item.color,
            isActive: true,
            startTime: item.startTime,
            endTime: item.endTime,
            breaks: { create: item.breaks },
          },
        })
    templateByName.set(item.name, template.id)
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const offsetToMonday = (today.getDay() + 6) % 7
  const currentWeekMonday = new Date(today)
  currentWeekMonday.setDate(today.getDate() - offsetToMonday)
  const startDate = new Date(currentWeekMonday)
  startDate.setDate(currentWeekMonday.getDate() - 7)
  const morningTemplateId = templateByName.get("Morning Shift")
  const eveningTemplateId = templateByName.get("Evening Shift")
  if (!morningTemplateId || !eveningTemplateId) {
    throw new Error("Unable to seed shift templates.")
  }

  const upsertScheduleByName = async (
    name: string,
    options: {
      isDefault: boolean
      weekOffDay1: Weekday
      blocks: Array<{ templateId: string; repeatDays: number; sortOrder: number }>
    }
  ) => {
    const existing = await prisma.shiftSchedule.findFirst({
      where: { tenantId, name, isDefault: options.isDefault },
      select: { id: true },
    })
    if (options.isDefault) {
      await prisma.shiftSchedule.updateMany({ where: { tenantId }, data: { isDefault: false } })
    }
    if (existing) {
      return prisma.shiftSchedule.update({
        where: { id: existing.id },
        data: {
          tenantId,
          isDefault: options.isDefault,
          startDate,
          weekOffDay1: options.weekOffDay1,
          weekOffDay2: null,
          weekOff2Weeks: [],
          blocks: {
            deleteMany: {},
            create: options.blocks,
          },
        },
      })
    }
    return prisma.shiftSchedule.create({
      data: {
        tenantId,
        name,
        isDefault: options.isDefault,
        startDate,
        weekOffDay1: options.weekOffDay1,
        weekOffDay2: null,
        weekOff2Weeks: [],
        blocks: { create: options.blocks },
      },
    })
  }

  await upsertScheduleByName("Seed Default Schedule", {
    isDefault: true,
    weekOffDay1: Weekday.SUNDAY,
    blocks: [
      { templateId: morningTemplateId, repeatDays: 5, sortOrder: 0 },
      { templateId: eveningTemplateId, repeatDays: 2, sortOrder: 1 },
    ],
  })

  const staffProfiles = await prisma.staffProfile.findMany({
    where: {
      user: {
        role: Role.STAFF,
        email: { in: seededStaffEmailsForTenant(tenantSlug) },
      },
    },
    select: {
      id: true,
      user: { select: { email: true } },
    },
    orderBy: { user: { email: "asc" } },
    take: 5,
  })
  let flexibleSlotCount = 0
  let flexibleWeekPlanCount = 0
  let flexiblePatternCount = 0
  if (staffProfiles.length > 0) {
    const preferredFlexibleEmails = new Set(
      seededFlexibleStaffBaseEmails.map((email) => seededEmailForTenant(tenantSlug, email))
    )
    const preferredFlexibleProfiles = staffProfiles.filter((profile) =>
      preferredFlexibleEmails.has(profile.user.email)
    )
    const fallbackFlexibleProfiles = staffProfiles
      .filter((profile) => !preferredFlexibleEmails.has(profile.user.email))
      .slice(-Math.max(0, 2 - preferredFlexibleProfiles.length))
    const flexibleStaffProfiles = [...preferredFlexibleProfiles, ...fallbackFlexibleProfiles].slice(0, 2)
    const flexibleStaffIds = new Set(flexibleStaffProfiles.map((profile) => profile.id))
    const standardStaffProfiles = staffProfiles.filter((profile) => !flexibleStaffIds.has(profile.id))
    const allStaffProfileIds = staffProfiles.map((profile) => profile.id)

    await prisma.staffProfile.updateMany({
      where: { id: { in: allStaffProfileIds } },
      data: { schedulingMode: "STANDARD" },
    })
    await prisma.staffFlexiblePatternBreak.deleteMany({
      where: {
        slot: {
          day: {
            week: {
              pattern: {
                staffProfileId: { in: allStaffProfileIds },
              },
            },
          },
        },
      },
    })
    await prisma.staffFlexiblePatternSlot.deleteMany({
      where: {
        day: {
          week: {
            pattern: {
              staffProfileId: { in: allStaffProfileIds },
            },
          },
        },
      },
    })
    await prisma.staffFlexiblePatternDay.deleteMany({
      where: {
        week: {
          pattern: {
            staffProfileId: { in: allStaffProfileIds },
          },
        },
      },
    })
    await prisma.staffFlexiblePatternWeek.deleteMany({
      where: { pattern: { staffProfileId: { in: allStaffProfileIds } } },
    })
    await prisma.staffFlexiblePattern.deleteMany({
      where: { staffProfileId: { in: allStaffProfileIds } },
    })
    await prisma.staffFlexibleWeekBreak.deleteMany({
      where: {
        slot: {
          day: {
            plan: {
              staffProfileId: { in: allStaffProfileIds },
            },
          },
        },
      },
    })
    await prisma.staffFlexibleWeekSlot.deleteMany({
      where: {
        day: {
          plan: {
            staffProfileId: { in: allStaffProfileIds },
          },
        },
      },
    })
    await prisma.staffFlexibleWeekDay.deleteMany({
      where: { plan: { staffProfileId: { in: allStaffProfileIds } } },
    })
    await prisma.staffFlexibleWeekPlan.deleteMany({
      where: { staffProfileId: { in: allStaffProfileIds } },
    })
    await prisma.staffFlexibleAvailability.deleteMany({
      where: { staffProfileId: { in: allStaffProfileIds } },
    })

    for (const flexibleStaffProfile of flexibleStaffProfiles) {
      await prisma.staffProfile.update({
        where: { id: flexibleStaffProfile.id },
        data: { schedulingMode: "FLEXIBLE" },
      })

      const weeklyPlan = await prisma.staffFlexibleWeekPlan.create({
        data: {
          staffProfileId: flexibleStaffProfile.id,
          weekStartDate: startDate,
        },
      })
      flexibleWeekPlanCount += 1

      const weekdayDefinitions: Array<{
        day: Weekday
        isOff: boolean
        slots: Array<{
          startTime: string
          endTime: string
          breaks?: Array<{ startTime: string; endTime: string }>
        }>
      }> = [
        {
          day: Weekday.MONDAY,
          isOff: false,
          slots: [
            { startTime: "10:00", endTime: "13:00", breaks: [{ startTime: "11:30", endTime: "11:45" }] },
          ],
        },
        {
          day: Weekday.TUESDAY,
          isOff: false,
          slots: [{ startTime: "14:00", endTime: "19:00", breaks: [{ startTime: "16:00", endTime: "16:20" }] }],
        },
        {
          day: Weekday.WEDNESDAY,
          isOff: false,
          slots: [{ startTime: "09:30", endTime: "13:30" }],
        },
        {
          day: Weekday.THURSDAY,
          isOff: false,
          slots: [
            { startTime: "12:00", endTime: "16:00" },
            { startTime: "17:00", endTime: "20:00", breaks: [{ startTime: "18:30", endTime: "18:45" }] },
          ],
        },
        {
          day: Weekday.FRIDAY,
          isOff: false,
          slots: [{ startTime: "11:00", endTime: "15:00" }],
        },
        { day: Weekday.SATURDAY, isOff: true, slots: [] },
        { day: Weekday.SUNDAY, isOff: true, slots: [] },
      ]

      for (let weekdayIndex = 0; weekdayIndex < weekdayDefinitions.length; weekdayIndex += 1) {
        const currentDay = weekdayDefinitions[weekdayIndex]
        const createdDay = await prisma.staffFlexibleWeekDay.create({
          data: {
            planId: weeklyPlan.id,
            day: currentDay.day,
            isOff: currentDay.isOff,
            sortOrder: weekdayIndex,
          },
        })
        for (let slotIndex = 0; slotIndex < currentDay.slots.length; slotIndex += 1) {
          const currentSlot = currentDay.slots[slotIndex]
          const createdSlot = await prisma.staffFlexibleWeekSlot.create({
            data: {
              dayId: createdDay.id,
              startTime: currentSlot.startTime,
              endTime: currentSlot.endTime,
              sortOrder: slotIndex,
            },
          })
          const slotBreaks = currentSlot.breaks ?? []
          if (slotBreaks.length) {
            await prisma.staffFlexibleWeekBreak.createMany({
              data: slotBreaks.map((currentBreak, breakIndex) => ({
                slotId: createdSlot.id,
                startTime: currentBreak.startTime,
                endTime: currentBreak.endTime,
                sortOrder: breakIndex,
              })),
            })
          }
        }
      }

      const recurringPattern = await prisma.staffFlexiblePattern.create({
        data: {
          staffProfileId: flexibleStaffProfile.id,
          name: "Seed Flexible Recurring Plan",
          cycleLengthWeeks: 2,
          validFrom: startDate,
          validTo: null,
          isActive: true,
        },
      })
      flexiblePatternCount += 1

      const recurringWeeks = [
        {
          weekIndex: 1,
          days: [
            { day: Weekday.MONDAY, isOff: false, slots: [{ startTime: "08:00", endTime: "13:00" }] },
            { day: Weekday.TUESDAY, isOff: false, slots: [{ startTime: "08:00", endTime: "13:00" }] },
            { day: Weekday.WEDNESDAY, isOff: true, slots: [] },
            { day: Weekday.THURSDAY, isOff: false, slots: [{ startTime: "08:00", endTime: "13:00" }] },
            { day: Weekday.FRIDAY, isOff: true, slots: [] },
            { day: Weekday.SATURDAY, isOff: true, slots: [] },
            { day: Weekday.SUNDAY, isOff: true, slots: [] },
          ],
        },
        {
          weekIndex: 2,
          days: [
            { day: Weekday.MONDAY, isOff: true, slots: [] },
            { day: Weekday.TUESDAY, isOff: true, slots: [] },
            { day: Weekday.WEDNESDAY, isOff: false, slots: [{ startTime: "14:00", endTime: "19:00" }] },
            { day: Weekday.THURSDAY, isOff: true, slots: [] },
            { day: Weekday.FRIDAY, isOff: false, slots: [{ startTime: "14:00", endTime: "19:00" }] },
            { day: Weekday.SATURDAY, isOff: false, slots: [{ startTime: "14:00", endTime: "19:00" }] },
            { day: Weekday.SUNDAY, isOff: true, slots: [] },
          ],
        },
      ] as const

      for (const patternWeek of recurringWeeks) {
        const createdWeek = await prisma.staffFlexiblePatternWeek.create({
          data: {
            patternId: recurringPattern.id,
            weekIndex: patternWeek.weekIndex,
          },
        })
        for (let dayIndex = 0; dayIndex < patternWeek.days.length; dayIndex += 1) {
          const patternDay = patternWeek.days[dayIndex]
          const createdPatternDay = await prisma.staffFlexiblePatternDay.create({
            data: {
              weekId: createdWeek.id,
              day: patternDay.day,
              isOff: patternDay.isOff,
              sortOrder: dayIndex,
            },
          })
          for (let slotIndex = 0; slotIndex < patternDay.slots.length; slotIndex += 1) {
            const patternSlot = patternDay.slots[slotIndex]
            await prisma.staffFlexiblePatternSlot.create({
              data: {
                dayId: createdPatternDay.id,
                startTime: patternSlot.startTime,
                endTime: patternSlot.endTime,
                sortOrder: slotIndex,
              },
            })
            flexibleSlotCount += 1
          }
        }
      }
    }

    const existing = await prisma.shiftSchedule.findFirst({
      where: { tenantId, name: "Seed Staff Schedule", isDefault: false },
      select: { id: true },
    })
    if (existing) {
      await prisma.shiftSchedule.update({
        where: { id: existing.id },
        data: {
          tenantId,
          startDate,
          weekOffDay1: Weekday.SUNDAY,
          weekOffDay2: Weekday.SATURDAY,
          weekOff2Weeks: [1, 2, 3, 4, 5],
          blocks: {
            deleteMany: {},
            create: [{ templateId: morningTemplateId, repeatDays: 7, sortOrder: 0 }],
          },
          assignments: {
            deleteMany: {},
            create: standardStaffProfiles.map((profile) => ({
              staffProfileId: profile.id,
              startDate,
              endDate: null,
            })),
          },
        },
      })
    } else {
      await prisma.shiftSchedule.create({
        data: {
          tenantId,
          name: "Seed Staff Schedule",
          isDefault: false,
          startDate,
          weekOffDay1: Weekday.SUNDAY,
          weekOffDay2: Weekday.SATURDAY,
          weekOff2Weeks: [1, 2, 3, 4, 5],
          blocks: {
            create: [{ templateId: morningTemplateId, repeatDays: 7, sortOrder: 0 }],
          },
          assignments: {
            create: standardStaffProfiles.map((profile) => ({
              staffProfileId: profile.id,
              startDate,
              endDate: null,
            })),
          },
        },
      })
    }
  }

  return { count: shiftTemplateSeeds.length + 2 + flexibleSlotCount + flexibleWeekPlanCount + flexiblePatternCount }
}

const seedLeaves = async (tenantId: string, tenantSlug: string) => {
  const definitionIdByCode = new Map<string, string>()
  for (const item of leaveDefinitionSeeds) {
    const row = await prisma.leaveDefinition.upsert({
      where: { tenantId_code: { tenantId: tenantId, code: item.code } },
      update: {
        name: item.name,
        leaveType: item.leaveType,
        allowedUsers: item.allowedUsers,
        minDaysPerRequest: item.minDaysPerRequest,
        maxDaysPerRequest: item.maxDaysPerRequest,
        allowWithOtherLeaves: item.allowWithOtherLeaves,
        priorEntryAllowed: item.priorEntryAllowed,
        noticeDays: item.noticeDays,
        allowCarryForward: item.allowCarryForward,
        weekOffSingleSideAllowed: item.weekOffSingleSideAllowed,
        weekOffBothSideAllowed: item.weekOffBothSideAllowed,
        holidaySingleSideAllowed: item.holidaySingleSideAllowed,
        holidayBothSideAllowed: item.holidayBothSideAllowed,
        maxConsecutiveDays: item.maxDaysPerRequest,
        maxPendingRequests: item.maxPendingRequests,
        status: item.status,
        sortOrder: item.sortOrder,
      },
      create: {
        tenantId: tenantId,
        code: item.code,
        name: item.name,
        leaveType: item.leaveType,
        allowedUsers: item.allowedUsers,
        minDaysPerRequest: item.minDaysPerRequest,
        maxDaysPerRequest: item.maxDaysPerRequest,
        allowWithOtherLeaves: item.allowWithOtherLeaves,
        priorEntryAllowed: item.priorEntryAllowed,
        noticeDays: item.noticeDays,
        allowCarryForward: item.allowCarryForward,
        weekOffSingleSideAllowed: item.weekOffSingleSideAllowed,
        weekOffBothSideAllowed: item.weekOffBothSideAllowed,
        holidaySingleSideAllowed: item.holidaySingleSideAllowed,
        holidayBothSideAllowed: item.holidayBothSideAllowed,
        maxConsecutiveDays: item.maxDaysPerRequest,
        maxPendingRequests: item.maxPendingRequests,
        status: item.status,
        sortOrder: item.sortOrder,
      },
    })
    definitionIdByCode.set(item.code, row.id)
  }

  const definitionIds = Array.from(definitionIdByCode.values())
  if (definitionIds.length > 0) {
    await prisma.leaveDefinitionNonClubbable.deleteMany({
      where: { leaveDefinitionId: { in: definitionIds } },
    })
    const nonClubbables = leaveDefinitionSeeds.flatMap((item) =>
      item.blockedCodes
        .map((code) => {
          const leaveDefinitionId = definitionIdByCode.get(item.code)
          const blockedLeaveId = definitionIdByCode.get(code)
          if (!leaveDefinitionId || !blockedLeaveId) return null
          return { leaveDefinitionId, blockedLeaveId }
        })
        .filter(
          (entry): entry is { leaveDefinitionId: string; blockedLeaveId: string } =>
            Boolean(entry)
        )
    )
    if (nonClubbables.length > 0) {
      await prisma.leaveDefinitionNonClubbable.createMany({
        data: nonClubbables,
        skipDuplicates: true,
      })
    }
  }

  const staffProfiles = await prisma.staffProfile.findMany({
    where: {
      user: {
        tenantId: tenantId,
        role: Role.STAFF,
        email: {
          in: seededUsers
            .filter((user) => user.role === Role.STAFF)
            .map((user) => seededEmailForTenant(tenantSlug, user.email)),
        },
      },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  })

  for (const group of leaveGroupSeeds) {
    const leaveDefinitionIds = group.leaveCodes
      .map((code) => definitionIdByCode.get(code))
      .filter((id): id is string => Boolean(id))
    const staffProfileIds =
      group.assignmentMode === LeaveGroupAssignmentMode.SELECTED_STAFF
        ? staffProfiles.slice(0, group.staffCount).map((item) => item.id)
        : []

    await prisma.leaveGroup.upsert({
      where: { tenantId_code: { tenantId: tenantId, code: group.code } },
      update: {
        name: group.name,
        description: group.description,
        assignmentMode: group.assignmentMode,
        status: group.status,
        sortOrder: group.sortOrder,
        leaves: {
          deleteMany: {},
          create: leaveDefinitionIds.map((leaveDefinitionId) => ({
            leaveDefinitionId,
          })),
        },
        staffAssignments: {
          deleteMany: {},
          create: staffProfileIds.map((staffProfileId) => ({
            staffProfileId,
          })),
        },
      },
      create: {
        tenantId: tenantId,
        code: group.code,
        name: group.name,
        description: group.description,
        assignmentMode: group.assignmentMode,
        status: group.status,
        sortOrder: group.sortOrder,
        leaves: {
          create: leaveDefinitionIds.map((leaveDefinitionId) => ({
            leaveDefinitionId,
          })),
        },
        staffAssignments: {
          create: staffProfileIds.map((staffProfileId) => ({
            staffProfileId,
          })),
        },
      },
    })
  }

  return { count: leaveDefinitionSeeds.length + leaveGroupSeeds.length }
}

const clearData = async (tenantId: string) => {
  const adminUsers = await prisma.user.findMany({
    where: { tenantId, role: Role.ADMIN },
    select: { id: true, email: true },
  })
  const nonAdminUsers = await prisma.user.findMany({
    where: { tenantId, role: { not: Role.ADMIN } },
    select: { id: true },
  })
  const nonAdminIds = nonAdminUsers.map((user) => user.id)

  const result = await prisma.$transaction(async (tx) => {
    const counts: Record<string, number> = {}

    counts.appointments = (await tx.appointment.deleteMany({ where: { tenantId } })).count
    counts.appointmentOrders = (await tx.appointmentOrder.deleteMany({ where: { tenantId } })).count
    counts.coupons = (await tx.coupon.deleteMany({ where: { tenantId } })).count

    counts.inventoryStockMovements = (await tx.inventoryStockMovement.deleteMany({ where: { tenantId } })).count
    counts.purchaseOrders = (await tx.purchaseOrder.deleteMany({ where: { tenantId } })).count
    counts.inventoryProductSuppliers = (await tx.inventoryProductSupplier.deleteMany({
      where: { product: { tenantId } },
    })).count
    counts.inventoryProductTaxes = (await tx.inventoryProductTax.deleteMany({
      where: { product: { tenantId } },
    })).count
    counts.inventoryProducts = (await tx.inventoryProduct.deleteMany({ where: { tenantId } })).count
    counts.suppliers = (await tx.supplier.deleteMany({ where: { tenantId } })).count
    counts.inventoryCategories = (await tx.inventoryCategory.deleteMany({ where: { tenantId } })).count

    counts.staffRosterHistoryDays = (await tx.staffRosterHistoryDay.deleteMany({
      where: { staffProfile: { user: { tenantId } } },
    })).count
    counts.staffShiftOverrides = (await tx.staffShiftOverride.deleteMany({
      where: { staffProfile: { user: { tenantId } } },
    })).count
    counts.staffFlexiblePatternBreaks = (await tx.staffFlexiblePatternBreak.deleteMany({
      where: { slot: { day: { week: { pattern: { staffProfile: { user: { tenantId } } } } } } },
    })).count
    counts.staffFlexiblePatternSlots = (await tx.staffFlexiblePatternSlot.deleteMany({
      where: { day: { week: { pattern: { staffProfile: { user: { tenantId } } } } } },
    })).count
    counts.staffFlexiblePatternDays = (await tx.staffFlexiblePatternDay.deleteMany({
      where: { week: { pattern: { staffProfile: { user: { tenantId } } } } },
    })).count
    counts.staffFlexiblePatternWeeks = (await tx.staffFlexiblePatternWeek.deleteMany({
      where: { pattern: { staffProfile: { user: { tenantId } } } },
    })).count
    counts.staffFlexiblePatterns = (await tx.staffFlexiblePattern.deleteMany({
      where: { staffProfile: { user: { tenantId } } },
    })).count
    counts.staffFlexibleWeekBreaks = (await tx.staffFlexibleWeekBreak.deleteMany({
      where: { slot: { day: { plan: { staffProfile: { user: { tenantId } } } } } },
    })).count
    counts.staffFlexibleWeekSlots = (await tx.staffFlexibleWeekSlot.deleteMany({
      where: { day: { plan: { staffProfile: { user: { tenantId } } } } },
    })).count
    counts.staffFlexibleWeekDays = (await tx.staffFlexibleWeekDay.deleteMany({
      where: { plan: { staffProfile: { user: { tenantId } } } },
    })).count
    counts.staffFlexibleWeekPlans = (await tx.staffFlexibleWeekPlan.deleteMany({
      where: { staffProfile: { user: { tenantId } } },
    })).count
    counts.staffFlexibleAvailability = (await tx.staffFlexibleAvailability.deleteMany({
      where: { staffProfile: { user: { tenantId } } },
    })).count
    counts.staffScheduleAssignments = (await tx.staffScheduleAssignment.deleteMany({
      where: { staffProfile: { user: { tenantId } } },
    })).count
    counts.shiftScheduleBlocks = (await tx.shiftScheduleBlock.deleteMany({
      where: { schedule: { tenantId } },
    })).count
    counts.shiftSchedules = (await tx.shiftSchedule.deleteMany({ where: { tenantId } })).count
    counts.shiftTemplateBreaks = (await tx.shiftTemplateBreak.deleteMany({
      where: { template: { tenantId } },
    })).count
    counts.shiftTemplates = (await tx.shiftTemplate.deleteMany({ where: { tenantId } })).count

    counts.staffServiceEligibility = (await tx.staffServiceEligibility.deleteMany({
      where: { user: { tenantId } },
    })).count
    counts.serviceTaxes = (await tx.serviceTax.deleteMany({
      where: { service: { tenantId } },
    })).count
    counts.servicePackageItems = (await tx.servicePackageItem.deleteMany({
      where: { package: { tenantId } },
    })).count
    counts.services = (await tx.service.deleteMany({ where: { tenantId } })).count
    counts.serviceCategories = (await tx.serviceCategory.deleteMany({ where: { tenantId } })).count
    counts.taxes = (await tx.tax.deleteMany({ where: { tenantId } })).count

    counts.staffCertifications = (await tx.staffCertification.deleteMany({
      where: { staffProfile: { user: { tenantId } } },
    })).count
    counts.staffDocuments = (await tx.staffDocument.deleteMany({
      where: { staffProfile: { user: { tenantId } } },
    })).count
    counts.invitations = (await tx.invitation.deleteMany({ where: { tenantId } })).count
    counts.passwordResetTokens = (await tx.passwordResetToken.deleteMany({
      where: { user: { tenantId } },
    })).count
    counts.verificationTokens = 0
    if (nonAdminIds.length > 0) {
      counts.sessions = (await tx.session.deleteMany({ where: { userId: { in: nonAdminIds } } })).count
      counts.accounts = (await tx.account.deleteMany({ where: { userId: { in: nonAdminIds } } })).count
      counts.staffProfiles = (await tx.staffProfile.deleteMany({ where: { userId: { in: nonAdminIds } } })).count
      counts.users = (await tx.user.deleteMany({ where: { id: { in: nonAdminIds } } })).count
    } else {
      counts.sessions = 0
      counts.accounts = 0
      counts.staffProfiles = 0
      counts.users = 0
    }

    return counts
  })

  return {
    deleted: result,
    preservedAdmins: adminUsers.map((user) => user.email),
  }
}

const previewClearData = async (tenantId: string) => {
  const adminUsers = await prisma.user.findMany({
    where: { tenantId, role: Role.ADMIN },
    select: { id: true, email: true },
  })
  const nonAdminIds = (
    await prisma.user.findMany({
      where: { tenantId, role: { not: Role.ADMIN } },
      select: { id: true },
    })
  ).map((user) => user.id)

  const [
    appointments,
    appointmentOrders,
    coupons,
    inventoryStockMovements,
    purchaseOrders,
    inventoryProductSuppliers,
    inventoryProductTaxes,
    inventoryProducts,
    suppliers,
    inventoryCategories,
    staffRosterHistoryDays,
    staffShiftOverrides,
    staffFlexiblePatternBreaks,
    staffFlexiblePatternSlots,
    staffFlexiblePatternDays,
    staffFlexiblePatternWeeks,
    staffFlexiblePatterns,
    staffFlexibleWeekBreaks,
    staffFlexibleWeekSlots,
    staffFlexibleWeekDays,
    staffFlexibleWeekPlans,
    staffFlexibleAvailability,
    staffScheduleAssignments,
    shiftScheduleBlocks,
    shiftSchedules,
    shiftTemplateBreaks,
    shiftTemplates,
    staffServiceEligibility,
    serviceTaxes,
    servicePackageItems,
    services,
    serviceCategories,
    taxes,
    staffCertifications,
    staffDocuments,
    invitations,
    passwordResetTokens,
    verificationTokens,
    sessions,
    accounts,
    staffProfiles,
    users,
  ] = await Promise.all([
    prisma.appointment.count({ where: { tenantId } }),
    prisma.appointmentOrder.count({ where: { tenantId } }),
    prisma.coupon.count({ where: { tenantId } }),
    prisma.inventoryStockMovement.count({ where: { tenantId } }),
    prisma.purchaseOrder.count({ where: { tenantId } }),
    prisma.inventoryProductSupplier.count({ where: { product: { tenantId } } }),
    prisma.inventoryProductTax.count({ where: { product: { tenantId } } }),
    prisma.inventoryProduct.count({ where: { tenantId } }),
    prisma.supplier.count({ where: { tenantId } }),
    prisma.inventoryCategory.count({ where: { tenantId } }),
    prisma.staffRosterHistoryDay.count({ where: { staffProfile: { user: { tenantId } } } }),
    prisma.staffShiftOverride.count({ where: { staffProfile: { user: { tenantId } } } }),
    prisma.staffFlexiblePatternBreak.count({
      where: { slot: { day: { week: { pattern: { staffProfile: { user: { tenantId } } } } } } },
    }),
    prisma.staffFlexiblePatternSlot.count({
      where: { day: { week: { pattern: { staffProfile: { user: { tenantId } } } } } },
    }),
    prisma.staffFlexiblePatternDay.count({
      where: { week: { pattern: { staffProfile: { user: { tenantId } } } } },
    }),
    prisma.staffFlexiblePatternWeek.count({
      where: { pattern: { staffProfile: { user: { tenantId } } } },
    }),
    prisma.staffFlexiblePattern.count({
      where: { staffProfile: { user: { tenantId } } },
    }),
    prisma.staffFlexibleWeekBreak.count({
      where: { slot: { day: { plan: { staffProfile: { user: { tenantId } } } } } },
    }),
    prisma.staffFlexibleWeekSlot.count({
      where: { day: { plan: { staffProfile: { user: { tenantId } } } } },
    }),
    prisma.staffFlexibleWeekDay.count({
      where: { plan: { staffProfile: { user: { tenantId } } } },
    }),
    prisma.staffFlexibleWeekPlan.count({
      where: { staffProfile: { user: { tenantId } } },
    }),
    prisma.staffFlexibleAvailability.count({ where: { staffProfile: { user: { tenantId } } } }),
    prisma.staffScheduleAssignment.count({ where: { staffProfile: { user: { tenantId } } } }),
    prisma.shiftScheduleBlock.count({ where: { schedule: { tenantId } } }),
    prisma.shiftSchedule.count({ where: { tenantId } }),
    prisma.shiftTemplateBreak.count({ where: { template: { tenantId } } }),
    prisma.shiftTemplate.count({ where: { tenantId } }),
    prisma.staffServiceEligibility.count({ where: { user: { tenantId } } }),
    prisma.serviceTax.count({ where: { service: { tenantId } } }),
    prisma.servicePackageItem.count({ where: { package: { tenantId } } }),
    prisma.service.count({ where: { tenantId } }),
    prisma.serviceCategory.count({ where: { tenantId } }),
    prisma.tax.count({ where: { tenantId } }),
    prisma.staffCertification.count({ where: { staffProfile: { user: { tenantId } } } }),
    prisma.staffDocument.count({ where: { staffProfile: { user: { tenantId } } } }),
    prisma.invitation.count({ where: { tenantId } }),
    prisma.passwordResetToken.count({ where: { user: { tenantId } } }),
    Promise.resolve(0),
    nonAdminIds.length
      ? prisma.session.count({ where: { userId: { in: nonAdminIds } } })
      : Promise.resolve(0),
    nonAdminIds.length
      ? prisma.account.count({ where: { userId: { in: nonAdminIds } } })
      : Promise.resolve(0),
    nonAdminIds.length
      ? prisma.staffProfile.count({ where: { userId: { in: nonAdminIds } } })
      : Promise.resolve(0),
    nonAdminIds.length
      ? prisma.user.count({ where: { id: { in: nonAdminIds } } })
      : Promise.resolve(0),
  ])

  return {
    wouldDelete: {
      appointments,
      appointmentOrders,
      coupons,
      inventoryStockMovements,
      purchaseOrders,
      inventoryProductSuppliers,
      inventoryProductTaxes,
      inventoryProducts,
      suppliers,
      inventoryCategories,
      staffRosterHistoryDays,
      staffShiftOverrides,
      staffFlexiblePatternBreaks,
      staffFlexiblePatternSlots,
      staffFlexiblePatternDays,
      staffFlexiblePatternWeeks,
      staffFlexiblePatterns,
      staffFlexibleWeekBreaks,
      staffFlexibleWeekSlots,
      staffFlexibleWeekDays,
      staffFlexibleWeekPlans,
      staffFlexibleAvailability,
      staffScheduleAssignments,
      shiftScheduleBlocks,
      shiftSchedules,
      shiftTemplateBreaks,
      shiftTemplates,
      staffServiceEligibility,
      serviceTaxes,
      servicePackageItems,
      services,
      serviceCategories,
      taxes,
      staffCertifications,
      staffDocuments,
      invitations,
      passwordResetTokens,
      verificationTokens,
      sessions,
      accounts,
      staffProfiles,
      users,
    },
    preservedAdmins: adminUsers.map((user) => user.email),
  }
}

const clearDependencyMap: Record<ClearModule, ClearModule[]> = {
  appointments: [],
  coupons: [],
  purchases: [],
  inventory: ["purchases", "appointments"],
  shifts: [],
  services: ["appointments"],
  taxes: ["services", "inventory"],
  users: ["appointments"],
}

const clearExecutionOrder: ClearModule[] = [
  "appointments",
  "coupons",
  "purchases",
  "inventory",
  "shifts",
  "services",
  "taxes",
  "users",
]

const expandClearModules = (selected: Set<ClearModule>, mode: ClearMode) => {
  const expanded = new Set<ClearModule>(selected)
  const missingByModule: Partial<Record<ClearModule, ClearModule[]>> = {}

  const visit = (moduleKey: ClearModule) => {
    for (const dependency of clearDependencyMap[moduleKey]) {
      if (!selected.has(dependency)) {
        if (!missingByModule[moduleKey]) missingByModule[moduleKey] = []
        missingByModule[moduleKey]!.push(dependency)
      }
      if (!expanded.has(dependency)) {
        expanded.add(dependency)
        visit(dependency)
      }
    }
  }

  for (const moduleKey of selected) {
    visit(moduleKey)
  }

  const hasMissing = Object.keys(missingByModule).length > 0
  if (mode === "strict" && hasMissing) {
    return {
      ok: false as const,
      missingByModule,
      expanded: Array.from(expanded),
    }
  }

  return {
    ok: true as const,
    missingByModule,
    expanded: Array.from(expanded),
  }
}

const countModuleData = async (tenantId: string, modules: Set<ClearModule>) => {
  const nonAdminIds = modules.has("users")
    ? (
        await prisma.user.findMany({
          where: { tenantId, role: { not: Role.ADMIN } },
          select: { id: true },
        })
      ).map((user) => user.id)
    : []

  const counts: Record<string, number> = {}
  if (modules.has("appointments")) {
    counts.appointments = await prisma.appointment.count({ where: { tenantId } })
    counts.appointmentOrders = await prisma.appointmentOrder.count({ where: { tenantId } })
  }
  if (modules.has("coupons")) {
    counts.coupons = await prisma.coupon.count({ where: { tenantId } })
  }
  if (modules.has("purchases")) {
    counts.inventoryStockMovements = await prisma.inventoryStockMovement.count({ where: { tenantId } })
    counts.purchaseOrders = await prisma.purchaseOrder.count({ where: { tenantId } })
  }
  if (modules.has("inventory")) {
    counts.inventoryProductSuppliers = await prisma.inventoryProductSupplier.count({ where: { product: { tenantId } } })
    counts.inventoryProductTaxes = await prisma.inventoryProductTax.count({ where: { product: { tenantId } } })
    counts.inventoryProducts = await prisma.inventoryProduct.count({ where: { tenantId } })
    counts.suppliers = await prisma.supplier.count({ where: { tenantId } })
    counts.inventoryCategories = await prisma.inventoryCategory.count({ where: { tenantId } })
  }
  if (modules.has("shifts")) {
    counts.staffRosterHistoryDays = await prisma.staffRosterHistoryDay.count({ where: { staffProfile: { user: { tenantId } } } })
    counts.staffShiftOverrides = await prisma.staffShiftOverride.count({ where: { staffProfile: { user: { tenantId } } } })
    counts.staffFlexiblePatternBreaks = await prisma.staffFlexiblePatternBreak.count({
      where: { slot: { day: { week: { pattern: { staffProfile: { user: { tenantId } } } } } } },
    })
    counts.staffFlexiblePatternSlots = await prisma.staffFlexiblePatternSlot.count({
      where: { day: { week: { pattern: { staffProfile: { user: { tenantId } } } } } },
    })
    counts.staffFlexiblePatternDays = await prisma.staffFlexiblePatternDay.count({
      where: { week: { pattern: { staffProfile: { user: { tenantId } } } } },
    })
    counts.staffFlexiblePatternWeeks = await prisma.staffFlexiblePatternWeek.count({
      where: { pattern: { staffProfile: { user: { tenantId } } } },
    })
    counts.staffFlexiblePatterns = await prisma.staffFlexiblePattern.count({
      where: { staffProfile: { user: { tenantId } } },
    })
    counts.staffFlexibleWeekBreaks = await prisma.staffFlexibleWeekBreak.count({
      where: { slot: { day: { plan: { staffProfile: { user: { tenantId } } } } } },
    })
    counts.staffFlexibleWeekSlots = await prisma.staffFlexibleWeekSlot.count({
      where: { day: { plan: { staffProfile: { user: { tenantId } } } } },
    })
    counts.staffFlexibleWeekDays = await prisma.staffFlexibleWeekDay.count({
      where: { plan: { staffProfile: { user: { tenantId } } } },
    })
    counts.staffFlexibleWeekPlans = await prisma.staffFlexibleWeekPlan.count({
      where: { staffProfile: { user: { tenantId } } },
    })
    counts.staffFlexibleAvailability = await prisma.staffFlexibleAvailability.count({ where: { staffProfile: { user: { tenantId } } } })
    counts.staffScheduleAssignments = await prisma.staffScheduleAssignment.count({ where: { staffProfile: { user: { tenantId } } } })
    counts.shiftScheduleBlocks = await prisma.shiftScheduleBlock.count({ where: { schedule: { tenantId } } })
    counts.shiftSchedules = await prisma.shiftSchedule.count({ where: { tenantId } })
    counts.shiftTemplateBreaks = await prisma.shiftTemplateBreak.count({ where: { template: { tenantId } } })
    counts.shiftTemplates = await prisma.shiftTemplate.count({ where: { tenantId } })
  }
  if (modules.has("services")) {
    counts.staffServiceEligibility = await prisma.staffServiceEligibility.count({ where: { user: { tenantId } } })
    counts.serviceTaxes = await prisma.serviceTax.count({ where: { service: { tenantId } } })
    counts.servicePackageItems = await prisma.servicePackageItem.count({ where: { package: { tenantId } } })
    counts.services = await prisma.service.count({ where: { tenantId } })
    counts.serviceCategories = await prisma.serviceCategory.count({ where: { tenantId } })
  }
  if (modules.has("taxes")) {
    counts.taxes = await prisma.tax.count({ where: { tenantId } })
  }
  if (modules.has("users")) {
    counts.staffCertifications = await prisma.staffCertification.count({ where: { staffProfile: { user: { tenantId } } } })
    counts.staffDocuments = await prisma.staffDocument.count({ where: { staffProfile: { user: { tenantId } } } })
    counts.invitations = await prisma.invitation.count({ where: { tenantId } })
    counts.passwordResetTokens = await prisma.passwordResetToken.count({ where: { user: { tenantId } } })
    counts.verificationTokens = 0
    counts.sessions = nonAdminIds.length
      ? await prisma.session.count({ where: { userId: { in: nonAdminIds } } })
      : 0
    counts.accounts = nonAdminIds.length
      ? await prisma.account.count({ where: { userId: { in: nonAdminIds } } })
      : 0
    counts.staffProfiles = nonAdminIds.length
      ? await prisma.staffProfile.count({ where: { userId: { in: nonAdminIds } } })
      : 0
    counts.users = nonAdminIds.length
      ? await prisma.user.count({ where: { id: { in: nonAdminIds } } })
      : 0
  }

  const preservedAdmins = (
    await prisma.user.findMany({
      where: { tenantId, role: Role.ADMIN },
      select: { email: true },
    })
  ).map((user) => user.email)

  return { counts, preservedAdmins }
}

const clearModulesData = async (tenantId: string, modules: Set<ClearModule>) => {
  const nonAdminIds = modules.has("users")
    ? (
        await prisma.user.findMany({
          where: { tenantId, role: { not: Role.ADMIN } },
          select: { id: true },
        })
      ).map((user) => user.id)
    : []

  const deleted = await prisma.$transaction(async (tx) => {
    const counts: Record<string, number> = {}

    const has = (moduleKey: ClearModule) => modules.has(moduleKey)
    for (const moduleKey of clearExecutionOrder) {
      if (!has(moduleKey)) continue
      if (moduleKey === "appointments") {
        counts.appointments = (await tx.appointment.deleteMany({ where: { tenantId } })).count
        counts.appointmentOrders = (await tx.appointmentOrder.deleteMany({ where: { tenantId } })).count
      } else if (moduleKey === "coupons") {
        counts.coupons = (await tx.coupon.deleteMany({ where: { tenantId } })).count
      } else if (moduleKey === "purchases") {
        counts.inventoryStockMovements = (await tx.inventoryStockMovement.deleteMany({ where: { tenantId } })).count
        counts.purchaseOrders = (await tx.purchaseOrder.deleteMany({ where: { tenantId } })).count
      } else if (moduleKey === "inventory") {
        counts.inventoryProductSuppliers = (await tx.inventoryProductSupplier.deleteMany({ where: { product: { tenantId } } })).count
        counts.inventoryProductTaxes = (await tx.inventoryProductTax.deleteMany({ where: { product: { tenantId } } })).count
        counts.inventoryProducts = (await tx.inventoryProduct.deleteMany({ where: { tenantId } })).count
        counts.suppliers = (await tx.supplier.deleteMany({ where: { tenantId } })).count
        counts.inventoryCategories = (await tx.inventoryCategory.deleteMany({ where: { tenantId } })).count
      } else if (moduleKey === "shifts") {
        counts.staffRosterHistoryDays = (await tx.staffRosterHistoryDay.deleteMany({ where: { staffProfile: { user: { tenantId } } } })).count
        counts.staffShiftOverrides = (await tx.staffShiftOverride.deleteMany({ where: { staffProfile: { user: { tenantId } } } })).count
        counts.staffFlexiblePatternBreaks = (await tx.staffFlexiblePatternBreak.deleteMany({
          where: { slot: { day: { week: { pattern: { staffProfile: { user: { tenantId } } } } } } },
        })).count
        counts.staffFlexiblePatternSlots = (await tx.staffFlexiblePatternSlot.deleteMany({
          where: { day: { week: { pattern: { staffProfile: { user: { tenantId } } } } } },
        })).count
        counts.staffFlexiblePatternDays = (await tx.staffFlexiblePatternDay.deleteMany({
          where: { week: { pattern: { staffProfile: { user: { tenantId } } } } },
        })).count
        counts.staffFlexiblePatternWeeks = (await tx.staffFlexiblePatternWeek.deleteMany({
          where: { pattern: { staffProfile: { user: { tenantId } } } },
        })).count
        counts.staffFlexiblePatterns = (await tx.staffFlexiblePattern.deleteMany({
          where: { staffProfile: { user: { tenantId } } },
        })).count
        counts.staffFlexibleWeekBreaks = (await tx.staffFlexibleWeekBreak.deleteMany({
          where: { slot: { day: { plan: { staffProfile: { user: { tenantId } } } } } },
        })).count
        counts.staffFlexibleWeekSlots = (await tx.staffFlexibleWeekSlot.deleteMany({
          where: { day: { plan: { staffProfile: { user: { tenantId } } } } },
        })).count
        counts.staffFlexibleWeekDays = (await tx.staffFlexibleWeekDay.deleteMany({
          where: { plan: { staffProfile: { user: { tenantId } } } },
        })).count
        counts.staffFlexibleWeekPlans = (await tx.staffFlexibleWeekPlan.deleteMany({
          where: { staffProfile: { user: { tenantId } } },
        })).count
        counts.staffFlexibleAvailability = (await tx.staffFlexibleAvailability.deleteMany({ where: { staffProfile: { user: { tenantId } } } })).count
        counts.staffScheduleAssignments = (await tx.staffScheduleAssignment.deleteMany({ where: { staffProfile: { user: { tenantId } } } })).count
        counts.shiftScheduleBlocks = (await tx.shiftScheduleBlock.deleteMany({ where: { schedule: { tenantId } } })).count
        counts.shiftSchedules = (await tx.shiftSchedule.deleteMany({ where: { tenantId } })).count
        counts.shiftTemplateBreaks = (await tx.shiftTemplateBreak.deleteMany({ where: { template: { tenantId } } })).count
        counts.shiftTemplates = (await tx.shiftTemplate.deleteMany({ where: { tenantId } })).count
      } else if (moduleKey === "services") {
        counts.staffServiceEligibility = (await tx.staffServiceEligibility.deleteMany({ where: { user: { tenantId } } })).count
        counts.serviceTaxes = (await tx.serviceTax.deleteMany({ where: { service: { tenantId } } })).count
        counts.servicePackageItems = (await tx.servicePackageItem.deleteMany({ where: { package: { tenantId } } })).count
        counts.services = (await tx.service.deleteMany({ where: { tenantId } })).count
        counts.serviceCategories = (await tx.serviceCategory.deleteMany({ where: { tenantId } })).count
      } else if (moduleKey === "taxes") {
        counts.taxes = (await tx.tax.deleteMany({ where: { tenantId } })).count
      } else if (moduleKey === "users") {
        counts.staffCertifications = (await tx.staffCertification.deleteMany({ where: { staffProfile: { user: { tenantId } } } })).count
        counts.staffDocuments = (await tx.staffDocument.deleteMany({ where: { staffProfile: { user: { tenantId } } } })).count
        counts.invitations = (await tx.invitation.deleteMany({ where: { tenantId } })).count
        counts.passwordResetTokens = (await tx.passwordResetToken.deleteMany({ where: { user: { tenantId } } })).count
        counts.verificationTokens = 0
        counts.sessions = nonAdminIds.length
          ? (await tx.session.deleteMany({ where: { userId: { in: nonAdminIds } } })).count
          : 0
        counts.accounts = nonAdminIds.length
          ? (await tx.account.deleteMany({ where: { userId: { in: nonAdminIds } } })).count
          : 0
        counts.staffProfiles = nonAdminIds.length
          ? (await tx.staffProfile.deleteMany({ where: { userId: { in: nonAdminIds } } })).count
          : 0
        counts.users = nonAdminIds.length
          ? (await tx.user.deleteMany({ where: { id: { in: nonAdminIds } } })).count
          : 0
      }
    }

    return counts
  })

  const preservedAdmins = (
    await prisma.user.findMany({
      where: { tenantId, role: Role.ADMIN },
      select: { email: true },
    })
  ).map((user) => user.email)

  return { deleted, preservedAdmins }
}

async function handlePOST(request: Request) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const authorized = await ensureAuthorized(request)
  if (authorized.error) {
    logApiRequestSuccess(logContext, authorized.error.status, { reason: "unauthorized" })
    return withRequestId(authorized.error, logContext.requestId)
  }
  const tenantId = authorized.context.tenantId
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true },
  })
  const tenantSlug = tenant?.slug ?? "tenant"

  try {
    const payload = await request.json().catch(() => null)
    const parsed = requestSchema.safeParse(payload)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
      return withRequestId(response, logContext.requestId)
    }

    if (parsed.data.action === "previewClear") {
      const preview = await previewClearData(tenantId)
      const response = NextResponse.json({
        ok: true,
        action: "previewClear",
        preview,
        message: "Preview generated.",
      })
      logApiRequestSuccess(logContext, 200, { action: "previewClear" })
      return withRequestId(response, logContext.requestId)
    }

    if (parsed.data.action === "previewModulesClear") {
      const mode: ClearMode = parsed.data.mode ?? "include_dependents"
      const selected = new Set<ClearModule>(parsed.data.modules ?? [])
      if (selected.size === 0) {
        const response = NextResponse.json({ error: "Select at least one module." }, { status: 400 })
        logApiRequestSuccess(logContext, 400, { action: "previewModulesClear", reason: "no_modules" })
        return withRequestId(response, logContext.requestId)
      }
      const expansion = expandClearModules(selected, mode)
      if (!expansion.ok) {
        const response = NextResponse.json(
          {
            error: "Missing module dependencies for strict mode.",
            details: expansion.missingByModule,
            expandedModules: expansion.expanded,
          },
          { status: 409 }
        )
        logApiRequestSuccess(logContext, 409, { action: "previewModulesClear", reason: "dependency_conflict" })
        return withRequestId(response, logContext.requestId)
      }

      const expandedSet = new Set<ClearModule>(expansion.expanded)
      const preview = await countModuleData(tenantId, expandedSet)
      const response = NextResponse.json({
        ok: true,
        action: "previewModulesClear",
        selectedModules: Array.from(selected),
        expandedModules: expansion.expanded,
        autoIncludedModules: expansion.expanded.filter((moduleKey) => !selected.has(moduleKey)),
        mode,
        preview: { wouldDelete: preview.counts, preservedAdmins: preview.preservedAdmins },
        message: "Module clear preview generated.",
      })
      logApiRequestSuccess(logContext, 200, { action: "previewModulesClear" })
      return withRequestId(response, logContext.requestId)
    }

    if (parsed.data.action === "clear") {
      const result = await clearData(tenantId)
      const response = NextResponse.json({
        ok: true,
        action: "clear",
        result,
        message: "Data cleared. Admin users and global settings were preserved.",
      })
      logApiRequestSuccess(logContext, 200, { action: "clear" })
      return withRequestId(response, logContext.requestId)
    }

    if (parsed.data.action === "clearModules") {
      const mode: ClearMode = parsed.data.mode ?? "include_dependents"
      const selected = new Set<ClearModule>(parsed.data.modules ?? [])
      if (selected.size === 0) {
        const response = NextResponse.json({ error: "Select at least one module." }, { status: 400 })
        logApiRequestSuccess(logContext, 400, { action: "clearModules", reason: "no_modules" })
        return withRequestId(response, logContext.requestId)
      }
      const expansion = expandClearModules(selected, mode)
      if (!expansion.ok) {
        const response = NextResponse.json(
          {
            error: "Missing module dependencies for strict mode.",
            details: expansion.missingByModule,
            expandedModules: expansion.expanded,
          },
          { status: 409 }
        )
        logApiRequestSuccess(logContext, 409, { action: "clearModules", reason: "dependency_conflict" })
        return withRequestId(response, logContext.requestId)
      }
      const expandedSet = new Set<ClearModule>(expansion.expanded)
      const result = await clearModulesData(tenantId, expandedSet)
      const response = NextResponse.json({
        ok: true,
        action: "clearModules",
        selectedModules: Array.from(selected),
        expandedModules: expansion.expanded,
        autoIncludedModules: expansion.expanded.filter((moduleKey) => !selected.has(moduleKey)),
        mode,
        result,
        message: "Selected modules cleared. Global settings and admin users were preserved.",
      })
      logApiRequestSuccess(logContext, 200, { action: "clearModules" })
      return withRequestId(response, logContext.requestId)
    }

  const dependencyMap: Record<SeedGroup, SeedGroup[]> = {
    taxes: [],
    users: [],
    serviceCatalog: ["taxes", "users"],
    inventoryCatalog: ["taxes"],
    purchases: ["inventoryCatalog"],
    leaves: ["users"],
    shifts: ["users"],
    appointments: ["users", "serviceCatalog", "shifts"],
    coupons: [],
  }

  const requested = new Set<SeedGroup>(
    parsed.data.groups && parsed.data.groups.length > 0 ? parsed.data.groups : seedGroupValues
  )
  const done = new Set<SeedGroup>()
  const summary: Record<string, number> = {}

  const runGroup = async (group: SeedGroup) => {
    if (done.has(group)) return
    for (const dependency of dependencyMap[group]) {
      await runGroup(dependency)
    }
    if (group === "taxes") {
      summary.taxes = (await seedTaxes(tenantId)).count
    } else if (group === "users") {
      summary.users = (await seedUsers(tenantId, tenantSlug)).count
    } else if (group === "serviceCatalog") {
      summary.serviceCatalog = (await seedServiceCatalog(tenantId, tenantSlug)).count
    } else if (group === "inventoryCatalog") {
      summary.inventoryCatalog = (await seedInventoryCatalog(tenantId)).count
    } else if (group === "purchases") {
      summary.purchases = (await seedPurchases(tenantId)).count
    } else if (group === "leaves") {
      summary.leaves = (await seedLeaves(tenantId, tenantSlug)).count
    } else if (group === "shifts") {
      summary.shifts = (await seedShifts(tenantId, tenantSlug)).count
    } else if (group === "appointments") {
      summary.appointments = (await seedAppointments(tenantId, tenantSlug)).count
    } else if (group === "coupons") {
      summary.coupons = (await seedCoupons(tenantId)).count
    }
    done.add(group)
  }

  for (const group of seedGroupValues) {
    if (requested.has(group)) {
      await runGroup(group)
    }
  }

    const response = NextResponse.json({
      ok: true,
      action: "seed",
      summary,
      executedGroups: Array.from(done),
      requestId: randomUUID(),
      message: "Seed data applied successfully.",
    })
    logApiRequestSuccess(logContext, 200, { action: "seed", groups: Array.from(done) })
    return withRequestId(response, logContext.requestId)
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to process seed request." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

// Maintenance must not bypass module switches or a restricted access role.
export async function POST(request: Request) {
  return withBusinessApi(request, async actor => {
    if (!canManageUsers(actor.role as Role) || actor.permissions !== undefined) throw new BusinessError(403, "Seed maintenance requires unrestricted administrator or manager access.")
    const parsed = requestSchema.safeParse(await readJson(request.clone()))
    if (parsed.success) {
      const input = parsed.data
      const clearModules = expandClearModules(new Set(input.modules ?? []), "include_dependents").expanded
      const touchesInventory = input.action === "clear" || input.action === "previewClear" ||
        ((input.action === "clearModules" || input.action === "previewModulesClear") && clearModules.some(key => key === "inventory" || key === "purchases")) ||
        (input.action === "seed" && (!input.groups?.length || input.groups.some(key => key === "inventoryCatalog" || key === "purchases")))
      const touchesServices = input.action === "clear" || input.action === "previewClear" ||
        ((input.action === "clearModules" || input.action === "previewModulesClear") && clearModules.includes("services")) ||
        (input.action === "seed" && (!input.groups?.length || input.groups.some(key => key === "serviceCatalog" || key === "appointments")))
      const touchesAppointments = input.action === "clear" || input.action === "previewClear" ||
        ((input.action === "clearModules" || input.action === "previewModulesClear") && clearModules.some(key => key === "appointments" || key === "coupons")) ||
        (input.action === "seed" && (!input.groups?.length || input.groups.some(key => key === "appointments" || key === "coupons")))
      for (const key of ["leaves", "shifts"] as const) {
        const touched = input.action === "clear" || input.action === "previewClear" ||
          ((input.action === "clearModules" || input.action === "previewModulesClear") && ((clearModules as readonly string[]).includes(key) || clearModules.includes("users"))) ||
          (input.action === "seed" && (!input.groups?.length || (input.groups as readonly string[]).includes(key) || (key === "shifts" && input.groups.includes("appointments"))))
        if (touched) await requireBusinessModule(prisma, actor.tenantId, key)
      }
      if (touchesAppointments) await requireBusinessModule(prisma, actor.tenantId, "appointments")
      if (touchesServices) await requireBusinessModule(prisma, actor.tenantId, "services")
      if (touchesInventory) await requireBusinessModule(prisma, actor.tenantId, "inventory")
    }
    return handlePOST(request)
  })
}
