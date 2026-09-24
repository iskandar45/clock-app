import { act, fireEvent, render, screen } from "@testing-library/preact"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Stopwatch } from "./app"

afterEach(() => {
  vi.restoreAllMocks()
})

/** Runs the pending rAF callback once with a fake frame timestamp. */
const flushFrame = (cbs: FrameRequestCallback[]) =>
  act(() => {
    const cb = cbs.shift()
    cb?.(16)
  })

describe("Stopwatch", () => {
  it("runs start/lap/pause/resume/reset on a monotonic clock", () => {
    // Monotonic ms since page start — NOT Date.now() epoch values.
    let t = 0
    vi.spyOn(performance, "now").mockImplementation(() => t)
    const cbs: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cbs.push(cb)
      return cbs.length
    })
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {})

    const { container } = render(<Stopwatch />)
    const readout = () => container.querySelector(".stopwatch__readout")?.textContent

    expect(readout()).toBe("00:00.00")

    // Start, then let the clock advance to 1234ms.
    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    t = 1234
    flushFrame(cbs)
    expect(readout()).toBe("00:01.23")

    // Lap records a monotonic split.
    fireEvent.click(screen.getByRole("button", { name: "Lap" }))
    expect(container.querySelector(".lap__split")?.textContent).toBe("+00:01.23")
    expect(container.querySelector(".lap__total")?.textContent).toBe("00:01.23")

    // Pause freezes the readout even as time passes.
    fireEvent.click(screen.getByRole("button", { name: "Pause" }))
    expect(readout()).toBe("00:01.23")
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy()
    t = 9999
    expect(readout()).toBe("00:01.23")

    // Resume continues from the paused base, not from zero and not from the
    // pause gap (the gap between Pause and Resume is not counted).
    fireEvent.click(screen.getByRole("button", { name: "Resume" }))
    t = 11_000
    flushFrame(cbs)
    // 1234ms banked + 1001ms since resume = 2235ms ("00:02.23"); the 8765ms
    // pause gap is excluded because the basis is elapsed-at-pause + delta.
    expect(readout()).toBe("00:02.23")

    // Reset clears elapsed, laps and the start stamp.
    fireEvent.click(screen.getByRole("button", { name: "Reset" }))
    expect(readout()).toBe("00:00.00")
    expect(container.querySelector(".laps")).toBeNull()
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy()

    // Fresh start after reset measures only post-reset time: 25000 - 11000.
    // A Date.now()/performance.now() mismatch would blow this up by ~1.7e12.
    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    t = 25_000
    flushFrame(cbs)
    expect(readout()).toBe("00:14.00")
  })
})
