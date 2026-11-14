import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

/**
 * "Where to?" as an airport departures board. Typing a city flips the top row to spell it; clicking a flight below
 * picks that city. "Plan this trip" carries the choice through sign-up into Create Trip. The lower rows roll on every
 * few seconds while the board is on screen; nothing flips for visitors who prefer reduced motion.
 */
const PLACES = ['Tokyo', 'Lisbon', 'Mexico City', 'Seoul', 'Reykjavik', 'Cape Town', 'Hanoi', 'Marrakech', 'Kyoto', 'Lima', 'Bali', 'New York', 'Istanbul', 'Buenos Aires']
const ROWS = 4
const DEST = 12 // longest name, "Buenos Aires"
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const STATUS = [['Gate open', 'open'], ['On time', 'ok'], ['On time', 'ok'], ['Delayed', 'late']] as const

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function flight(i: number) {
  const n = ((i % PLACES.length) + PLACES.length) % PLACES.length
  const minutes = 10 * 60 + 5 + i * 15
  return {
    city: PLACES[n],
    time: `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
    code: `TP ${String(204 + n * 37).slice(-3)}`,
    gate: `${'ABCD'[n % 4]}${(n * 7) % 30 + 1}`,
  }
}

const board = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').slice(0, DEST).padEnd(DEST)

export function Departures() {
  const [offset, setOffset] = useState(0)
  const [dest, setDest] = useState('')
  const [still] = useState(reduced)
  const box = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  // Hold the board still while someone is pointing at it or using it, so a row can't roll away mid-click.
  const held = useRef(false)

  useEffect(() => {
    if (still || typeof IntersectionObserver === 'undefined' || !box.current) return
    let timer: number | undefined
    const io = new IntersectionObserver(([e]) => {
      window.clearInterval(timer)
      if (e.isIntersecting) timer = window.setInterval(() => { if (!held.current) setOffset((o) => o + 1) }, 4000)
    })
    io.observe(box.current)
    return () => {
      io.disconnect()
      window.clearInterval(timer)
    }
  }, [still])

  const chosen = dest.trim()
  const href = chosen ? `/signup?to=${encodeURIComponent(chosen)}` : '/signup'
  const rows = Array.from({ length: ROWS }, (_, r) => flight(offset + r))

  return (
    <section className="board-wrap" ref={box} aria-labelledby="board-q"
      onPointerEnter={() => (held.current = true)} onPointerLeave={() => (held.current = false)}
      onFocus={() => (held.current = true)} onBlur={() => (held.current = false)}>
      <div className="board">
        <div className="board-top">
          <span className="board-title"><Plane /> Departures</span>
          <label className="board-ask">
            <span id="board-q">Where are you headed?</span>
            <input ref={input} value={dest} maxLength={60} placeholder="Type a city" autoComplete="off"
              onChange={(e) => setDest(e.target.value)} />
          </label>
        </div>

        <div className="board-row board-head" aria-hidden="true">
          <span>Time</span><span>Destination</span><span className="opt">Flight</span><span className="opt">Gate</span><span className="st">Status</span>
        </div>

        <div className={`board-row board-mine${chosen ? ' set' : ''}`}>
          <span aria-hidden="true"><Flaps text="NOW  " still={still} /></span>
          <span aria-live="polite" aria-label={chosen ? `Your trip: ${chosen}` : 'No destination yet'}>
            <Flaps text={board(chosen || 'Where to')} still={still} />
          </span>
          <span className="opt" aria-hidden="true"><Flaps text="TP 001" still={still} /></span>
          <span className="opt" aria-hidden="true"><Flaps text="A1 " still={still} /></span>
          <span className="st">
            <Link to={href} className="board-go">{chosen ? 'Plan this trip' : 'Start planning'} <span aria-hidden="true">→</span></Link>
          </span>
        </div>

        {rows.map((f, r) => (
          <button key={r} type="button" className="board-row board-pick" aria-label={`Pick ${f.city}`}
            onClick={() => { setDest(f.city); input.current?.focus() }}>
            <span aria-hidden="true"><Flaps text={f.time} still={still} /></span>
            <span aria-hidden="true"><Flaps text={board(f.city)} still={still} /></span>
            <span className="opt" aria-hidden="true"><Flaps text={f.code} still={still} /></span>
            <span className="opt" aria-hidden="true"><Flaps text={f.gate.padEnd(3)} still={still} /></span>
            <span className={`st status status-${STATUS[r][1]}`} aria-hidden="true">
              <span className="status-text">{STATUS[r][0]}</span><span className="status-pick">Pick →</span>
            </span>
          </button>
        ))}
        <Link to={href} className="btn btn-primary lp-btn board-mobile-go">{chosen ? `Plan a trip to ${chosen}` : 'Start planning'} →</Link>
      </div>
    </section>
  )
}

/**
 * Split-flap cells. When the text changes, only the cells that changed spin through a few letters before landing,
 * rippling left to right, so typing one letter flips one cell.
 */
function Flaps({ text, still }: { text: string; still: boolean }) {
  const [shown, setShown] = useState(text)
  const prev = useRef(text)
  useEffect(() => {
    const from = prev.current
    prev.current = text
    if (still || from === text) return
    const changed = [...text].map((c, i) => c !== from[i])
    const first = changed.indexOf(true)
    let step = 0
    const id = window.setInterval(() => {
      step++
      setShown([...text].map((c, i) => (!changed[i] || c === ' ' || step >= 3 + i - first ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join(''))
      if (step >= 3 + text.length - first) window.clearInterval(id)
    }, 55)
    return () => window.clearInterval(id)
  }, [text, still])
  const out = still ? text : shown
  return (
    <span className="flaps">
      {[...out].map((c, i) => <span key={`${i}${c}`} className="flap">{c}</span>)}
    </span>
  )
}

function Plane() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />
    </svg>
  )
}
