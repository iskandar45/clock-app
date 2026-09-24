import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import {
  STORAGE_KEY,
  formatOffset,
  formatStopwatch,
  isUsableZone,
  loadSettings,
  pad,
  readClock,
  spokenTime,
} from "./app"

describe("pad", () => {
  it("pads to two digits", () => {
    expect(pad(0)).toBe("00")
    expect(pad(7)).toBe("07")
    expect(pad(59)).toBe("59")
  })
})

describe("formatStopwatch", () => {
  it("formats sub-second values", () => {
    expect(formatStopwatch(0)).toBe("00:00.00")
    expect(formatStopwatch(999)).toBe("00:00.99")
  })

  it("formats seconds and minutes", () => {
    expect(formatStopwatch(1_000)).toBe("00:01.00")
    expect(formatStopwatch(61_234)).toBe("01:01.23")
    expect(formatStopwatch(3_599_999)).toBe("59:59.99")
  })

  it("rolls over into hours", () => {
    expect(formatStopwatch(3_600_000)).toBe("1:00:00.00")
    expect(formatStopwatch(3_600_000 * 2 + 61_234)).toBe("2:01:01.23")
  })
})

describe("formatOffset", () => {
  it("renders Z at zero", () => {
    expect(formatOffset(0)).toBe("Z")
  })

  it("renders positive and negative offsets", () => {
    expect(formatOffset(540)).toBe("+09:00")
    expect(formatOffset(330)).toBe("+05:30")
    expect(formatOffset(-300)).toBe("-05:00")
  })
})

describe("readClock", () => {
  it("returns the zone's wall time with a spec-valid UTC offset", () => {
    // 2026-01-15T15:30:45Z is 2026-01-16T00:30:45+09:00 in Tokyo.
    const reading = readClock(Date.parse("2026-01-15T15:30:45Z"), "Asia/Tokyo")
    expect(reading.iso).toBe("2026-01-16T00:30:45+09:00")
    expect(reading.hour).toBe(0)
    expect(reading.minute).toBe(30)
    expect(reading.second).toBe(45)
    // Offset-less datetime would be invalid for <time datetime>.
    expect(reading.iso).toMatch(/T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/)
  })

  it("handles half-hour zones and UTC", () => {
    const kolkata = readClock(Date.parse("2026-01-15T15:30:45Z"), "Asia/Kolkata")
    expect(kolkata.iso).toBe("2026-01-15T21:00:45+05:30")

    const utc = readClock(Date.parse("2026-01-15T15:30:45Z"), "UTC")
    expect(utc.iso).toBe("2026-01-15T15:30:45Z")
  })

  it("keeps analog and digital hands in agreement", () => {
    const reading = readClock(Date.parse("2026-07-15T15:30:45Z"), "America/New_York")
    expect(reading.hour).toBe(11)
    expect(reading.iso).toBe("2026-07-15T11:30:45-04:00") // DST in effect
  })

  it("uses the device zone when given an empty zone id", () => {
    const reading = readClock(Date.parse("2026-01-15T15:30:45Z"), "")
    expect(reading.iso).toMatch(/T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/)
  })
})

describe("spokenTime", () => {
  const base = readClock(Date.parse("2026-01-15T15:30:45Z"), "UTC")

  it("renders 24-hour time with seconds", () => {
    expect(spokenTime(base, false, true)).toBe("15:30:45")
  })

  it("omits seconds when disabled", () => {
    expect(spokenTime(base, false, false)).toBe("15:30")
  })

  it("renders 12-hour time with a period", () => {
    expect(spokenTime(base, true, true)).toBe("3:30:45 PM")
  })

  it("maps midnight and noon correctly in 12-hour mode", () => {
    const midnight = { ...base, hour: 0 }
    const noon = { ...base, hour: 12 }
    expect(spokenTime(midnight, true, false)).toBe("12:30 AM")
    expect(spokenTime(noon, true, false)).toBe("12:30 PM")
  })
})

describe("storage key", () => {
  it("stays in sync with the pre-paint skin script in index.html", () => {
    // The key is duplicated in two files (module + inline script) because the
    // script must run before the bundle. This test fails loudly if they drift.
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8")
    expect(html).toContain(`"${STORAGE_KEY}"`)
  })
})

describe("isUsableZone", () => {
  it("accepts known IANA ids, UTC and the device-zone sentinel", () => {
    expect(isUsableZone("")).toBe(true)
    expect(isUsableZone("UTC")).toBe(true)
    expect(isUsableZone("Asia/Tokyo")).toBe(true)
  })

  it("rejects garbage and non-strings", () => {
    expect(isUsableZone("Not/AZone")).toBe(false)
    expect(isUsableZone(123)).toBe(false)
    expect(isUsableZone(null)).toBe(false)
    expect(isUsableZone(undefined)).toBe(false)
  })
})

describe("loadSettings", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("falls back to defaults when storage is empty", () => {
    expect(loadSettings()).toEqual({
      zone: "",
      hour12: false,
      showSeconds: true,
      skin: "phosphor",
    })
  })

  it("round-trips valid settings", () => {
    window.localStorage.setItem(
      "chrono.settings.v1",
      JSON.stringify({ zone: "Asia/Tokyo", hour12: true, showSeconds: false, skin: "amber" }),
    )
    expect(loadSettings()).toEqual({
      zone: "Asia/Tokyo",
      hour12: true,
      showSeconds: false,
      skin: "amber",
    })
  })

  it("drops an unusable persisted zone instead of crashing later ticks", () => {
    window.localStorage.setItem(
      "chrono.settings.v1",
      JSON.stringify({ zone: "Mars/Olympus_Mons", skin: "ice" }),
    )
    const settings = loadSettings()
    expect(settings.zone).toBe("")
    expect(settings.skin).toBe("ice")
  })

  it("drops unknown skin values and wrong-typed fields", () => {
    window.localStorage.setItem(
      "chrono.settings.v1",
      JSON.stringify({ hour12: "yes", skin: "neon", showSeconds: null }),
    )
    const settings = loadSettings()
    expect(settings.hour12).toBe(false)
    expect(settings.skin).toBe("phosphor")
    expect(settings.showSeconds).toBe(true)
  })

  it("falls back to defaults on malformed JSON", () => {
    window.localStorage.setItem("chrono.settings.v1", "{not json")
    expect(loadSettings()).toEqual({
      zone: "",
      hour12: false,
      showSeconds: true,
      skin: "phosphor",
    })
  })
})
