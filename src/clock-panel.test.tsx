import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact"
import { afterEach, describe, expect, it, vi } from "vitest"
import { App } from "./app"

const seed = (settings: object) =>
  window.localStorage.setItem("chrono.settings.v1", JSON.stringify(settings))

/** Reads "rotate(Ndeg)" off a hand's inline style. */
const angleOf = (el: Element | null) => {
  const match = /rotate\(([-\d.]+)deg\)/.exec(el?.getAttribute("style") ?? "")
  return match ? Number(match[1]) : Number.NaN
}

const digits = (container: Element) =>
  [...container.querySelectorAll(".digital .digit")].map((el) => Number(el.textContent))

afterEach(() => {
  // Auto-cleanup only registers when globals are on; vitest runs without them.
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe("clock panel", () => {
  it("keeps the analog hands in agreement with the digital readout", () => {
    // Fixed system time removes second-boundary flakiness: the panel and the
    // ticker read the same instant, so hands and digits must agree.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse("2026-01-15T15:30:45Z")))
    seed({ zone: "UTC", hour12: false, showSeconds: true, skin: "phosphor" })

    const { container } = render(<App />)
    const [hour, minute, second] = digits(container)

    expect(hour).toBe(15)
    expect(minute).toBe(30)
    expect(second).toBe(45)

    expect(angleOf(container.querySelector(".analog__hand--second"))).toBeCloseTo(45 * 6)
    expect(angleOf(container.querySelector(".analog__hand--minute"))).toBeCloseTo(
      (30 + 45 / 60) * 6,
    )
    expect(angleOf(container.querySelector(".analog__hand--hour"))).toBeCloseTo(
      (15 % 12) * 30 + (30 / 60) * 30,
    )
  })

  it("hides the second hand when seconds are disabled", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse("2026-01-15T15:30:45Z")))
    seed({ zone: "UTC", hour12: false, showSeconds: false, skin: "phosphor" })

    const { container } = render(<App />)
    expect(container.querySelector(".analog__hand--second")).toBeNull()
    expect(container.querySelector(".analog__hand--minute")).not.toBeNull()
  })

  it("steps the next-zone button from the last zone back to Local", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse("2026-01-15T15:30:45Z")))
    // Pacific/Auckland is last in the curated list.
    seed({ zone: "Pacific/Auckland", hour12: false, showSeconds: true, skin: "phosphor" })

    const { container } = render(<App />)
    const select = container.querySelector("select") as HTMLSelectElement
    expect(select.value).toBe("Pacific/Auckland")

    act(() => {
      fireEvent.click(screen.getByLabelText("Next time zone"))
    })
    expect(select.value).toBe("")
  })

  it("steps the previous-zone button from the first zone back to the last", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse("2026-01-15T15:30:45Z")))
    // "" is Local, the first entry in the stepper list.
    seed({ zone: "", hour12: false, showSeconds: true, skin: "phosphor" })

    const { container } = render(<App />)
    const select = container.querySelector("select") as HTMLSelectElement
    expect(select.value).toBe("")

    act(() => {
      fireEvent.click(screen.getByLabelText("Previous time zone"))
    })
    expect(select.value).toBe("Pacific/Auckland")
  })

  it("steps back from a mid-list zone without wrapping", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.parse("2026-01-15T15:30:45Z")))
    seed({ zone: "UTC", hour12: false, showSeconds: true, skin: "phosphor" })

    const { container } = render(<App />)
    const select = container.querySelector("select") as HTMLSelectElement

    // UTC sits after Sao_Paulo in the curated list; one step back lands there.
    act(() => {
      fireEvent.click(screen.getByLabelText("Previous time zone"))
    })
    expect(select.value).toBe("America/Sao_Paulo")
  })
})
