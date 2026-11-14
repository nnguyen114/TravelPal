import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { SparkleIcon } from '../icons'
import { DAY_COLORS } from '../trip'

/**
 * A scripted, looping "clip" of the workspace. Everything on screen is derived from one clock (t, in seconds), so
 * chapters can be clicked, the clip paused, and nothing drifts out of sync. CSS transitions do the in-between motion.
 */

type Place = { name: string; x: number; y: number; day: number; time: string; hint?: string }

// Map coordinates are on a 400x300 sketch of Tokyo (west left, bay bottom right).
const PLACES: Place[] = [
  { name: 'Senso-ji', x: 300, y: 92, day: 0, time: '8:00 AM', hint: 'Quietest early' },
  { name: 'Blue Bottle Kiyosumi', x: 290, y: 168, day: 0, time: '10:30 AM', hint: 'Coffee before 11' },
  { name: 'Tsukiji Outer Market', x: 236, y: 196, day: 0, time: '12:30 PM' },
  { name: 'teamLab Planets', x: 282, y: 238, day: 0, time: '3:00 PM' },
  { name: 'Meiji Jingu', x: 116, y: 168, day: 1, time: '9:00 AM' },
  { name: 'Shibuya Sky', x: 132, y: 214, day: 1, time: '5:30 PM', hint: 'Sunset views' },
  { name: 'Golden Gai', x: 112, y: 116, day: 1, time: '9:00 PM', hint: 'Bar district · best after dark' },
  { name: 'Nikko', x: 58, y: 30, day: 2, time: 'All day', hint: 'Day trip · gets its own day' },
]
const OMOIDE: Place = { name: 'Omoide Yokocho', x: 96, y: 134, day: 1, time: '7:30 PM' }
const FINDS = [
  { name: 'Koffee Mameya', x: 150, y: 186, why: 'Tiny specialty bar, the same pour-over style as your saved Blue Bottle.' },
  { name: 'Fuglen Tokyo', x: 104, y: 196, why: 'Coffee by day, cocktails at night. Near your Day 2 stops.' },
  { name: 'Onibus Coffee', x: 160, y: 248, why: 'Neighborhood roaster with a calm upstairs room.' },
]
// Typed one character (not UTF-16 unit) at a time, so the emoji never shows half-typed.
const PASTE = [...`Tokyo list 🗾
Senso-ji
Tsukiji Outer Market
Golden Gai
teamLab Planets
Meiji Jingu
Shibuya Sky
Blue Bottle Kiyosumi
Nikko (day trip?)`]

const CHAPTERS = [
  { label: 'Paste a list', start: 0 },
  { label: 'AI plans the days', start: 8 },
  { label: 'Plan together', start: 16 },
  { label: 'Find more like it', start: 24 },
]
const LENGTH = 32

const clamp = (v: number) => Math.min(1, Math.max(0, v))
const prog = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
const chapterAt = (t: number) => CHAPTERS.findLastIndex((c) => t >= c.start)
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Shows a press (ring + scale) on a button while the clip "clicks" it. */
const pressed = (t: number, at: number) => t >= at && t < at + 0.45

export function Demo() {
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  // Autoplay only when it can be seen and the visitor hasn't asked for less motion. Pressing Play always plays.
  const [canAnimate] = useState(() => !reducedMotion() && typeof IntersectionObserver !== 'undefined')
  const [visible, setVisible] = useState(!canAnimate)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!canAnimate || !box.current) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 })
    io.observe(box.current)
    setPlaying(true)
    return () => io.disconnect()
  }, [canAnimate])

  useEffect(() => {
    if (!playing || !visible) return
    let last = performance.now()
    let frame = requestAnimationFrame(function tick(now) {
      if (!document.hidden) setT((v) => (v + (now - last) / 1000) % LENGTH)
      last = now
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, visible])

  const chapter = chapterAt(t)
  const jump = (i: number) => {
    // Without motion, show the chapter's finished state instead of playing it.
    setT(canAnimate ? CHAPTERS[i].start : (CHAPTERS[i + 1]?.start ?? LENGTH) - 0.01)
    if (canAnimate) setPlaying(true)
  }

  return (
    <div className="demo" ref={box}>
      <div className="demo-frame" aria-label="Animated demo of planning a Tokyo trip in TravelPal" role="img">
        <div className="demo-chrome" aria-hidden="true">
          <span /><span /><span />
          <div className="demo-url">travelpal.app/trips/tokyo-spring</div>
          <div className="demo-people">
            <i style={{ background: '#FFD9A8' }}>Y</i>
            <i style={{ background: '#C9E6FF', opacity: t >= 16.4 ? 1 : 0, transform: t >= 16.4 ? 'none' : 'scale(.4)' }}>M</i>
          </div>
        </div>
        <div className="demo-body" aria-hidden="true">
          <div className="demo-panel">
            <Panel t={t} chapter={chapter} />
          </div>
          <DemoMap t={t} />
        </div>
      </div>
      <div className="demo-controls">
        <button className="demo-play" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause demo' : 'Play demo'}>
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="1" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="8.5" y="1" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.5v11l9.5-5.5z" fill="currentColor" /></svg>
          )}
        </button>
        <div className="demo-chapters" role="tablist" aria-label="Demo chapters">
          {CHAPTERS.map((c, i) => {
            const end = CHAPTERS[i + 1]?.start ?? LENGTH
            return (
              <button key={c.label} role="tab" aria-selected={chapter === i} onClick={() => jump(i)}>
                <span className="demo-bar"><span style={{ transform: `scaleX(${prog(t, c.start, end)})` }} /></span>
                {c.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Panel({ t, chapter }: { t: number; chapter: number }) {
  if (chapter === 0) return <PasteScene t={t} />
  if (chapter === 1) return <PlanScene t={t} />
  if (chapter === 2) return <TogetherScene t={t} />
  return <DiscoverScene t={t} />
}

function PasteScene({ t }: { t: number }) {
  const typed = PASTE.slice(0, Math.floor(prog(t, 0.6, 4.6) * PASTE.length)).join('')
  const added = t >= 5.4
  return (
    <div className="scene" key="paste">
      <div className="scene-title">Add places</div>
      {!added ? (
        <>
          <div className="demo-textarea">{typed}<span className="caret" /></div>
          <div className="demo-hint">Paste a list, a Google Maps link, or a TikTok you saved.</div>
          <button className="demo-btn primary" data-pressed={pressed(t, 5)}>Add 8 places</button>
        </>
      ) : (
        <>
          <div className="demo-hint">8 places added · not on a day yet</div>
          <div className="chips">
            {PLACES.map((p, i) => (
              <span key={p.name} className="chip pop" style={{ '--d': `${i * 0.08}s` } as CSSProperties}>{p.name}</span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function PlanScene({ t }: { t: number }) {
  if (t < 11) {
    const steps = [['Grouping places by neighborhood', 9.2], ['Matching each place to its time of day', 9.7], ['Spotting day trips', 10.2]] as const
    return (
      <div className="scene" key="plan-wait">
        <div className="scene-title">Unscheduled · 8</div>
        <div className="demo-hint">Relaxed · Balanced · <b>Packed</b> — pick a pace and let AI do the rest.</div>
        <button className="demo-btn primary" data-pressed={pressed(t, 8.8)}><SparkleIcon size={15} /> Optimize trip</button>
        <div className="thinking">
          {steps.map(([label, at]) => t >= at && <div key={label} className="think-row pop">{label}<span className="dots" /></div>)}
        </div>
      </div>
    )
  }
  return (
    <div className="scene" key="plan-days">
      <Days stagger focus={t >= 12.6 ? 'Golden Gai' : null} trip={t >= 13.8} />
    </div>
  )
}

function Days({ stagger, focus, trip, extra, only }: { stagger: boolean; focus: string | null; trip?: boolean; extra?: boolean; only?: number }) {
  let n = 0
  return (
    <div className="days">
      {[0, 1, 2].filter((d) => only === undefined || d === only).map((d) => {
        const stops = PLACES.filter((p) => p.day === d)
        if (d === 1 && extra) stops.splice(2, 0, OMOIDE)
        return (
          <div key={d} className="day">
            <div className="day-head"><span className="dot" style={{ background: DAY_COLORS[d] }} />Day {d + 1}</div>
            {stops.map((p) => {
              const i = n++
              const isNew = p === OMOIDE
              const showHint = (p.name === focus && p.hint) || (trip && p.day === 2)
              return (
                <div key={p.name} className={`demo-stop pop${isNew ? ' fresh' : ''}${p.name === focus ? ' focus' : ''}`}
                  style={{ '--d': `${stagger ? i * 0.1 : 0}s` } as CSSProperties}>
                  <span className="n" style={{ background: DAY_COLORS[d] }}>{p.day === 2 ? '★' : stops.indexOf(p) + 1}</span>
                  <span className="name">{p.name}</span>
                  <span className="time">{p.time}</span>
                  {showHint && <span className="hint pop">{p.hint}</span>}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function TogetherScene({ t }: { t: number }) {
  const merged = t >= 21.4
  return (
    <div className="scene" key="together">
      {t >= 16.4 && t < 18 && <div className="toast pop">Mina joined the trip</div>}
      {!merged && t >= 17.2 && (
        <div className="proposal pop">
          <div className="who"><i style={{ background: '#C9E6FF' }}>M</i><b>Mina</b> suggests <b>Omoide Yokocho</b></div>
          <div className="comment">“Yakitori before Golden Gai?”</div>
          {t >= 18.6 && <div className="impact pop"><SparkleIcon size={14} /> Fits Day 2 at 7:30 PM, a 5-minute walk from Golden Gai.</div>}
          <div className="proposal-actions">
            {t >= 20 && <span className="reaction pop">👍 You</span>}
            <button className="demo-btn primary small" data-pressed={pressed(t, 20.8)}>Merge</button>
          </div>
        </div>
      )}
      <Days stagger={false} focus={merged ? 'Omoide Yokocho' : null} extra={merged} only={!merged && t >= 17.2 ? 1 : undefined} />
    </div>
  )
}

function DiscoverScene({ t }: { t: number }) {
  return (
    <div className="scene" key="discover">
      <div className="scene-title"><SparkleIcon size={16} /> More like Blue Bottle Kiyosumi</div>
      {t < 26 ? (
        <div className="thinking">{t >= 24.6 && <div className="think-row pop">Finding small specialty coffee near Day 2<span className="dots" /></div>}</div>
      ) : (
        FINDS.map((f, i) => t >= 26 + i * 0.4 && (
          <div key={f.name} className="find pop">
            <div className="spread"><b>{f.name}</b>
              <button className="demo-btn small" data-pressed={i === 0 && pressed(t, 28.4)} data-done={i === 0 && t >= 28.8}>
                {i === 0 && t >= 28.8 ? 'Added ✓' : '+ Add'}
              </button>
            </div>
            <div className="why">Why this? {f.why}</div>
          </div>
        ))
      )}
      {t >= 29 && <div className="toast pop">Added to Day 2 at 10:30 AM</div>}
    </div>
  )
}

function DemoMap({ t }: { t: number }) {
  const planned = t >= 11 && t < 24 + 8
  const routeProgress = prog(t, 11.3, 12.6)
  const route = (d: number) => {
    const pts = PLACES.filter((p) => p.day === d)
    if (d === 1 && t >= 21.4) pts.splice(2, 0, OMOIDE)
    return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')
  }
  const showPin = (i: number) => t >= 5.4 + i * 0.15 || t >= 8
  return (
    <svg className="demo-map" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
      <rect width="400" height="300" fill="#EEF3EC" />
      <path d="M250 300 C 300 250, 330 250, 400 210 L400 300 Z" fill="#CFE6EE" />
      <path d="M318 0 C 312 60, 330 120, 312 170 C 300 210, 330 240, 340 300" stroke="#CFE6EE" strokeWidth="7" fill="none" />
      <ellipse cx="120" cy="170" rx="34" ry="24" fill="#D8EBD3" />
      <ellipse cx="300" cy="78" rx="26" ry="16" fill="#D8EBD3" />
      <path d="M0 140 H400 M0 220 H260 M180 0 V300 M60 0 V300" stroke="#fff" strokeWidth="4" />
      <path d="M30 60 L140 140 M200 120 L320 250" stroke="#fff" strokeWidth="3" />
      {[['Shinjuku', 70, 100], ['Shibuya', 150, 236], ['Asakusa', 336, 70], ['Ginza', 214, 176], ['Tokyo Bay', 352, 278]].map(([n, x, y]) => (
        <text key={n} x={x} y={y} textAnchor="middle" fontSize="9" fontWeight="700" fill="#8A938F" letterSpacing=".06em">{String(n).toUpperCase()}</text>
      ))}
      {/* Nikko is far north: an arrow off the map instead of a pin in the wrong place */}
      <g className="map-trip" style={{ opacity: showPin(7) ? 1 : 0 }}>
        <path d="M112 116 C 90 80, 76 60, 62 40" stroke={planned ? DAY_COLORS[2] : '#1C2430'} strokeWidth="2" strokeDasharray="4 5" fill="none" />
        <rect x="18" y="8" width="96" height="22" rx="11" fill="#fff" />
        <text x="66" y="23" textAnchor="middle" fontSize="10" fontWeight="700" fill="#1C2430">Nikko · 125 km ↑</text>
      </g>
      {planned && [0, 1].map((d) => (
        <g key={d}>
          <mask id={`reveal-${d}`}>
            <path d={route(d)} pathLength={1} stroke="#fff" strokeWidth="10" fill="none" strokeDasharray="1 1" strokeDashoffset={1 - routeProgress} />
          </mask>
          <path d={route(d)} stroke={DAY_COLORS[d]} strokeWidth="2.5" strokeDasharray="5 5" fill="none" mask={`url(#reveal-${d})`} />
        </g>
      ))}
      {PLACES.slice(0, 7).map((p, i) => (
        <MapPin key={p.name} p={p} show={showPin(i)} color={planned ? DAY_COLORS[p.day] : '#1C2430'}
          label={planned ? String(PLACES.filter((q) => q.day === p.day).indexOf(p) + 1 + (p.day === 1 && t >= 21.4 && p.name === 'Golden Gai' ? 1 : 0)) : ''} />
      ))}
      <MapPin p={OMOIDE} show={t >= 21.4} color={DAY_COLORS[1]} label="3" />
      {FINDS.map((f, i) => (
        <g key={f.name} className="map-find" style={{ opacity: t >= 26 + i * 0.4 ? 1 : 0, transform: `translate(${f.x}px, ${f.y}px) scale(${t >= 26 + i * 0.4 ? 1 : 0.3})` }}>
          <circle r="9" fill="#fff" stroke={DAY_COLORS[1]} strokeWidth="2" strokeDasharray="3 2" />
          <text y="3.5" textAnchor="middle" fontSize="10" fill={DAY_COLORS[1]}>✦</text>
        </g>
      ))}
    </svg>
  )
}

function MapPin({ p, show, color, label }: { p: Place; show: boolean; color: string; label: string }) {
  return (
    <g className="map-pin" style={{ transform: `translate(${p.x}px, ${p.y}px) scale(${show ? 1 : 0})`, opacity: show ? 1 : 0 }}>
      <circle r="10" fill={color} stroke="#fff" strokeWidth="2.5" style={{ transition: 'fill .5s' }} />
      <text y="3.5" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">{label}</text>
    </g>
  )
}
