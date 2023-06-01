import { useEffect } from "preact/compat"
import { useState } from "preact/hooks"

export const App = () => {
  const [clock, setClock] = useState(new Date().toLocaleTimeString())
  const [date, setDate] = useState(new Date().toLocaleDateString("en-GB"))

  useEffect(() => {
    const interval = setInterval(() => {
      setClock(new Date().toLocaleTimeString())
      setDate(new Date().toLocaleDateString("en-GB"))
    }, 1000)

    return () => {
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="clock-wrapper">
      <p>Preact Clock</p>
      <h1>{clock}</h1>
      <p>{date}</p>
      <span className="created">
        Created with{" "}
        <a href="https://preactjs.com/" target="_blank">
          Preact
        </a>
      </span>
    </div>
  )
}
