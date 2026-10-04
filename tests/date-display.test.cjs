/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test")
const assert = require("node:assert/strict")
const { formatDateOnly, formatInstant } = require("../lib/date-display.ts")
const { wallTimeToInstant } = require("../lib/business-time.ts")
const settings = { timeZone: "Asia/Kolkata", locale: "en-US", dateFormat: "dd/MM/yyyy", timeFormat: "H24" }

test("date-only database values retain their calendar date in a western timezone", () => {
  const previous = process.env.TZ
  process.env.TZ = "America/Los_Angeles"
  try {
    for (const value of ["2030-10-08", "2030-10-08T00:00:00.000Z", new Date("2030-10-08T00:00:00Z")]) {
      assert.equal(formatDateOnly(value, settings.dateFormat), "08/10/2030")
    }
    assert.equal(formatInstant("2030-10-07T20:00:00Z", settings), "08/10/2030 01:30 (Asia/Kolkata)")
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous }
})

test("tenant wall times round trip and reject invalid or ambiguous dates", () => {
  const instant = wallTimeToInstant("2030-10-09T10:00", settings.timeZone)
  assert.equal(instant, "2030-10-09T04:30:00.000Z")
  assert.equal(formatInstant(instant, settings), "09/10/2030 10:00 (Asia/Kolkata)")
  assert.throws(() => wallTimeToInstant("2030-02-30T10:00", settings.timeZone), /valid date/)
  assert.throws(() => wallTimeToInstant("2030-03-10T02:30", "America/New_York"), /does not exist/)
  assert.throws(() => wallTimeToInstant("2030-11-03T01:30", "America/New_York"), /occurs twice/)
})
