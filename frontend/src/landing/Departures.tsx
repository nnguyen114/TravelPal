import { useEffect, useRef, useState } from 'react'

/**
 * An airport departures board with split-flap letters. Every few seconds the board rolls on: the top flight leaves
 * and the next destination flips into the bottom row. Still (no flipping) for visitors who prefer reduced motion.
 */
const PLACES = ['Tokyo', 'Lisbon', 'Mexico City', 'Seoul', 'Reykjavik', 'Cape Town', 'Hanoi', 'Marrakech', 'Kyoto', 'Lima', 'Bali', 'New York', 'Istanbul', 'Buenos Aires']
const ROWS = 5
const DEST = 12 // longest name, "Buenos Aires"
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const STATUS = [['Boarding', 'boarding'], ['Gate open', 'open'], ['On time', 'ok'], ['On time', 'ok'], ['On time', 'ok']] as const

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function flight(i: number) {
  const n = ((i % PLACES.length) + PLACES.length) % PLACES.length
  const minutes = 9 * 60 + 40 + i * 15
  return {
    time: `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
    dest: PLACES[n].toUpperCase(),
    code: `TP ${String(204 + n * 37).slice(-3)}`,
    gate: `${'ABCD'[n % 4]}${(n * 7) % 30 + 1}`,
  }
}

export function Departures() {
  const [offset, setOffset] = useState(0)
  const [still] = useState(reduced)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (still || typeof IntersectionObserver === 'undefined' || !box.current) return
    let timer: number | undefined
    const io = new IntersectionObserver(([e]) => {
      window.clearInterval(timer)
      if (e.isIntersecting) timer = window.setInterval(() => setOffset((o) => o + 1), 3600)
    })
    io.observe(box.current)
    return () => {
      io.disconnect()
      window.clearInterval(timer)
    }
  }, [still])

  const rows = Array.from({ length: ROWS }, (_, r) => flight(offset + r))
  return (
    <section className="board-wrap" ref={box} aria-label={`Departures board: ${PLACES.join(', ')}`}>
      <div className="board" aria-hidden="true">
        <div className="board-top">
          <span className="board-title"><Plane /> Departures</span>
          <span className="board-note">Plan a trip anywhere</span>
        </div>
        <div className="board-row board-head">
          <span>Time</span><span>Destination</span><span className="opt">Flight</span><span className="opt">Gate</span><span className="st">Status</span>
        </div>
        {rows.map((f, r) => (
          <div key={r} className="board-row">
            <Flaps text={f.time} still={still} />
            <Flaps text={f.dest.padEnd(DEST)} still={still} />
            <span className="opt"><Flaps text={f.code} still={still} /></span>
            <span className="opt"><Flaps text={f.gate.padEnd(3)} still={still} /></span>
            <span className={`st status status-${STATUS[r][1]}`}>{STATUS[r][0]}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** A row of split-flap cells. When the text changes, each cell spins through a few letters before landing. */
function Flaps({ text, still }: { text: string; still: boolean }) {
  const [shown, setShown] = useState(text)
  useEffect(() => {
    if (still) return
    let step = 0
    const id = window.setInterval(() => {
      step++
      // Cell i starts settling a little after cell i-1, like a real board rippling left to right.
      setShown([...text].map((c, i) => (step >= 4 + i || c === ' ' ? c : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join(''))
      if (step >= 4 + text.length) window.clearInterval(id)
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
