import { describe, expect, it } from "vitest"
import { readClock } from "./app"

/**
 * The <time datetime> offset is derived from the zone's own wall time, so the
 * interesting cases are sub-hour offsets and southern-hemisphere DST — not just
 * the whole-hour zones covered in app.test.ts. Every stamp must parse back to
 * the exact source instant, and the sweep deliberately issues more zone/option
 * combinations than FORMATTER_CACHE_LIMIT holds to exercise eviction.
 */
const ZONES = [
  "", // device zone
  "UTC",
  // The app's curated list.
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Athens",
  "Europe/Moscow",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
  // Sub-hour offsets and southern-hemisphere DST — the risk cases.
  "Asia/Kathmandu", // +05:45
  "Australia/Eucla", // +08:45
  "Pacific/Chatham", // +12:45 / +13:45
  "America/St_Johns", // -03:30 / -02:30
]

// Second-aligned instants, so the second-precision ISO stamp round-trips exactly.
const INSTANTS = [
  Date.parse("2026-01-15T15:30:45Z"), // northern winter / southern summer
  Date.parse("2026-07-15T15:30:45Z"), // northern summer / southern winter
  Date.parse("2026-03-08T07:00:00Z"), // US spring-forward instant
  Date.parse("2026-10-25T01:00:00Z"), // EU fall-back instant
]

describe("readClock offset round-trip", () => {
  it("parses every zone/instant combination back to the source instant", () => {
    for (const zone of ZONES) {
      for (const instant of INSTANTS) {
        const iso = readClock(instant, zone).iso
        expect(iso, `${zone || "(local)"} @ ${new Date(instant).toISOString()}`).toMatch(
          /T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/,
        )
        expect(new Date(iso).getTime(), `${zone || "(local)"} -> ${iso}`).toBe(instant)
      }
    }
  })

  it("renders the expected sub-hour offsets", () => {
    const t = Date.parse("2026-01-15T15:30:45Z")
    expect(readClock(t, "Asia/Kathmandu").iso).toBe("2026-01-15T21:15:45+05:45")
    expect(readClock(t, "Australia/Eucla").iso).toBe("2026-01-16T00:15:45+08:45")
    expect(readClock(t, "Pacific/Chatham").iso).toBe("2026-01-16T05:15:45+13:45")
    expect(readClock(t, "America/St_Johns").iso).toBe("2026-01-15T12:00:45-03:30")
  })

  it("switches offsets across a DST transition in the same zone", () => {
    const newYork = (isoDate: string) => readClock(Date.parse(isoDate), "America/New_York").iso
    expect(newYork("2026-01-15T15:30:45Z")).toContain("-05:00")
    expect(newYork("2026-07-15T15:30:45Z")).toContain("-04:00")
  })
})
