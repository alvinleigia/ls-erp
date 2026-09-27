import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { updateUserSchema } from "@/lib/validation"
import { canManageUsers, type Role } from "@/lib/permissions"
import { requireTenantSession } from "@/lib/tenant-auth"

const getTodayUtc = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)

const getCurrentWeekStartMondayUtc = (value: Date) => {
  const monday = new Date(value)
  const day = monday.getUTCDay()
  const delta = day === 0 ? -6 : 1 - day
  monday.setUTCDate(monday.getUTCDate() + delta)
  monday.setUTCHours(0, 0, 0, 0)
  return monday
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { id } = await params
  const tenantSession = await requireTenantSession(request)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed", targetUserId: id })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role, sessionUserId } = tenantSession.context

  return runWithTenantDbContext(tenantId, async () => {
    if (
      (!canManageUsers(role as Role) && sessionUserId !== id)
    ) {
      const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      logApiRequestSuccess(logContext, 401, { reason: "unauthorized", targetUserId: id })
      return withRequestId(response, logContext.requestId)
    }

    const body = await request.json().catch(() => null)
    if (!body) {
      const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
      logApiRequestSuccess(logContext, 400, { reason: "invalid_json", targetUserId: id })
      return withRequestId(response, logContext.requestId)
    }
    const parsed = updateUserSchema.safeParse(body)
    if (!parsed.success) {
      const response = NextResponse.json(
        { error: "Invalid input.", details: parsed.error.flatten() },
        { status: 400 }
      )
      logApiRequestSuccess(logContext, 400, { reason: "validation_failed", targetUserId: id })
      return withRequestId(response, logContext.requestId)
    }
    const bodyData = parsed.data

    const existingUser = await prisma.user.findFirst({
      where: { id, tenantId },
      select: { role: true },
    })
    if (!existingUser) {
      const response = NextResponse.json({ error: "User not found." }, { status: 404 })
      logApiRequestSuccess(logContext, 404, { reason: "not_found", targetUserId: id })
      return withRequestId(response, logContext.requestId)
    }

    const targetRole = (bodyData.role ?? existingUser?.role ?? null) as Role | null

    const data: {
      name?: string
      email?: string
      role?: "ADMIN" | "MANAGER" | "STAFF" | "CUSTOMER"
      passwordHash?: string
      phone?: string
      image?: string
      dateOfBirth?: Date
      gender?: "MALE" | "FEMALE" | "NON_BINARY" | "OTHER" | "PREFER_NOT_TO_SAY"
      status?: "ACTIVE" | "SUSPENDED" | "INVITED" | "ARCHIVED"
      marketingOptIn?: boolean
      addressLine1?: string
      addressLine2?: string
      city?: string
      state?: string
      postalCode?: string
      country?: string
    } = {}
    const eligibleServiceIds = bodyData.eligibleServiceIds
    const staffProfileInput = bodyData.staffProfile

    if (role === "ADMIN") {
      if (bodyData.name?.trim()) data.name = bodyData.name.trim()
      if (bodyData.email?.trim()) data.email = bodyData.email.trim().toLowerCase()
      if (bodyData.role) data.role = bodyData.role
      if (bodyData.password?.trim()) {
        data.passwordHash = await bcrypt.hash(bodyData.password.trim(), 10)
      }
      if (bodyData.phone?.trim()) data.phone = bodyData.phone.trim()
      if (bodyData.image?.trim()) data.image = bodyData.image.trim()
      if (bodyData.dateOfBirth) data.dateOfBirth = bodyData.dateOfBirth
      if (bodyData.gender) data.gender = bodyData.gender
      if (bodyData.status) data.status = bodyData.status
      if (bodyData.addressLine1?.trim()) data.addressLine1 = bodyData.addressLine1.trim()
      if (bodyData.addressLine2?.trim()) data.addressLine2 = bodyData.addressLine2.trim()
      if (bodyData.city?.trim()) data.city = bodyData.city.trim()
      if (bodyData.state?.trim()) data.state = bodyData.state.trim()
      if (bodyData.postalCode?.trim()) data.postalCode = bodyData.postalCode.trim()
      if (bodyData.country?.trim()) data.country = bodyData.country.trim()
    } else if (sessionUserId === id) {
      if (bodyData.name?.trim()) data.name = bodyData.name.trim()
      if (bodyData.phone?.trim()) data.phone = bodyData.phone.trim()
      if (bodyData.image?.trim()) data.image = bodyData.image.trim()
      if (bodyData.dateOfBirth) data.dateOfBirth = bodyData.dateOfBirth
      if (bodyData.gender) data.gender = bodyData.gender
      if (bodyData.addressLine1?.trim()) data.addressLine1 = bodyData.addressLine1.trim()
      if (bodyData.addressLine2?.trim()) data.addressLine2 = bodyData.addressLine2.trim()
      if (bodyData.city?.trim()) data.city = bodyData.city.trim()
      if (bodyData.state?.trim()) data.state = bodyData.state.trim()
      if (bodyData.postalCode?.trim()) data.postalCode = bodyData.postalCode.trim()
      if (bodyData.country?.trim()) data.country = bodyData.country.trim()
    } else {
      const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      logApiRequestSuccess(logContext, 401, { reason: "unauthorized_role_path", targetUserId: id })
      return withRequestId(response, logContext.requestId)
    }

    if (targetRole === "STAFF") {
      data.marketingOptIn = false
    } else if (typeof bodyData.marketingOptIn === "boolean") {
      data.marketingOptIn = bodyData.marketingOptIn
    }

    const normalizedEligibleServiceIds =
      targetRole === "STAFF" && eligibleServiceIds
        ? Array.from(new Set(eligibleServiceIds))
        : null

    try {
      const user = await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
        where: { id },
        data,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          createdAt: true,
          image: true,
          dateOfBirth: true,
          gender: true,
          status: true,
          lastLoginAt: true,
          marketingOptIn: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          eligibleServices: { select: { serviceId: true } },
          staffProfile: {
            select: {
              managerUserId: true,
              schedulingMode: true,
              manager: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              documents: {
                select: {
                  id: true,
                  type: true,
                  number: true,
                  imageUrl: true,
                  validFrom: true,
                  validTo: true,
                },
              },
              certifications: {
                select: { id: true, title: true, issuer: true, issuedAt: true, expiresAt: true },
              },
            },
          },
        },
      })

      if (role === "ADMIN") {
        if (normalizedEligibleServiceIds !== null) {
          await tx.staffServiceEligibility.deleteMany({ where: { userId: id } })
          if (normalizedEligibleServiceIds.length) {
            await tx.staffServiceEligibility.createMany({
              data: normalizedEligibleServiceIds.map((serviceId) => ({
                userId: id,
                serviceId,
              })),
            })
          }
        } else if (targetRole && targetRole !== "STAFF" && bodyData.role) {
          await tx.staffServiceEligibility.deleteMany({ where: { userId: id } })
        }

        if (targetRole !== "STAFF" && bodyData.role) {
          await tx.staffProfile.deleteMany({ where: { userId: id } })
        }

        if (targetRole === "STAFF" && staffProfileInput) {
          const managerUserId = staffProfileInput.managerUserId?.trim() || null
          const schedulingMode = staffProfileInput.schedulingMode ?? "STANDARD"
          const todayUtc = getTodayUtc()
          const currentWeekStartUtc = getCurrentWeekStartMondayUtc(todayUtc)
          if (managerUserId) {
            const managerUser = await tx.user.findUnique({
              where: { id: managerUserId },
              select: { id: true, role: true, status: true },
            })
            if (
              !managerUser ||
              managerUser.role !== "MANAGER" ||
              managerUser.status !== "ACTIVE"
            ) {
              throw new Error("Selected manager is invalid or inactive.")
            }
            const managerInTenant = await tx.user.findFirst({
              where: { id: managerUserId, tenantId },
              select: { id: true },
            })
            if (!managerInTenant) {
              throw new Error("Selected manager does not belong to this tenant.")
            }
          }

          const existingProfile = await tx.staffProfile.findUnique({
            where: { userId: id },
            select: { id: true, schedulingMode: true },
          })

          if (existingProfile && existingProfile.schedulingMode !== schedulingMode) {
            if (schedulingMode === "FLEXIBLE") {
              const overlappingAssignment = await tx.staffScheduleAssignment.findFirst({
                where: {
                  staffProfileId: existingProfile.id,
                  OR: [{ endDate: null }, { endDate: { gte: todayUtc } }],
                },
                select: { id: true },
              })
              if (overlappingAssignment) {
                throw new Error(
                  "Cannot switch to Flexible while active/future shift schedule assignments exist. Remove schedule assignments first."
                )
              }
            } else {
              const [activePattern, currentOrFutureWeekPlan, currentOrFutureSlot] = await Promise.all([
                tx.staffFlexiblePattern.findFirst({
                  where: {
                    staffProfileId: existingProfile.id,
                    isActive: true,
                    OR: [{ validTo: null }, { validTo: { gte: todayUtc } }],
                  },
                  select: { id: true },
                }),
                tx.staffFlexibleWeekPlan.findFirst({
                  where: {
                    staffProfileId: existingProfile.id,
                    weekStartDate: { gte: currentWeekStartUtc },
                  },
                  select: { id: true },
                }),
                tx.staffFlexibleAvailability.findFirst({
                  where: {
                    staffProfileId: existingProfile.id,
                    date: { gte: todayUtc },
                  },
                  select: { id: true },
                }),
              ])

              if (activePattern || currentOrFutureWeekPlan || currentOrFutureSlot) {
                throw new Error(
                  "Cannot switch to Standard while active/future flexible availability exists. Clear flexible plans/slots first."
                )
              }
            }
          }

          const profile = await tx.staffProfile.upsert({
            where: { userId: id },
            update: { managerUserId, schedulingMode },
            create: { userId: id, managerUserId, schedulingMode },
          })

          if (staffProfileInput.documents) {
            await tx.staffDocument.deleteMany({
              where: { staffProfileId: profile.id },
            })
            if (staffProfileInput.documents.length) {
              await tx.staffDocument.createMany({
                data: staffProfileInput.documents.map((doc) => ({
                  staffProfileId: profile.id,
                  type: doc.type,
                  number: doc.number || null,
                  imageUrl: doc.imageUrl,
                  validFrom: doc.validFrom
                    ? new Date(doc.validFrom)
                    : null,
                  validTo: doc.validTo
                    ? new Date(doc.validTo)
                    : null,
                })),
              })
            }
          }

          if (staffProfileInput.certifications) {
            await tx.staffCertification.deleteMany({
              where: { staffProfileId: profile.id },
            })
            if (staffProfileInput.certifications.length) {
              await tx.staffCertification.createMany({
                data: staffProfileInput.certifications.map((cert) => ({
                  staffProfileId: profile.id,
                  title: cert.title,
                  issuer: cert.issuer || null,
                  issuedAt: cert.issuedAt
                    ? new Date(cert.issuedAt)
                    : null,
                  expiresAt: cert.expiresAt
                    ? new Date(cert.expiresAt)
                    : null,
                })),
              })
            }
          }
        }
      }

        return updated
      })

      const response = NextResponse.json({
        user: {
          ...user,
          eligibleServiceIds: user.eligibleServices.map((item) => item.serviceId),
        },
      })
      logApiRequestSuccess(logContext, 200, { targetUserId: id })
      return withRequestId(response, logContext.requestId)
    } catch (error) {
      if (error instanceof Error) {
        logApiRequestError(logContext, error, 400, { targetUserId: id })
        const response = NextResponse.json({ error: error.message }, { status: 400 })
        return withRequestId(response, logContext.requestId)
      }
      logApiRequestError(logContext, error, 500, { targetUserId: id })
      const response = NextResponse.json({ error: "Unable to update user." }, { status: 500 })
      return withRequestId(response, logContext.requestId)
    }
  })
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const { id } = await params
  const tenantSession = await requireTenantSession(request)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed", targetUserId: id })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role, sessionUserId } = tenantSession.context

  return runWithTenantDbContext(tenantId, async () => {
    if (
      (!canManageUsers(role as Role) && sessionUserId !== id)
    ) {
      const response = NextResponse.json(
        { error: "Unauthorized. Please sign in and try again." },
        { status: 401 }
      )
      logApiRequestSuccess(logContext, 401, { reason: "unauthorized", targetUserId: id })
      return withRequestId(response, logContext.requestId)
    }

    const ensureStaffProfile = async () => {
      const target = await prisma.user.findUnique({
        where: { id },
        select: { role: true, staffProfile: { select: { id: true } } },
      })
      const targetInTenant = await prisma.user.findFirst({
        where: { id, tenantId },
        select: { id: true },
      })
      if (!targetInTenant) return
      if (!target || target.role !== "STAFF" || target.staffProfile) {
        return
      }
      await prisma.staffProfile.create({ data: { userId: id } })
    }

    await ensureStaffProfile()

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        image: true,
        role: true,
        status: true,
        gender: true,
        dateOfBirth: true,
        marketingOptIn: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        createdAt: true,
        updatedAt: true,
        eligibleServices: { select: { serviceId: true } },
        staffProfile: {
          select: {
            managerUserId: true,
            schedulingMode: true,
            manager: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            documents: {
              select: {
                id: true,
                type: true,
                number: true,
                imageUrl: true,
                validFrom: true,
                validTo: true,
              },
            },
            certifications: {
              select: { id: true, title: true, issuer: true, issuedAt: true, expiresAt: true },
            },
          },
        },
      },
    })

    if (!user) {
      const response = NextResponse.json(
        { error: "User not found. Please refresh and try again." },
        { status: 404 }
      )
      logApiRequestSuccess(logContext, 404, { reason: "not_found", targetUserId: id })
      return withRequestId(response, logContext.requestId)
    }

    const tenantMatch = await prisma.user.findFirst({
      where: { id: user.id, tenantId },
      select: { id: true },
    })
    if (!tenantMatch) {
      const response = NextResponse.json(
        { error: "User not found. Please refresh and try again." },
        { status: 404 }
      )
      logApiRequestSuccess(logContext, 404, { reason: "not_found_in_tenant", targetUserId: id })
      return withRequestId(response, logContext.requestId)
    }

    const response = NextResponse.json({
      user: {
        ...user,
        eligibleServiceIds: user.eligibleServices.map((item) => item.serviceId),
      },
    })
    logApiRequestSuccess(logContext, 200, { targetUserId: id })
    return withRequestId(response, logContext.requestId)
  })
}
