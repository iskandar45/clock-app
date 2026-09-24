import { useEffect, useMemo, useState } from "preact/hooks"

/* -------------------------------------------------------------------------- */
/*  Settings                                                                   */
/* -------------------------------------------------------------------------- */

type Skin = "phosphor" | "amber" | "ice"

type Settings = {
  /** IANA zone id, or "" to follow the device zone. */
  zone: string
  hour12: boolean
  showSeconds: boolean
  skin: Skin
}

/** Keep in sync with the pre-paint skin script in index.html (guarded by a test). */
export const STORAGE_KEY = "chrono.settings.v1"

const SKINS: { id: Skin; label: string }[] = [
  { id: "phosphor", label: "Phosphor" },
  { id: "amber", label: "Amber" },
  { id: "ice", label: "Ice" },
]

/** A short, human-friendly list of zones. "" means "use the device zone". */
const ZONES: { id: string; label: string }[] = [
  { id: "Pacific/Honolulu", label: "Honolulu" },
  { id: "America/Anchorage", label: "Anchorage" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "America/Denver", label: "Denver" },
  { id: "America/Chicago", label: "Chicago" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Sao_Paulo", label: "São Paulo" },
  { id: "UTC", label: "UTC" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Paris", label: "Paris" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "Europe/Athens", label: "Athens" },
  { id: "Europe/Moscow", label: "Moscow" },
  { id: "Africa/Lagos", label: "Lagos" },
  { id: "Africa/Johannesburg", label: "Johannesburg" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Karachi", label: "Karachi" },
  { id: "Asia/Kolkata", label: "Kolkata" },
  { id: "Asia/Bangkok", label: "Bangkok" },
  { id: "Asia/Shanghai", label: "Shanghai" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Australia/Perth", label: "Perth" },
  { id: "Australia/Sydney", label: "Sydney" },
  { id: "Pacific/Auckland", label: "Auckland" },
]

const LOCAL_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

const DEFAULTS: Settings = {
  zone: "",
  hour12: false,
  showSeconds: true,
  skin: "phosphor",
}

/** Guards stale/garbage localStorage values: a zone id Intl cannot format
 *  would throw inside readClock on every tick. "" (device zone) is always ok. */
export const isUsableZone = (zone: unknown): zone is string => {
  if (typeof zone !== "string") return false
  if (zone === "") return true
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export const loadSettings = (): Settings => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const saved = JSON.parse(raw) as Partial<Settings>
    return {
      zone: isUsableZone(saved.zone) ? saved.zone : DEFAULTS.zone,
      hour12: typeof saved.hour12 === "boolean" ? saved.hour12 : DEFAULTS.hour12,
      showSeconds:
        typeof saved.showSeconds === "boolean" ? saved.showSeconds : DEFAULTS.showSeconds,
      skin: SKINS.some((skin) => skin.id === saved.skin) ? (saved.skin as Skin) : DEFAULTS.skin,
    }
  } catch {
    // Private mode / disabled storage — fall back to defaults.
    return DEFAULTS
  }
}

const useSettings = () => {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Ignore — settings simply won't persist.
    }
  }, [settings])

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((previous) => ({ ...previous, [key]: value }))

  return { settings, update }
}

/* -------------------------------------------------------------------------- */
/*  Tickers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A self-correcting second-aligned ticker: it re-reads the wall clock every
 * `frameMs` and re-schedules for the next boundary, so the display never drifts.
 */
export const useClockTick = (frameMs = 1000) => {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let timer = 0
    const schedule = () => {
      const current = Date.now()
      setNow(current)
      timer = window.setTimeout(schedule, frameMs - (current % frameMs) || frameMs)
    }

    schedule()
    return () => window.clearTimeout(timer)
  }, [frameMs])

  return now
}

/** Re-renders once per animation frame while `active` (smooth stopwatch digits). */
export const useFrames = (active: boolean) => {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!active) return
    // Seed the frame immediately so the first paint after starting is accurate.
    // Must share the clock with Stopwatch.startedAt (performance.now), or the
    // elapsed-time difference explodes to epoch scale.
    setFrame(performance.now())

    let handle = 0
    const loop = () => {
      setFrame(performance.now())
      handle = window.requestAnimationFrame(loop)
    }
    handle = window.requestAnimationFrame(loop)
    return () => window.cancelAnimationFrame(handle)
  }, [active])

  return frame
}

/* -------------------------------------------------------------------------- */
/*  Formatting                                                                 */
/* -------------------------------------------------------------------------- */

export const pad = (value: number) => String(value).padStart(2, "0")

const formatters = new Map<string, Intl.DateTimeFormat>()

/** Two cache keys per zone (display + meta) across ~30 zones is ~60 entries,
 *  so the limit sits just above the working set: a normal zone cycle never
 *  evicts live formatters, and a future unbounded zone picker still can't grow
 *  the cache without limit. FIFO eviction is plenty here. */
export const FORMATTER_CACHE_LIMIT = 64

const formatterFor = (timeZone: string, options: Intl.DateTimeFormatOptions) => {
  const key = `${timeZone}|${JSON.stringify(options)}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", timeZone ? { ...options, timeZone } : options)
    formatters.set(key, formatter)
    if (formatters.size > FORMATTER_CACHE_LIMIT) {
      const oldest = formatters.keys().next().value
      if (oldest !== undefined) formatters.delete(oldest)
    }
  }
  return formatter
}

/** Test-only view of the formatter cache so eviction can be asserted. */
export const formatterCache = {
  get size() {
    return formatters.size
  },
  keys: () => [...formatters.keys()],
  clear: () => formatters.clear(),
}

const partOf = (parts: Intl.DateTimeFormatPart[], type: string) =>
  parts.find((part) => part.type === type)?.value ?? ""

/** `+HH:MM` for the offset in minutes; `Z` at zero. */
export const formatOffset = (minutes: number): string => {
  if (minutes === 0) return "Z"
  const abs = Math.abs(minutes)
  return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

type Reading = {
  hour: number
  minute: number
  second: number
  weekday: string
  day: string
  month: string
  year: string
  /** Machine-readable wall-clock stamp for <time datetime>, with UTC offset. */
  iso: string
  /** Zone abbreviation, e.g. "GMT+2" or "JST". */
  abbreviation: string
}

export const readClock = (now: number, timeZone: string): Reading => {
  const date = new Date(now)

  const display = formatterFor(timeZone, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date)

  const meta = formatterFor(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZoneName: "short",
  }).formatToParts(date)

  const hour = Number(partOf(display, "hour")) % 24
  const minute = Number(partOf(display, "minute"))
  const second = Number(partOf(display, "second"))

  // Zone-local wall time re-read as if it were UTC, minus the true epoch, gives
  // the zone's UTC offset at this instant (DST-correct, no longOffset needed).
  const wallAsUtc = Date.UTC(
    Number(partOf(meta, "year")),
    Number(partOf(meta, "month")) - 1,
    Number(partOf(meta, "day")),
    hour,
    minute,
    second,
  )
  const offset = formatOffset(Math.round((wallAsUtc - date.getTime()) / 60_000))

  return {
    hour,
    minute,
    second,
    weekday: partOf(display, "weekday"),
    day: partOf(display, "day"),
    month: partOf(display, "month"),
    year: partOf(display, "year"),
    iso: `${partOf(meta, "year")}-${partOf(meta, "month")}-${partOf(meta, "day")}T${pad(
      hour,
    )}:${pad(minute)}:${pad(second)}${offset}`,
    abbreviation: partOf(meta, "timeZoneName"),
  }
}

/** 14:17:03 style text, or 2:17:03 PM when 12-hour mode is on. */
export const spokenTime = (reading: Reading, hour12: boolean, showSeconds: boolean) => {
  const hour = hour12 ? reading.hour % 12 || 12 : reading.hour
  const body = showSeconds
    ? `${hour}:${pad(reading.minute)}:${pad(reading.second)}`
    : `${hour}:${pad(reading.minute)}`
  return hour12 ? `${body} ${reading.hour < 12 ? "AM" : "PM"}` : body
}

export const formatStopwatch = (ms: number) => {
  const hundredths = Math.floor(ms / 10)
  const seconds = Math.floor(hundredths / 100)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  const stamp = `${pad(minutes % 60)}:${pad(seconds % 60)}.${pad(hundredths % 100)}`
  return hours > 0 ? `${hours}:${stamp}` : stamp
}

/* -------------------------------------------------------------------------- */
/*  Analog face                                                                */
/* -------------------------------------------------------------------------- */

const AnalogFace = ({
  reading,
  showSeconds,
}: {
  reading: Reading
  showSeconds: boolean
}) => {
  const secondAngle = reading.second * 6
  const minuteAngle = (reading.minute + reading.second / 60) * 6
  const hourAngle = ((reading.hour % 12) + reading.minute / 60) * 30

  return (
    <div class="analog" aria-hidden="true">
      <div class="analog__ticks">
        {Array.from({ length: 60 }, (_, index) => (
          <span
            key={index}
            class={index % 5 === 0 ? "analog__tick analog__tick--major" : "analog__tick"}
            style={{ transform: `rotate(${index * 6}deg)` }}
          />
        ))}
      </div>
      <span class="analog__hand analog__hand--hour" style={{ transform: `rotate(${hourAngle}deg)` }} />
      <span
        class="analog__hand analog__hand--minute"
        style={{ transform: `rotate(${minuteAngle}deg)` }}
      />
      {showSeconds && (
        <span
          class="analog__hand analog__hand--second"
          style={{ transform: `rotate(${secondAngle}deg)` }}
        />
      )}
      <span class="analog__cap" />
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Stopwatch                                                                  */
/* -------------------------------------------------------------------------- */

export const Stopwatch = () => {
  const [running, setRunning] = useState(false)
  const [base, setBase] = useState(0)
  // Monotonic timestamp of the current run's start; 0 when not running.
  const [startedAt, setStartedAt] = useState(0)
  const [laps, setLaps] = useState<number[]>([])
  const [announcement, setAnnouncement] = useState("Stopwatch ready")

  const frame = useFrames(running)
  const elapsed = running ? Math.max(0, base + (frame - startedAt)) : base

  const toggle = () => {
    if (running) {
      setBase(elapsed)
      setRunning(false)
      setAnnouncement(`Paused at ${formatStopwatch(elapsed)}`)
    } else {
      setStartedAt(performance.now())
      setRunning(true)
      setAnnouncement("Stopwatch running")
    }
  }

  const recordLap = () => {
    setLaps((previous) => [...previous, elapsed])
    setAnnouncement(`Lap ${laps.length + 1} at ${formatStopwatch(elapsed)}`)
  }

  const reset = () => {
    setRunning(false)
    setBase(0)
    setStartedAt(0)
    setLaps([])
    setAnnouncement("Stopwatch reset")
  }

  return (
    <section class="panel stopwatch" aria-labelledby="stopwatch-title">
      <header class="panel__head">
        <h2 class="panel__title" id="stopwatch-title">
          Stopwatch
        </h2>
        <span class="panel__hint">{laps.length > 0 ? `${laps.length} laps` : "Lap splits"}</span>
      </header>

      <p class="stopwatch__readout" role="timer" aria-live="off">
        {formatStopwatch(elapsed)}
      </p>

      <div class="stopwatch__actions">
        <button type="button" class="btn btn--primary" onClick={toggle}>
          {running ? "Pause" : elapsed > 0 ? "Resume" : "Start"}
        </button>
        <button type="button" class="btn" onClick={recordLap} disabled={!running}>
          Lap
        </button>
        <button type="button" class="btn btn--ghost" onClick={reset} disabled={elapsed === 0 && laps.length === 0}>
          Reset
        </button>
      </div>

      {laps.length > 0 && (
        <ol class="laps">
          {laps
            .map((total, index) => ({ total, index, split: total - (laps[index - 1] ?? 0) }))
            .reverse()
            .map((lap) => (
              <li class="lap" key={lap.index}>
                <span class="lap__index">#{pad(lap.index + 1)}</span>
                <span class="lap__split">+{formatStopwatch(lap.split)}</span>
                <span class="lap__total">{formatStopwatch(lap.total)}</span>
              </li>
            ))}
        </ol>
      )}

      <span class="sr-only" role="status">
        {announcement}
      </span>
    </section>
  )
}

/* -------------------------------------------------------------------------- */
/*  App                                                                        */
/* -------------------------------------------------------------------------- */

export const App = () => {
  const { settings, update } = useSettings()
  const now = useClockTick(1000)
  const reading = useMemo(() => readClock(now, settings.zone), [now, settings.zone])

  useEffect(() => {
    document.documentElement.dataset.skin = settings.skin
  }, [settings.skin])

  const zones = useMemo(() => [{ id: "", label: `Local (${LOCAL_ZONE})` }, ...ZONES], [])

  const stepZone = (delta: number) => {
    const current = zones.findIndex((zone) => zone.id === settings.zone)
    const next = (current + delta + zones.length) % zones.length
    update("zone", zones[next].id)
  }

  const activeZone = zones.find((zone) => zone.id === settings.zone) ?? zones[0]
  const displayHour = settings.hour12 ? reading.hour % 12 || 12 : reading.hour
  const blinkColon = !settings.showSeconds && reading.second % 2 === 1

  return (
    <div class="app">
      <header class="app__bar">
        <div class="brand">
          <span class="brand__led" aria-hidden="true" />
          <span class="brand__name">Chrono</span>
          <span class="brand__zone">
            {activeZone.label} · {reading.abbreviation}
          </span>
        </div>

        <div class="skins" role="group" aria-label="Display colour">
          {SKINS.map((skin) => (
            <button
              key={skin.id}
              type="button"
              class={`skin skin--${skin.id}`}
              aria-pressed={settings.skin === skin.id}
              title={skin.label}
              onClick={() => update("skin", skin.id)}
            >
              <span class="sr-only">{skin.label}</span>
            </button>
          ))}
        </div>
      </header>

      <main class="panel clock">
        <AnalogFace reading={reading} showSeconds={settings.showSeconds} />

        <div class="clock__digital">
          <time
            class="digital"
            dateTime={reading.iso}
            aria-label={`${spokenTime(reading, settings.hour12, settings.showSeconds)}, ${reading.weekday} ${reading.day} ${reading.month} ${reading.year}`}
          >
            <span class="digit">{settings.hour12 ? displayHour : pad(displayHour)}</span>
            <span class={blinkColon ? "colon colon--off" : "colon"}>:</span>
            <span class="digit">{pad(reading.minute)}</span>
            {settings.showSeconds && (
              <>
                <span class="colon">:</span>
                <span class="digit digit--small">{pad(reading.second)}</span>
              </>
            )}
            {settings.hour12 && <span class="period">{reading.hour < 12 ? "AM" : "PM"}</span>}
          </time>

          <p class="clock__date">
            {reading.weekday}, {reading.day} {reading.month} {reading.year}
          </p>
        </div>

        <div class="clock__controls">
          <div class="zone">
            <button
              type="button"
              class="icon-btn"
              aria-label="Previous time zone"
              title="Previous time zone"
              onClick={() => stepZone(-1)}
            >
              ‹
            </button>
            <div class="zone__field">
              <select
                class="zone__select"
                aria-label="Time zone"
                value={settings.zone}
                onChange={(event) => update("zone", event.currentTarget.value)}
              >
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.label}
                  </option>
                ))}
              </select>
              <span class="zone__caret" aria-hidden="true">
                ▾
              </span>
            </div>
            <button
              type="button"
              class="icon-btn"
              aria-label="Next time zone"
              title="Next time zone"
              onClick={() => stepZone(1)}
            >
              ›
            </button>
          </div>

          <div class="segmented" role="group" aria-label="Hour format">
            <button
              type="button"
              class="seg"
              aria-pressed={settings.hour12}
              onClick={() => update("hour12", true)}
            >
              12H
            </button>
            <button
              type="button"
              class="seg"
              aria-pressed={!settings.hour12}
              onClick={() => update("hour12", false)}
            >
              24H
            </button>
          </div>

          <button
            type="button"
            class="btn btn--ghost"
            aria-pressed={settings.showSeconds}
            onClick={() => update("showSeconds", !settings.showSeconds)}
          >
            Seconds
          </button>
        </div>
      </main>

      <Stopwatch />

      <footer class="app__foot">
        <span>Home zone · {LOCAL_ZONE}</span>
        <span>Preact + Vite</span>
      </footer>
    </div>
  )
}
