import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { leaveGroupAssignmentModeSchema, leaveGroupStatusSchema, type CreateLeaveGroupInput, type UpdateLeaveGroupInput } from "@/lib/validation"
import { BusinessError } from "@/platform/policy"
import { Prisma, type PrismaClient } from "@prisma/client"

import type { LeaveGroupRow } from "@/types/leaves"

type DbClient = PrismaClient | Prisma.TransactionClient

type LeaveGroupWithRelations = {
  id: string
  code: string
  name: string
  description: string | null
  assignmentMode: LeaveGroupRow["assignmentMode"]
  status: LeaveGroupRow["status"]
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  leaves: Array<{
    leaveDefinition: {
      id: string
      code: string
      name: string
    }
  }>
  staffAssignments: Array<{
    staffProfile: {
      id: string
      user: {
        id: string
        name: string | null
        email: string
      }
    }
  }>
}

export const leaveGroupSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  assignmentMode: true,
  status: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  leaves: {
    select: {
      leaveDefinition: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
    orderBy: {
      leaveDefinition: {
        sortOrder: "asc",
      },
    },
  },
  staffAssignments: {
    select: {
      staffProfile: {
        select: {
          id: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      },
    },
    orderBy: {
      staffProfile: {
        user: {
          name: "asc",
        },
      },
    },
  },
} satisfies Prisma.LeaveGroupSelect

export const serializeLeaveGroup = (item: LeaveGroupWithRelations): LeaveGroupRow => ({
  id: item.id,
  code: item.code,
  name: item.name,
  description: item.description,
  assignmentMode: item.assignmentMode,
  status: item.status,
  sortOrder: item.sortOrder,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  leaveDefinitions: item.leaves.map((link) => link.leaveDefinition),
  assignedStaff: item.staffAssignments.map((assignment) => ({
    id: assignment.staffProfile.id,
    userId: assignment.staffProfile.user.id,
    name: assignment.staffProfile.user.name,
    email: assignment.staffProfile.user.email,
  })),
})

export const replaceGroupLeaves = async (
  tx: DbClient,
  leaveGroupId: string,
  leaveDefinitionIds: string[],
  tenantId: string
) => {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (!await tx.leaveGroup.count({ where: { id: leaveGroupId, tenantId } })) throw new BusinessError(404, "Leave group not found.")
  const uniqueIds = Array.from(new Set(leaveDefinitionIds.map((id) => id.trim()).filter(Boolean)))
  if (!uniqueIds.length) {
    throw new Error("Select at least one leave definition.")
  }

  const count = await tx.leaveDefinition.count({
    where: { id: { in: uniqueIds }, tenantId },
  })
  if (count !== uniqueIds.length) {
    throw new Error("One or more selected leave definitions were not found.")
  }

  await tx.leaveGroupLeave.deleteMany({ where: { leaveGroupId, leaveGroup: { tenantId } } })
  await tx.leaveGroupLeave.createMany({
    data: uniqueIds.map((leaveDefinitionId) => ({
      leaveGroupId,
      leaveDefinitionId,
    })),
    skipDuplicates: true,
  })
}

export const replaceGroupStaffAssignments = async (
  tx: DbClient,
  leaveGroupId: string,
  assignmentMode: LeaveGroupRow["assignmentMode"],
  staffUserIds: string[],
  tenantId: string
) => {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  if (!await tx.leaveGroup.count({ where: { id: leaveGroupId, tenantId } })) throw new BusinessError(404, "Leave group not found.")
  await tx.leaveGroupStaffAssignment.deleteMany({ where: { leaveGroupId, leaveGroup: { tenantId } } })
  if (assignmentMode === "ALL_STAFF") return

  const uniqueUserIds = Array.from(new Set(staffUserIds.map((id) => id.trim()).filter(Boolean)))
  if (!uniqueUserIds.length) {
    throw new Error("Select at least one employee for selective assignment.")
  }

  const staffProfiles = await tx.staffProfile.findMany({
    where: {
      userId: { in: uniqueUserIds },
      user: { tenantId },
    },
    select: { id: true, userId: true, user: { select: { role: true, status: true } } },
  })
  if (staffProfiles.length !== uniqueUserIds.length) {
    throw new Error("One or more selected employees were not found.")
  }

  const invalid = staffProfiles.find(
    (staff) => staff.user.role !== "STAFF" || staff.user.status !== "ACTIVE"
  )
  if (invalid) {
    throw new Error("Only active staff can be assigned to a leave group.")
  }

  await tx.leaveGroupStaffAssignment.createMany({
    data: staffProfiles.map((staff) => ({
      leaveGroupId,
      staffProfileId: staff.id,
    })),
    skipDuplicates: true,
  })
}

export const leaveGroupListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: leaveGroupStatusSchema.optional(),
  assignmentMode: leaveGroupAssignmentModeSchema.optional(),
  sort: z
    .enum(["code", "name", "assignmentMode", "status", "sortOrder", "updatedAt", "createdAt"])
    .default("sortOrder"),
  order: z.enum(["asc", "desc"]).default("asc"),
})


// Accepts validated input inside the authorized Workforce tenant context.
export async function listLeaveGroups(tenantId: string, query: z.infer<typeof leaveGroupListSchema>) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const { page, pageSize, q, status, assignmentMode, sort, order } = query
  const where: Prisma.LeaveGroupWhereInput = {
    tenantId,
    ...(status ? { status } : {}),
    ...(assignmentMode ? { assignmentMode } : {}),
    ...(q
      ? {
          OR: [
            { code: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  }

  const [total, items] = await prisma.$transaction([
    prisma.leaveGroup.count({ where }),
    prisma.leaveGroup.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { [sort]: order },
      select: leaveGroupSelect,
    }),
  ])
  return { items, page, pageSize, total }
}

// Accepts validated input inside the authorized Workforce tenant context.
export async function createLeaveGroup(tenantId: string, data: CreateLeaveGroupInput) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const code = data.code.trim().toUpperCase()
  const name = data.name.trim()
  const description = data.description?.trim() || null
  const existing = await prisma.leaveGroup.findFirst({
    where: { tenantId, OR: [{ code }, { name }] },
    select: { id: true, code: true },
  })
  if (existing) {
    throw new BusinessError(409, existing.code === code ? "Leave group code already exists." : "Leave group name already exists.")
  }

  const item = await prisma.$transaction(async (tx) => {
    const group = await tx.leaveGroup.create({
      data: {
        tenantId,
        code,
        name,
        description,
        assignmentMode: data.assignmentMode,
        status: data.status,
        sortOrder: data.sortOrder,
      },
    })
    await replaceGroupLeaves(tx, group.id, data.leaveDefinitionIds, tenantId)
    await replaceGroupStaffAssignments(
      tx,
      group.id,
      data.assignmentMode,
      data.staffIds,
      tenantId
    )
    return tx.leaveGroup.findFirstOrThrow({
      where: { id: group.id, tenantId },
      select: leaveGroupSelect,
    })
  })
  return item
}

// Accepts validated input inside the authorized Workforce tenant context.
export async function getLeaveGroup(tenantId: string, id: string) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const item = await prisma.leaveGroup.findFirst({
    where: { id, tenantId },
    select: leaveGroupSelect,
  })
  if (!item) {
    throw new BusinessError(404, "Leave group not found.")
  }
  return item
}

// Accepts validated input inside the authorized Workforce tenant context.
export async function updateLeaveGroup(tenantId: string, id: string, data: UpdateLeaveGroupInput) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const current = await prisma.leaveGroup.findFirst({
    where: { id, tenantId },
    select: { id: true, code: true, name: true, assignmentMode: true },
  })
  if (!current) {
    throw new BusinessError(404, "Leave group not found.")
  }

  const code = data.code?.trim().toUpperCase()
  const name = data.name?.trim()
  if (code || name) {
    const existing = await prisma.leaveGroup.findFirst({
      where: {
        tenantId,
        id: { not: id },
        OR: [...(code ? [{ code }] : []), ...(name ? [{ name }] : [])],
      },
      select: { id: true, code: true },
    })
    if (existing) {
      throw new BusinessError(409, code && existing.code === code ? "Leave group code already exists." : "Leave group name already exists.")
    }
  }

  const item = await prisma.$transaction(async (tx) => {
    const assignmentMode = data.assignmentMode ?? current.assignmentMode
    const updated = await tx.leaveGroup.updateMany({
      where: { id, tenantId },
      data: {
        ...(code ? { code } : {}),
        ...(name ? { name } : {}),
        ...(data.description !== undefined
          ? { description: data.description.trim() || null }
          : {}),
        ...(data.assignmentMode ? { assignmentMode: data.assignmentMode } : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(typeof data.sortOrder === "number" ? { sortOrder: data.sortOrder } : {}),
      },
    })
    if (!updated.count) throw new Error("Leave group not found.")

    if (data.leaveDefinitionIds) {
      await replaceGroupLeaves(tx, id, data.leaveDefinitionIds, tenantId)
    }
    if (data.staffIds || data.assignmentMode) {
      await replaceGroupStaffAssignments(
        tx,
        id,
        assignmentMode,
        data.staffIds ?? [],
        tenantId
      )
    }

    return tx.leaveGroup.findFirstOrThrow({
      where: { id, tenantId },
      select: leaveGroupSelect,
    })
  })
  return item
}

// Accepts validated input inside the authorized Workforce tenant context.
export async function deleteLeaveGroup(tenantId: string, id: string) {
  if (!tenantId) throw new BusinessError(403, "Tenant context is required.")
  const exists = await prisma.leaveGroup.findFirst({ where: { id, tenantId }, select: { id: true } })
  if (!exists) {
    throw new BusinessError(404, "Leave group not found.")
  }

  await prisma.leaveGroup.deleteMany({ where: { id, tenantId } })
}
