import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import type { FlexibleWeekPlanInput } from "@/lib/validation"

// One insert per hierarchy level, not one query per day, slot and break.
// Parents are inserted first so every row still passes the existing tenant RLS.
function planRows(parents: Array<{ id: string; days: FlexibleWeekPlanInput["days"] }>) {
  const days = parents.flatMap(parent => parent.days.map((day, index) => ({
    id: randomUUID(), parentId: parent.id, day: day.day, isOff: day.isOff, sortOrder: day.sortOrder ?? index, source: day,
  })))
  const slots = days.flatMap(day => (day.isOff ? [] : day.source.slots).map((slot, index) => ({
    id: randomUUID(), dayId: day.id, startTime: slot.startTime, endTime: slot.endTime, sortOrder: slot.sortOrder ?? index, source: slot,
  })))
  const breaks = slots.flatMap(slot => slot.source.breaks.map((item, index) => ({
    id: randomUUID(), slotId: slot.id, startTime: item.startTime, endTime: item.endTime, sortOrder: item.sortOrder ?? index,
  })))
  return { days: days.map(({ id, parentId, day, isOff, sortOrder }) => ({ id, parentId, day, isOff, sortOrder })), slots: slots.map(({ id, dayId, startTime, endTime, sortOrder }) => ({ id, dayId, startTime, endTime, sortOrder })), breaks }
}

export async function writeWeekDays(tx: Prisma.TransactionClient, weekPlanId: string, input: FlexibleWeekPlanInput["days"]) {
  const { days, slots, breaks } = planRows([{ id: weekPlanId, days: input }])
  if (days.length) await tx.staffFlexibleWeekDay.createMany({ data: days.map(({ parentId, ...day }) => ({ ...day, planId: parentId })) })
  if (slots.length) await tx.staffFlexibleWeekSlot.createMany({ data: slots })
  if (breaks.length) await tx.staffFlexibleWeekBreak.createMany({ data: breaks })
}

export async function writePatternWeeks(tx: Prisma.TransactionClient, patternId: string, input: Array<{ weekIndex: number; days: FlexibleWeekPlanInput["days"] }>) {
  const weeks = input.map(week => ({ id: randomUUID(), patternId, weekIndex: week.weekIndex }))
  const { days, slots, breaks } = planRows(weeks.map((week, index) => ({ id: week.id, days: input[index].days })))
  if (weeks.length) await tx.staffFlexiblePatternWeek.createMany({ data: weeks })
  if (days.length) await tx.staffFlexiblePatternDay.createMany({ data: days.map(({ parentId, ...day }) => ({ ...day, weekId: parentId })) })
  if (slots.length) await tx.staffFlexiblePatternSlot.createMany({ data: slots })
  if (breaks.length) await tx.staffFlexiblePatternBreak.createMany({ data: breaks })
}
