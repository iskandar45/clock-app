import { describe, expect, it } from "vitest"
import { FORMATTER_CACHE_LIMIT, formatterCache, readClock } from "./app"

/**
 * The <time datetime> offset is derived from the zone's own wall time, so the
 * interesting cases are sub-hour offsets and southern-hemisphere DST — not just
 * the whole-hour zones covered in app.test.ts. Every stamp must parse back to
 * the exact source instant.
 *
 * The sweep is also sized to overflow the formatter cache: 37 zones x 2 cache
 * keys (display + meta) = 74 insertions against a limit of 64, so eviction is
 * exercised for real and asserted below.
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
  // Overflow entries: enough to push 74 keys past the 64-key cache limit.
  "Africa/Accra", // GMT, no DST
  "Africa/Nairobi", // +03:00
  "America/Bogota", // -05:00
  "Asia/Tehran", // +03:30
  "Atlantic/Azores", // -01:00 / +00:00
  "Indian/Maldives", // +05:00
  "Pacific/Guam", // +10:00
]

// Second-aligned instants, so the second-precision ISO stamp round-trips exactly.
const INSTANTS = [
  Date.parse("2026-01-15T15:30:45Z"), // northern winter / southern summer
  Date.parse("2026-07-15T15:30:45Z"), // northern summer / southern winter
  Date.parse("2026-03-08T07:00:00Z"), // US spring-forward instant
  Date.parse("2026-10-25T01:00:00Z"), // EU fall-back instant
]

const label = (zone: string) => zone || "(local)"

describe("readClock offset round-trip", () => {
  it("parses every zone/instant combination back to the source instant", () => {
    for (const zone of ZONES) {
      for (const instant of INSTANTS) {
        const iso = readClock(instant, zone).iso
        expect(iso, `${label(zone)} @ ${new Date(instant).toISOString()}`).toMatch(
          /T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/,
        )
        expect(new Date(iso).getTime(), `${label(zone)} -> ${iso}`).toBe(instant)
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

describe("formatter cache eviction", () => {
  it("keeps the cache at its limit and evicts the oldest zones once exceeded", () => {
    formatterCache.clear()
    expect(formatterCache.size).toBe(0)

    // Two keys per zone (display + meta): 37 zones = 74 insertions vs a 64 limit.
    const totalKeys = ZONES.length * 2
    expect(totalKeys).toBeGreaterThan(FORMATTER_CACHE_LIMIT)

    for (const zone of ZONES) {
      for (const instant of INSTANTS) readClock(instant, zone)
      expect(formatterCache.size, `size while sweeping ${label(zone)}`).toBeLessThanOrEqual(
        FORMATTER_CACHE_LIMIT,
      )
    }

    // The cache filled to its cap and shed 10 keys (the 5 oldest zones).
    expect(formatterCache.size).toBe(FORMATTER_CACHE_LIMIT)
    const evictedZones = ZONES.length - FORMATTER_CACHE_LIMIT / 2
    expect(evictedZones).toBe(5)

    const retained = new Set(formatterCache.keys().map((key) => key.split("|")[0]))
    expect(retained.size).toBe(FORMATTER_CACHE_LIMIT / 2)

    for (const evicted of ZONES.slice(0, evictedZones)) {
      expect(retained.has(evicted), `${label(evicted)} should have been evicted`).toBe(false)
    }
    for (const kept of ZONES.slice(evictedZones)) {
      expect(retained.has(kept), `${label(kept)} should still be cached`).toBe(true)
    }

    // An evicted zone rebuilds its formatter, reads correctly, and the cache
    // stays at the limit rather than growing past it.
    const instant = INSTANTS[0]
    expect(new Date(readClock(instant, ZONES[0]).iso).getTime()).toBe(instant)
    expect(formatterCache.size).toBe(FORMATTER_CACHE_LIMIT)
  })
})
