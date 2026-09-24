import { act, render } from "@testing-library/preact"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useClockTick, useFrames } from "./app"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("useClockTick", () => {
  it("re-aligns to second boundaries instead of drifting", () => {
    // Mount 100ms past a second boundary; Date.now() stays an epoch value.
    const t0 = Date.parse("2026-01-15T00:00:00.100Z")
    vi.useFakeTimers()
    vi.setSystemTime(new Date(t0))

    let latest = -1
    const Probe = () => {
      latest = useClockTick(1000)
      return null
    }
    render(<Probe />)
    expect(latest).toBe(t0)

    // Next boundary is 900ms away, not a fixed 1000ms tick from mount.
    act(() => {
      vi.advanceTimersByTime(900)
    })
    expect(latest).toBe(t0 + 900)

    // Then full frames, each re-aligned to the next boundary.
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(latest).toBe(t0 + 1900)
  })

  it("schedules a full frame when mounted exactly on a boundary", () => {
    const t1 = Date.parse("2026-01-15T00:00:01.000Z")
    vi.useFakeTimers()
    vi.setSystemTime(new Date(t1))

    let latest = -1
    const Probe = () => {
      latest = useClockTick(1000)
      return null
    }
    render(<Probe />)
    expect(latest).toBe(t1)

    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(latest).toBe(t1)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(latest).toBe(t1 + 1000)
  })
})

describe("useFrames", () => {
  it("seeds immediately, stamps monotonic frames, and cancels on cleanup", () => {
    let t = 1000
    vi.spyOn(performance, "now").mockImplementation(() => t)
    const cbs: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cbs.push(cb)
      return cbs.length
    })
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {})

    let latest = -1
    const Probe = ({ active }: { active: boolean }) => {
      latest = useFrames(active)
      return null
    }
    const { rerender, unmount } = render(<Probe active />)

    // Seeded on start so the first paint is accurate.
    expect(latest).toBe(1000)

    t = 1016
    act(() => {
      const cb = cbs.shift()
      cb?.(16)
    })
    // performance.now() stamps, never Date.now() epoch values.
    expect(latest).toBe(1016)

    rerender(<Probe active={false} />)
    expect(cancelSpy).toHaveBeenCalled()
    unmount()
  })
})
