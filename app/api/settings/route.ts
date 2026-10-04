import { NextResponse } from "next/server"

import {
  createApiLogContext,
  logApiRequestError,
  logApiRequestStart,
  logApiRequestSuccess,
  withRequestId,
} from "@/lib/api-logging"
import { prisma, runWithTenantDbContext } from "@/lib/prisma"
import { appSettingsSchema } from "@/lib/validation"
import { toISODate } from "@/lib/date"
import { canManageUsers, type Role } from "@/lib/permissions"
import { getEmailDeliveryStatus } from "@/lib/mailer"
import { withCoreApi, actorSession } from "@/platform/core/api"
import type { BusinessActor } from "@/platform/policy"

export const dynamic = "force-dynamic"

const includeWorkingHours = {
  workingDays: {
    orderBy: { day: "asc" as const },
    include: { periods: { orderBy: { sortOrder: "asc" as const } } },
  },
  overrides: {
    orderBy: { date: "asc" as const },
    include: { periods: { orderBy: { sortOrder: "asc" as const } } },
  },
}

const mapSettingsResponse = (settings: {
  workingDays?: {
    id: string
    day: string
    isOpen: boolean
    periods: {
      id: string
      kind: string
      startTime: string
      endTime: string
      sortOrder: number
    }[]
  }[]
  overrides?: {
    id: string
    date: Date
    isOpen: boolean
    periods: {
      id: string
      kind: string
      startTime: string
      endTime: string
      sortOrder: number
    }[]
  }[]
  [key: string]: unknown
}) => {
  const { workingDays, overrides, ...rest } = settings
  return {
    ...rest,
    workingHours:
      workingDays?.map((day) => ({
        id: day.id,
        day: day.day,
        isOpen: day.isOpen,
        periods: day.periods.map((period) => ({
          id: period.id,
          kind: period.kind,
          startTime: period.startTime,
          endTime: period.endTime,
          sortOrder: period.sortOrder,
        })),
      })) ?? [],
    overrides:
      overrides?.map((override) => ({
        id: override.id,
        date: toISODate(override.date),
        isOpen: override.isOpen,
        periods: override.periods.map((period) => ({
          id: period.id,
          kind: period.kind,
          startTime: period.startTime,
          endTime: period.endTime,
          sortOrder: period.sortOrder,
        })),
      })) ?? [],
  }
}

async function handleGET(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = actorSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context

  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    return await runWithTenantDbContext(tenantId, async () => {
      const settings = await prisma.appSetting.findFirst({
        where: { tenantId },
        include: includeWorkingHours,
      })

      if (!settings) return NextResponse.json({ error: "Business settings are not configured. Save Settings to initialize them." }, { status: 503 })
      return NextResponse.json({ settings: mapSettingsResponse(settings), emailDelivery: getEmailDeliveryStatus() })
    })
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to load settings." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

async function handlePATCH(request: Request, actor: BusinessActor) {
  const logContext = createApiLogContext(request)
  logApiRequestStart(logContext, request)

  const tenantSession = actorSession(actor)
  if (tenantSession.error) {
    logApiRequestSuccess(logContext, tenantSession.error.status, { reason: "tenant_or_auth_failed" })
    return withRequestId(tenantSession.error, logContext.requestId)
  }
  const { tenantId, role } = tenantSession.context

  if (!canManageUsers(role as Role)) {
    const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    logApiRequestSuccess(logContext, 401, { reason: "unauthorized" })
    return withRequestId(response, logContext.requestId)
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    const response = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    logApiRequestSuccess(logContext, 400, { reason: "invalid_json" })
    return withRequestId(response, logContext.requestId)
  }

  const parsed = appSettingsSchema.safeParse(body)
  if (!parsed.success) {
    const response = NextResponse.json(
      { error: "Invalid input.", details: parsed.error.flatten() },
      { status: 400 }
    )
    logApiRequestSuccess(logContext, 400, { reason: "validation_failed" })
    return withRequestId(response, logContext.requestId)
  }

  try {
    return await runWithTenantDbContext(tenantId, async () => {
      const { workingHours, overrides, ...baseSettings } = parsed.data

      const existingSettings = await prisma.appSetting.findFirst({
        where: { tenantId },
        select: { id: true },
      })
      const settingId = existingSettings?.id ??
        (
          await prisma.appSetting.create({
            data: { tenantId, ...baseSettings },
            select: { id: true },
          })
        ).id

      if (existingSettings?.id) {
        await prisma.appSetting.update({
          where: { id: existingSettings.id },
          data: baseSettings,
        })
      }

      if (workingHours) {
        await prisma.$transaction(async (tx) => {
          for (const day of workingHours) {
            const dayRecord = await tx.appSettingDay.upsert({
              where: { settingId_day: { settingId, day: day.day } },
              update: { isOpen: day.isOpen },
              create: {
                settingId,
                day: day.day,
                isOpen: day.isOpen,
              },
            })
            await tx.appSettingPeriod.deleteMany({ where: { dayId: dayRecord.id } })
            if (day.periods.length) {
              await tx.appSettingPeriod.createMany({
                data: day.periods.map((period, index) => ({
                  dayId: dayRecord.id,
                  kind: period.kind,
                  startTime: period.startTime,
                  endTime: period.endTime,
                  sortOrder: period.sortOrder ?? index,
                })),
              })
            }
          }
        })
      }

      if (overrides) {
        await prisma.$transaction(async (tx) => {
          const existing = await tx.appSettingOverride.findMany({
            where: { settingId },
            select: { id: true, date: true },
          })
          const nextDates = new Set(
            overrides.map((override) => override.date)
          )
          const toRemove = existing.filter(
            (item) => !nextDates.has(item.date.toISOString().slice(0, 10))
          )
          if (toRemove.length) {
            await tx.appSettingOverridePeriod.deleteMany({
              where: { overrideId: { in: toRemove.map((item) => item.id) } },
            })
            await tx.appSettingOverride.deleteMany({
              where: { id: { in: toRemove.map((item) => item.id) } },
            })
          }

          for (const override of overrides) {
            const overrideDate = new Date(override.date)
            const overrideRecord = await tx.appSettingOverride.upsert({
              where: {
                settingId_date: { settingId, date: overrideDate },
              },
              update: { isOpen: override.isOpen },
              create: {
                settingId,
                date: overrideDate,
                isOpen: override.isOpen,
              },
            })
            await tx.appSettingOverridePeriod.deleteMany({
              where: { overrideId: overrideRecord.id },
            })
            if (override.periods.length) {
              await tx.appSettingOverridePeriod.createMany({
                data: override.periods.map((period, index) => ({
                  overrideId: overrideRecord.id,
                  kind: period.kind,
                  startTime: period.startTime,
                  endTime: period.endTime,
                  sortOrder: period.sortOrder ?? index,
                })),
              })
            }
          }
        })
      }

      const settings = await prisma.appSetting.findFirst({
        where: { tenantId },
        include: includeWorkingHours,
      })

      if (settings) {
        const response = NextResponse.json({
          settings: mapSettingsResponse(settings),
          emailDelivery: getEmailDeliveryStatus(),
        })
        logApiRequestSuccess(logContext, 200, { result: "settings_updated" })
        return withRequestId(response, logContext.requestId)
      }

      const response = NextResponse.json({ settings, emailDelivery: getEmailDeliveryStatus() })
      logApiRequestSuccess(logContext, 200, { result: "settings_updated_empty" })
      return withRequestId(response, logContext.requestId)
    })
  } catch (error) {
    logApiRequestError(logContext, error, 500)
    const response = NextResponse.json({ error: "Unable to update settings." }, { status: 500 })
    return withRequestId(response, logContext.requestId)
  }
}

export async function GET(request: Request) {
  return withCoreApi(request, "businessSettings", "read", actor => handleGET(request, actor))
}

export async function PATCH(request: Request) {
  return withCoreApi(request, "businessSettings", "edit", actor => handlePATCH(request, actor))
}
