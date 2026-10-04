import { type Page } from "@playwright/test"

const definition = { id: "leave", code: "AL", name: "Annual leave", leaveType: "PAID", allowedUsers: "ALL", minDaysPerRequest: 1, maxDaysPerRequest: 10, maxPendingRequests: 2, noticeDays: 3, priorEntryAllowed: true, allowCarryForward: true, allowWithOtherLeaves: false, weekOffSingleSideAllowed: false, weekOffBothSideAllowed: true, holidaySingleSideAllowed: false, holidayBothSideAllowed: true, status: "ACTIVE", sortOrder: 1, nonClubbableWith: [], updatedAt: "2030-01-01", createdAt: "2030-01-01" }
const staff = { id: "staff", name: "Sam", email: "sam@example.test", staffProfile: { schedulingMode: "STANDARD" } }
const flexStaff = { ...staff, id: "flex", name: "Flex Staff", staffProfile: { schedulingMode: "FLEXIBLE" } }
const group = { id: "group", code: "TEAM", name: "Team leave", description: "Saved group notes", assignmentMode: "SELECTED_STAFF", status: "ACTIVE", sortOrder: 1, leaveDefinitions: [definition], assignedStaff: [{ id: "profile", userId: "staff", name: "Sam", email: staff.email }] }
const request = { id: "request", staffProfileId: "profile", leaveDefinitionId: "leave", staff: { ...staff, userId: "staff" }, leaveDefinition: definition, startDate: "2030-10-07", endDate: "2030-10-08", daysCount: 2, reason: "Family trip", status: "PENDING", createdAt: "2030-10-01", updatedAt: "2030-10-01" }
const template = { id: "template", name: "Day shift", description: "Standard hours", color: "#2563eb", isActive: true, startTime: "09:00", endTime: "17:00", breaks: [{ startTime: "12:00", endTime: "13:00", sortOrder: 0 }], updatedAt: "2030-01-01" }
const schedule = { id: "schedule", name: "Team schedule", isDefault: false, startDate: "2030-10-07", weekOffDay1: "SUNDAY", weekOffDay2: "SATURDAY", weekOff2Weeks: [2, 4], blocks: [{ id: "block", templateId: "template", repeatDays: 5, template }], assignments: [{ id: "assignment", startDate: "2030-10-07", endDate: null, staffProfile: { user: staff } }], updatedAt: "2030-01-01" }
export const pattern = { id: "pattern", staffId: "flex", staffProfileId: "flex-profile", staffName: "Flex Staff", staffEmail: "flex@example.test", name: "Flexible mornings", cycleLengthWeeks: 1, validFrom: "2030-10-07", validTo: null, isActive: true, isCurrentlyEffective: false, updatedAt: "2030-01-01", weeks: [{ weekIndex: 1, days: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"].map(day => ({ day, isOff: day !== "MONDAY", slots: day === "MONDAY" ? [{ startTime: "09:00", endTime: "12:00", breaks: [] }] : [] })) }] }
export async function fixture(page: Page) {
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = [], queries: URL[] = []
  const state = { fail: false, conflict: false }
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname, method = route.request().method()
    if (path === "/api/auth/session") return route.fulfill({ json: { user: { id: "manager", role: new URL(page.url()).searchParams.get("role") || "MANAGER" }, expires: "2099-01-01" } })
    if (method !== "GET") {
      const body = method === "DELETE" ? {} : route.request().postDataJSON(); writes.push({ path, method, body })
      if (state.fail) return route.fulfill({ status: 409, json: { error: "This configuration is in use." } })
      if (state.conflict && path.endsWith("/review")) return route.fulfill({ status: 409, json: { conflicts: [{ requestId: "request", conflictCount: 1, conflictingAppointments: [{ id: "appointment", startAt: "2030-10-07T10:00:00Z", endAt: "2030-10-07T11:00:00Z", serviceName: "Consultation", customerName: "Alex" }] }] } })
      if (path.endsWith("impact-preview")) return route.fulfill({ json: { preview: { window: { startDate: "2030-10-07", endDate: null }, estimatedBookedHoursInWindow: 3, affectedAppointmentsCount: 0, overlappingActivePatternsCount: 0, notes: [] } } })
      return route.fulfill({ json: { ok: true, item: { ...(path.includes("definitions") ? definition : path.includes("groups") ? group : request), ...body } } })
    }
    if (path === "/api/modules") return route.fulfill({ json: { modules: ["leaves","shifts","appointments","services"].map(key => ({ key, allowed: true, enabled: true })), permissions: null } })
    queries.push(url)
    if (path === "/api/leaves/request-options") return route.fulfill({ json: { items: [{ value: "leave", label: "AL - Annual leave" }] } })
    if (path.startsWith("/api/settings")) return route.fulfill({ json: { settings: { timeFormat: "H24", dateFormat: "dd/MM/yyyy", firstDayOfWeek: "MONDAY", workingHours: [] } } })
    if (path === "/api/leaves/definitions/leave") return route.fulfill({ json: { item: definition } })
    if (path === "/api/leaves/groups/group") return route.fulfill({ json: { item: group } })
    if (path === "/api/shifts/flexible-patterns/pattern") return route.fulfill({ json: { item: pattern } })
    if (path === "/api/leaves/requests/request") return route.fulfill({ json: { item: request, timeline: [{ key: "created", title: "Requested leave", at: "2030-10-01T10:00:00Z", byName: "Sam", comment: "Family trip" }], ruleChecks: [{ key: "notice", label: "Notice period", passed: true, detail: "Notice requirement met." }] } })
    const items = ["/api/users", "/api/directory"].includes(path) ? [staff, flexStaff] : path === "/api/leaves/definitions" ? [definition] : path === "/api/leaves/groups" ? [group] : path === "/api/leaves/requests" ? [request] : path === "/api/shifts/templates" ? [template] : path === "/api/shifts/schedules" ? [schedule] : path === "/api/shifts/flexible-patterns/list" ? [pattern] : []
    return route.fulfill({ json: { items, total: items.length ? 21 : 0, page: Number(url.searchParams.get("page") || 1), pageSize: 10, totalPages: items.length ? 3 : 1 } })
  })
  return { writes, queries, state }
}
