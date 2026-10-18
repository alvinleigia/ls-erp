import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { leaveDefinitionAllowedUsersSchema, leaveDefinitionStatusSchema, leaveDefinitionTypeSchema, type CreateLeaveDefinitionInput, type UpdateLeaveDefinitionInput } from "@/lib/validation"
import { BusinessError } from "@/platform/policy"
import { Prisma, type PrismaClient } from "@prisma/client"

import type { LeaveDefinitionRow } from "@/types/leaves"

type DbClient = PrismaClient | Prisma.TransactionClient

type LeaveDefinitionWithLinks = {
  id: string
  code: string
  name: string
  leaveType: LeaveDefinitionRow["leaveType"]
  allowedUsers: LeaveDefinitionRow["allowedUsers"]
  minDaysPerRequest: number
  maxDaysPerRequest: number
  allowWithOtherLeaves: boolean
  priorEntryAllowed: boolean
  noticeDays: number
  allowCarryForward: boolean
  weekOffSingleSideAllowed: boolean
  weekOffBothSideAllowed: boolean
  holidaySingleSideAllowed: boolean
  holidayBothSideAllowed: boolean
  maxPendingRequests: number
  status: LeaveDefinitionRow["status"]
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  nonClubbableWithFrom: Array<{
    blockedLeave: {
      id: string
      code: string
      name: string
    }
  }>
}

export const leaveDefinitionSelect = {
  id: true,
  code: true,
  name: true,
  leaveType: true,
  allowedUsers: true,
  minDaysPerRequest: true,
  maxDaysPerRequest: true,
  allowWithOtherLeaves: true,
  priorEntryAllowed: true,
  noticeDays: true,
  allowCarryForward: true,
  weekOffSingleSideAllowed: true,
  weekOffBothSideAllowed: true,
  holidaySingleSideAllowed: true,
  holidayBothSideAllowed: true,
  maxPendingRequests: true,
  status: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  nonClubbableWithFrom: {
    select: {
      blockedLeave: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.LeaveDefinitionSelect

export const serializeLeaveDefinition = (
  item: LeaveDefinitionWithLinks
): LeaveDefinitionRow => ({
  id: item.id,
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
  maxPendingRequests: item.maxPendingRequests,
  status: item.status,
  sortOrder: item.sortOrder,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  nonClubbableWith: item.nonClubbableWithFrom.map((link) => link.blockedLeave),
})

export const replaceNonClubbableRules = async (
  tx: DbClient,
  leaveDefinitionId: string,
  nonClubbableWithIds: string[],
  tenantId: string
) => {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (!await tx.leaveDefinition.count({ where: { id: leaveDefinitionId, tenantId } })) throw new BusinessError(404, "Leave definition not found.")
  const uniqueIds = Array.from(
    new Set(
      nonClubbableWithIds
        .map((id) => id.trim())
        .filter((id) => id && id !== leaveDefinitionId)
    )
  )

  if (uniqueIds.length > 0) {
    const existingCount = await tx.leaveDefinition.count({
      where: { id: { in: uniqueIds }, tenantId },
    })
    if (existingCount !== uniqueIds.length) {
      throw new Error("One or more non-clubbable leave definitions were not found.")
    }
  }

  await tx.leaveDefinitionNonClubbable.deleteMany({
    where: {
      leaveDefinition: { tenantId },
      blockedLeave: { tenantId },
      OR: [{ leaveDefinitionId }, { blockedLeaveId: leaveDefinitionId }],
    },
  })

  if (!uniqueIds.length) return

  const pairs = uniqueIds.flatMap((blockedLeaveId) => [
    { leaveDefinitionId, blockedLeaveId },
    { leaveDefinitionId: blockedLeaveId, blockedLeaveId: leaveDefinitionId },
  ])

  await tx.leaveDefinitionNonClubbable.createMany({
    data: pairs,
    skipDuplicates: true,
  })
}

export const leaveDefinitionListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: leaveDefinitionStatusSchema.optional(),
  leaveType: leaveDefinitionTypeSchema.optional(),
  allowedUsers: leaveDefinitionAllowedUsersSchema.optional(),
  sort: z
    .enum(["code", "name", "leaveType", "allowedUsers", "status", "sortOrder", "createdAt", "updatedAt"])
    .default("sortOrder"),
  order: z.enum(["asc", "desc"]).default("asc"),
})


// Accepts validated input inside the authorized Workforce tenant context.
export async function listLeaveDefinitions(tenantId: string, query: z.infer<typeof leaveDefinitionListSchema>) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const { page, pageSize, q, status, leaveType, allowedUsers, sort, order } = query
  const where: Prisma.LeaveDefinitionWhereInput = {
    tenantId,
    ...(status ? { status } : {}),
    ...(leaveType ? { leaveType } : {}),
    ...(allowedUsers ? { allowedUsers } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  }

  const [total, items] = await prisma.$transaction([
    prisma.leaveDefinition.count({ where }),
    prisma.leaveDefinition.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { [sort]: order },
      select: leaveDefinitionSelect,
    }),
  ])
  return { items, page, pageSize, total }
}

// Accepts validated input inside the authorized Workforce tenant context.
export async function createLeaveDefinition(tenantId: string, data: CreateLeaveDefinitionInput) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const code = data.code.trim().toUpperCase()
  const name = data.name.trim()
  const existing = await prisma.leaveDefinition.findFirst({
    where: { tenantId, OR: [{ code }, { name }] },
    select: { id: true, code: true, name: true },
  })
  if (existing) {
    throw new BusinessError(409, existing.code === code
            ? "Leave code already exists."
            : "Leave name already exists.")
  }

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.leaveDefinition.create({
      data: {
        tenantId,
        code,
        name,
        leaveType: data.leaveType,
        allowedUsers: data.allowedUsers,
        minDaysPerRequest: data.minDaysPerRequest,
        maxDaysPerRequest: data.maxDaysPerRequest,
        allowWithOtherLeaves: data.allowWithOtherLeaves,
        priorEntryAllowed: data.priorEntryAllowed,
        noticeDays: data.noticeDays,
        allowCarryForward: data.allowCarryForward,
        weekOffSingleSideAllowed: data.weekOffSingleSideAllowed,
        weekOffBothSideAllowed: data.weekOffBothSideAllowed,
        holidaySingleSideAllowed: data.holidaySingleSideAllowed,
        holidayBothSideAllowed: data.holidayBothSideAllowed,
        maxConsecutiveDays: data.maxDaysPerRequest,
        maxPendingRequests: data.maxPendingRequests,
        status: data.status,
        sortOrder: data.sortOrder,
      },
    })
    await replaceNonClubbableRules(tx, created.id, data.nonClubbableWithIds, tenantId)
    return tx.leaveDefinition.findFirstOrThrow({
      where: { id: created.id, tenantId },
      select: leaveDefinitionSelect,
    })
  })
  return item
}

// Accepts validated input inside the authorized Workforce tenant context.
export async function getLeaveDefinition(tenantId: string, id: string) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const item = await prisma.leaveDefinition.findFirst({
    where: { id, tenantId },
    select: leaveDefinitionSelect,
  })
  if (!item) {
    throw new BusinessError(404, "Leave definition not found.")
  }
  return item
}

// Accepts validated input inside the authorized Workforce tenant context.
export async function updateLeaveDefinition(tenantId: string, id: string, data: UpdateLeaveDefinitionInput) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const current = await prisma.leaveDefinition.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      code: true,
      name: true,
      minDaysPerRequest: true,
      maxDaysPerRequest: true,
    },
  })
  if (!current) {
    throw new BusinessError(404, "Leave definition not found.")
  }

  const nextMin = data.minDaysPerRequest ?? current.minDaysPerRequest
  const nextMax = data.maxDaysPerRequest ?? current.maxDaysPerRequest
  if (nextMin > nextMax) {
    throw new BusinessError(400, "Minimum days must be less than or equal to maximum days.")
  }

  const code = data.code?.trim().toUpperCase()
  const name = data.name?.trim()
  if (code || name) {
    const duplicate = await prisma.leaveDefinition.findFirst({
      where: {
        tenantId,
        id: { not: id },
        OR: [
          ...(code ? [{ code }] : []),
          ...(name ? [{ name }] : []),
        ],
      },
      select: { id: true, code: true, name: true },
    })
    if (duplicate) {
      throw new BusinessError(409, code && duplicate.code === code
              ? "Leave code already exists."
              : "Leave name already exists.")
    }
  }

  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.leaveDefinition.updateMany({
      where: { id, tenantId },
      data: {
        ...(code ? { code } : {}),
        ...(name ? { name } : {}),
        ...(data.leaveType ? { leaveType: data.leaveType } : {}),
        ...(data.allowedUsers ? { allowedUsers: data.allowedUsers } : {}),
        ...(typeof data.minDaysPerRequest === "number"
          ? { minDaysPerRequest: data.minDaysPerRequest }
          : {}),
        ...(typeof data.maxDaysPerRequest === "number"
          ? { maxDaysPerRequest: data.maxDaysPerRequest }
          : {}),
        ...(typeof data.maxDaysPerRequest === "number"
          ? { maxConsecutiveDays: data.maxDaysPerRequest }
          : {}),
        ...(typeof data.allowWithOtherLeaves === "boolean"
          ? { allowWithOtherLeaves: data.allowWithOtherLeaves }
          : {}),
        ...(typeof data.priorEntryAllowed === "boolean"
          ? { priorEntryAllowed: data.priorEntryAllowed }
          : {}),
        ...(typeof data.noticeDays === "number"
          ? { noticeDays: data.noticeDays }
          : {}),
        ...(typeof data.allowCarryForward === "boolean"
          ? { allowCarryForward: data.allowCarryForward }
          : {}),
        ...(typeof data.weekOffSingleSideAllowed === "boolean"
          ? { weekOffSingleSideAllowed: data.weekOffSingleSideAllowed }
          : {}),
        ...(typeof data.weekOffBothSideAllowed === "boolean"
          ? { weekOffBothSideAllowed: data.weekOffBothSideAllowed }
          : {}),
        ...(typeof data.holidaySingleSideAllowed === "boolean"
          ? { holidaySingleSideAllowed: data.holidaySingleSideAllowed }
          : {}),
        ...(typeof data.holidayBothSideAllowed === "boolean"
          ? { holidayBothSideAllowed: data.holidayBothSideAllowed }
          : {}),
        ...(typeof data.maxPendingRequests === "number"
          ? { maxPendingRequests: data.maxPendingRequests }
          : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(typeof data.sortOrder === "number" ? { sortOrder: data.sortOrder } : {}),
      },
    })
    if (!updated.count) {
      throw new Error("Leave definition not found.")
    }
    if (data.nonClubbableWithIds) {
      await replaceNonClubbableRules(tx, id, data.nonClubbableWithIds, tenantId)
    }
    return tx.leaveDefinition.findFirstOrThrow({
      where: { id, tenantId },
      select: leaveDefinitionSelect,
    })
  })
  return item
}

// Accepts validated input inside the authorized Workforce tenant context.
export async function deleteLeaveDefinition(tenantId: string, id: string) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const exists = await prisma.leaveDefinition.findFirst({
    where: { id, tenantId },
    select: { id: true },
  })
  if (!exists) {
    throw new BusinessError(404, "Leave definition not found.")
  }

  await prisma.leaveDefinition.deleteMany({ where: { id, tenantId } })
}
