"use client"

import { Section } from "@/components/erp/section"
import { ReadOnlyFields } from "@/components/erp/record-detail"
import type { LeaveDefinitionRow, LeaveGroupRow } from "@/types/leaves"

const yesNo = (value: boolean) => value ? "Yes" : "No"

export function LeaveDefinitionSummary({ row }: { row: LeaveDefinitionRow }) {
  return <>
    <Section title="Leave details"><ReadOnlyFields fields={[
      { label: "Code", value: row.code }, { label: "Name", value: row.name },
      { label: "Leave type", value: row.leaveType }, { label: "Allowed users", value: row.allowedUsers },
      { label: "Status", value: row.status }, { label: "Sort order", value: row.sortOrder },
    ]} /></Section>
    <Section title="Request rules"><ReadOnlyFields fields={[
      { label: "Minimum days per request", value: row.minDaysPerRequest }, { label: "Maximum days per request", value: row.maxDaysPerRequest },
      { label: "Maximum pending requests", value: row.maxPendingRequests }, { label: "Notice days", value: row.noticeDays },
      { label: "Prior entry allowed", value: yesNo(row.priorEntryAllowed) }, { label: "Carry forward", value: yesNo(row.allowCarryForward) },
      { label: "Allowed with other leaves", value: yesNo(row.allowWithOtherLeaves) },
      { label: "Cannot be combined with", value: row.nonClubbableWith.map(item => `${item.code} - ${item.name}`).join(", ") || "None" },
    ]} /></Section>
    <Section title="Week off and holiday rules"><ReadOnlyFields fields={[
      { label: "Week off: leave on one side", value: yesNo(row.weekOffSingleSideAllowed) },
      { label: "Week off: leave on both sides", value: yesNo(row.weekOffBothSideAllowed) },
      { label: "Holiday: leave on one side", value: yesNo(row.holidaySingleSideAllowed) },
      { label: "Holiday: leave on both sides", value: yesNo(row.holidayBothSideAllowed) },
    ]} /></Section>
  </>
}

export function LeaveGroupSummary({ row }: { row: LeaveGroupRow }) {
  return <>
    <Section title="Group details"><ReadOnlyFields fields={[
      { label: "Code", value: row.code }, { label: "Name", value: row.name },
      { label: "Description", value: row.description }, { label: "Status", value: row.status }, { label: "Sort order", value: row.sortOrder },
    ]} /></Section>
    <Section title="Leaves and staff"><ReadOnlyFields fields={[
      { label: "Leave definitions", value: row.leaveDefinitions.map(item => `${item.code} - ${item.name}`).join("\n") || "None" },
      { label: "Assignment", value: row.assignmentMode === "ALL_STAFF" ? "Default group for all active staff" : "Selected staff" },
      { label: "Assigned staff", value: row.assignedStaff.map(item => item.name || item.email).join("\n") || "None" },
    ]} /></Section>
  </>
}
