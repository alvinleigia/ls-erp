/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { formatWorkHistoryMessage: message, formatWorkHistoryTime: time } = require("../modules/crm/work-history-format.ts")
const settings = { timeZone: "Asia/Kolkata", locale: "en-US", dateFormat: "dd/MM/yyyy", timeFormat: "H12" }
const entry = { event: "crm.work.updated", message: "Activity updated. Rescheduled to 2026-09-28 (2026-09-28T05:30:00.000Z)." }

test("existing UTC reschedule entries display in the business time zone and selected date/time formats", () => {
  assert.equal(message(entry, settings), "Activity updated. Rescheduled to 28/09/2026 11:00 AM (Asia/Kolkata).")
  assert.equal(message(entry, { ...settings, dateFormat: "MM/dd/yyyy", timeFormat: "H24" }), "Activity updated. Rescheduled to 09/28/2026 11:00 (Asia/Kolkata).")
  assert.ok(entry.message.includes("05:30:00.000Z"), "Stored history must remain unchanged")
})

test("instant formatting handles local date rollover and DST independently of the browser zone", () => {
  assert.equal(time("2026-09-27T20:00:00Z", settings), "28/09/2026 01:30 AM (Asia/Kolkata)")
  assert.equal(time("2026-01-15T12:00:00Z", { ...settings, timeZone: "America/New_York" }), "15/01/2026 07:00 AM (America/New_York)")
  assert.equal(time("2026-07-15T12:00:00Z", { ...settings, timeZone: "America/New_York" }), "15/07/2026 08:00 AM (America/New_York)")
})

test("all-day reschedules retain their date and assignment text", () => {
  assert.equal(message({ event: entry.event, message: "Activity updated. Assigned to Alex. Rescheduled to 2026-09-28." }, settings), "Activity updated. Assigned to Alex. Rescheduled to 28/09/2026 (all day).")
})

test("staff-authored notes, other events and malformed timestamps are preserved", () => {
  assert.equal(message({ ...entry, event: "crm.work.note.added" }, settings), entry.message)
  assert.equal(message({ ...entry, message: "Activity updated." }, settings), "Activity updated.")
  const malformed = { ...entry, message: entry.message.replace("05:30:00", "99:30:00") }
  assert.equal(message(malformed, settings), malformed.message)
})
