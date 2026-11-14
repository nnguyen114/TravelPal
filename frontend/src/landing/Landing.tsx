import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Logo, SparkleIcon } from '../icons'
import { DAY_COLORS } from '../trip'
import { Demo } from './Demo'
import './landing.css'

/** Fades sections in as they scroll into view. Without IntersectionObserver (or with reduced motion) all is visible. */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>('[data-reveal]')
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el) => (el.dataset.in = 'true'))
      return
    }
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) {
        (e.target as HTMLElement).dataset.in = 'true'
        io.unobserve(e.target)
      }
    }), { threshold: 0.15, rootMargin: '0px 0px -40px 0px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

const delay = (s: number) => ({ '--d': `${s}s` }) as CSSProperties

export function Landing() {
  useReveal()
  return (
    <div className="landing">
      <header className="lp-nav">
        <Link to="/" className="brand"><Logo /> TravelPal</Link>
        <nav aria-label="Main">
          <a href="#demo">How it works</a>
          <a href="#features">Features</a>
        </nav>
        <div className="row">
          <Link to="/login" className="btn btn-ghost">Log in</Link>
          <Link to="/signup" className="btn btn-primary lp-cta">Start planning</Link>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow" data-reveal style={delay(0)}><SparkleIcon size={15} /> Group trips, sorted by AI</span>
            <h1 data-reveal style={delay(0.08)}>
              Every great trip starts with a <span className="lp-scribble">messy list</span>.
            </h1>
            <p data-reveal style={delay(0.16)}>
              Paste the places everyone's been saving, invite your crew, and TravelPal turns it into days that
              actually work: bars at night, coffee in the morning, day trips on a day of their own.
            </p>
            <div className="row" data-reveal style={delay(0.24)}>
              <Link to="/signup" className="btn btn-primary lp-big">Start planning, it's free</Link>
              <a href="#demo" className="btn lp-big lp-watch">
                <span className="lp-play" aria-hidden="true">▶</span> Watch it work
              </a>
            </div>
          </div>
          <HeroArt />
        </section>

        <section id="demo" className="lp-section lp-demo-section">
          <SectionHead eyebrow="See it in 30 seconds" title="From a pile of pins to a plan">
            This is the real workflow, start to finish. Click a step to jump to it.
          </SectionHead>
          <div data-reveal style={delay(0.1)}><Demo /></div>
        </section>

        <section id="features" className="lp-section">
          <SectionHead eyebrow="Why it's different" title="Built for trips with more than one opinion" />
          <div className="lp-bento">
            {FEATURES.map((f, i) => (
              <article key={f.title} className={`lp-feature ${f.wide ? 'wide' : ''}`} data-reveal style={delay(i * 0.06)}>
                <div className="lp-feature-art" aria-hidden="true">{f.art}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-section">
          <SectionHead eyebrow="Three steps" title="Less spreadsheet, more trip" />
          <ol className="lp-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} data-reveal style={delay(i * 0.1)}>
                <span className="lp-step-n" style={{ background: DAY_COLORS[i] }}>{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-final" data-reveal>
          <Hills />
          <h2>Where to next?</h2>
          <p>Start with one destination and a few places. Your friends can pile on later.</p>
          <Link to="/signup" className="btn lp-big lp-invert">Plan your first trip</Link>
        </section>
      </main>

      <footer className="lp-footer">
        <span className="brand"><Logo /> TravelPal</span>
        <span className="muted">Plan trips together. Let AI sort out the days.</span>
      </footer>
    </div>
  )
}

function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="lp-head" data-reveal>
      <span className="lp-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  )
}

/** Illustrated hills with floating cards from the app, gently bobbing. */
function HeroArt() {
  return (
    <div className="lp-hero-art" aria-hidden="true" data-reveal style={delay(0.2)}>
      <div className="lp-sky">
        <Hills />
        <svg className="lp-trail" viewBox="0 0 520 420">
          <path d="M60 330 C 140 260, 120 200, 210 190 S 330 120, 420 80" />
        </svg>
        <span className="lp-pin" style={{ left: '11%', top: '76%', background: DAY_COLORS[0], ...delay(0.5) }}>1</span>
        <span className="lp-pin" style={{ left: '39%', top: '43%', background: DAY_COLORS[0], ...delay(0.7) }}>2</span>
        <span className="lp-pin" style={{ left: '79%', top: '17%', background: DAY_COLORS[1], ...delay(0.9) }}>3</span>
      </div>
      <div className="lp-float lp-f1">
        <span className="n" style={{ background: DAY_COLORS[1] }}>3</span>
        <div><b>Golden Gai</b><small>9:00 PM · best after dark</small></div>
      </div>
      <div className="lp-float lp-f2">
        <SparkleIcon size={16} color="var(--accent)" />
        <div><b>Nikko gets its own day</b><small>125 km away, so it's a day trip</small></div>
      </div>
      <div className="lp-float lp-f3">
        <div className="lp-faces"><i style={{ background: '#FFD9A8' }}>Y</i><i style={{ background: '#C9E6FF' }}>M</i><i style={{ background: '#D9F2D0' }}>K</i></div>
        <small>Mina suggested 2 places</small>
      </div>
    </div>
  )
}

function Hills() {
  return (
    <svg className="lp-hills" viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 150 L90 90 L160 130 L240 70 L330 140 L420 80 L520 130 L600 100 L600 200 L0 200 Z" fill="#9FD4CB" />
      <path d="M0 200 L0 168 C 120 140, 260 190, 380 160 C 470 140, 540 170, 600 156 L600 200 Z" fill="#5DB7AA" />
    </svg>
  )
}

const FEATURES = [
  {
    title: 'Paste anything',
    body: 'A list from the group chat, a Google Maps link, a TikTok someone saved. TravelPal finds the places and puts them on the map.',
    wide: true,
    art: (
      <div className="art-paste">
        <span className="chip">maps.app.goo.gl/…</span>
        <span className="arrow">→</span>
        <span className="chip solid">📍 Tsukiji Outer Market</span>
      </div>
    ),
  },
  {
    title: 'Days that make sense',
    body: 'Places are grouped by neighborhood and set at the right hour: markets early, bars late.',
    art: (
      <div className="art-times">
        {[['Market', '8:00 AM', 0], ['Museum', '1:30 PM', 0], ['Bar district', '9:00 PM', 1]].map(([n, time, d]) => (
          <div key={n} className="mini-stop"><span className="dot" style={{ background: DAY_COLORS[d as number] }} />{n}<small>{time}</small></div>
        ))}
      </div>
    ),
  },
  {
    title: 'Day trips, spotted',
    body: "Far-away places get a day of their own instead of being squeezed between two city stops.",
    art: <div className="art-trip"><span className="chip">Nikko</span><span className="dash" /><span className="chip solid">Day 4 · all day</span></div>,
  },
  {
    title: 'Plan together, live',
    body: 'Share one link. Everyone sees changes as they happen, and nobody overwrites anyone else.',
    art: <div className="lp-faces big"><i style={{ background: '#FFD9A8' }}>Y</i><i style={{ background: '#C9E6FF' }}>M</i><i style={{ background: '#D9F2D0' }}>K</i><i style={{ background: '#F8D3E3' }}>A</i></div>,
  },
  {
    title: 'More like this',
    body: 'Ask for places like the ones you loved. Every suggestion says why it fits you.',
    art: <div className="art-why"><SparkleIcon size={14} color="var(--accent)" /> Why this? Same pour-over style as your saved café.</div>,
  },
  {
    title: 'Suggestions, not surprises',
    body: 'Friends propose changes, talk them over, and AI checks whether each one fits before anyone merges it.',
    wide: true,
    art: (
      <div className="art-proposal">
        <span><b>Mina</b> suggests Omoide Yokocho</span>
        <span className="ok"><SparkleIcon size={13} /> Fits Day 2 at 7:30 PM</span>
      </div>
    ),
  },
  {
    title: 'Nothing gets lost',
    body: 'Every change lands in the trip history, and place edits can be undone in one tap.',
    art: <div className="art-undo"><span>moved Senso-ji to Day 1</span><b>Undo</b></div>,
  },
]

const STEPS = [
  { title: 'Drop in your places', body: 'Type them, paste a list, or paste links. Rough is fine.' },
  { title: 'Invite your people', body: 'One link. They add favorites and suggest changes.' },
  { title: 'Let AI lay out the days', body: 'Preview the plan, tweak it, apply it. Lock what must not move.' },
]
