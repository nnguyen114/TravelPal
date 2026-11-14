import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Logo, SparkleIcon } from '../icons'
import { DAY_COLORS } from '../trip'
import { Demo } from './Demo'
import { Departures } from './Departures'
import { Scene } from './Scene'
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
const Arrow = () => <span className="arrow" aria-hidden="true">→</span>

const YEAR = new Date().getFullYear()

export function Landing() {
  useReveal()
  return (
    <div className="landing">
      <header className="lp-nav">
        <Link to="/" className="brand"><Logo /> TravelPal</Link>
        <nav aria-label="Main">
          <a href="#demo">How it works</a>
          <a href="#features">Features</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="row">
          <Link to="/login" className="btn btn-ghost">Log in</Link>
          <Link to="/signup" className="btn btn-primary lp-btn">Plan a trip</Link>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <h1 data-reveal>
              Turn the group chat into a <span className="lp-mark">trip</span>.
            </h1>
            <p data-reveal style={delay(0.1)}>Paste everyone's places. Get days that actually work.</p>
            <div className="lp-actions" data-reveal style={delay(0.2)}>
              <Link to="/signup" className="btn btn-primary lp-btn lp-big">Plan a trip <Arrow /></Link>
              <a href="#demo" className="btn lp-btn lp-big lp-secondary"><span className="lp-play" aria-hidden="true">▶</span> See how it works</a>
            </div>
          </div>
          <div className="lp-hero-art" data-reveal style={delay(0.15)}>
            <Scene />
            <div className="lp-card lp-day" aria-hidden="true">
              <div className="lp-day-head"><span className="dot" style={{ background: DAY_COLORS[1] }} /> Day 2 · Tokyo</div>
              {[['Meiji Jingu', '9:00 AM'], ['Shibuya Sky', '5:30 PM'], ['Golden Gai', '9:00 PM']].map(([n, t], i) => (
                <div key={n} className="lp-day-row"><span className="n" style={{ background: DAY_COLORS[1] }}>{i + 1}</span>{n}<small>{t}</small></div>
              ))}
            </div>
          </div>
        </section>

        <Departures />

        <section id="demo" className="lp-band lp-band-mint">
          <Wave />
          <div className="lp-section">
            <Head tag="How it works" title="Watch a trip come together">A three-day Tokyo plan, start to finish. Tap a step to jump to it.</Head>
            <div className="lp-demo-wrap" data-reveal style={delay(0.1)}>
              <span className="lp-sticker lp-sticker-a" aria-hidden="true">Tokyo · 3 days</span>
              <span className="lp-sticker lp-sticker-b" aria-hidden="true">4 friends</span>
              <Demo />
            </div>
          </div>
          <Wave flip />
        </section>

        <section className="lp-section lp-perks-section">
          <Head tag="Why it's faster" title="Where group trips usually get stuck, handled" />
          <div className="lp-extras">
            {PERKS.map((x, i) => (
              <div key={x.title} className="lp-extra" data-reveal style={delay(i * 0.05)}>
                <span className="lp-icon" style={{ background: x.bg, color: x.fg }} aria-hidden="true">{x.icon}</span>
                <div>
                  <span className="lp-kind" style={{ color: x.fg }}>{x.kind}</span>
                  <h3>{x.title}</h3>
                  <p>{x.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="lp-section lp-stories">
          <Story tag="Collect" color="#B5472A" tint="#FDEBE4" title="Paste whatever you've got" art={<CollectArt />}>
            Notes-app lists, Google Maps links, the TikTok someone sent at 2 a.m. TravelPal finds the real place and pins
            it. If a link won't open, it says so and you type the name instead.
          </Story>
          <Story tag="Plan" color="#5B4BD0" tint="#ECEAFD" title="Days that make sense on the ground" art={<PlanArt />} flip>
            Places are grouped by neighborhood and put at the right hour. Lock the dinner reservation, pick a pace, and
            preview the plan before anything changes.
          </Story>
          <Story tag="Decide together" color="#2C64A0" tint="#E3F0FB" title="Suggestions instead of surprise edits" art={<TogetherArt />}>
            Friends propose changes and talk them over in the comments. Before anyone merges, TravelPal checks whether the
            change fits the day.
          </Story>
        </section>

        <section className="lp-band lp-band-sun">
          <Wave />
          <div className="lp-section">
            <Head tag="Made for" title="Trips like these" />
            <div className="lp-uses">
              {USES.map((u, i) => (
                <article key={u.title} className="lp-use" style={{ background: u.bg, ...delay(i * 0.08) }} data-reveal>
                  <div className="lp-use-art" aria-hidden="true">{u.art}</div>
                  <span className="lp-use-where">{u.where}</span>
                  <h3>{u.title}</h3>
                  <p>{u.body}</p>
                </article>
              ))}
            </div>
          </div>
          <Wave flip />
        </section>

        <section id="faq" className="lp-section lp-faq">
          <Head tag="FAQ" title="Questions people ask" />
          <div className="lp-faq-list" data-reveal>
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}<span className="lp-plus" aria-hidden="true" /></summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="lp-final" data-reveal>
          <FinalArt />
          <div className="lp-final-copy">
            <h2>Where are you headed next?</h2>
            <p>Start with one city and a handful of places. Add the rest whenever.</p>
            <Link to="/signup" className="btn lp-btn lp-big lp-light">Plan a trip <Arrow /></Link>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-brand">
          <span className="brand"><Logo /> TravelPal</span>
          <p>For people who plan trips in group chats.</p>
        </div>
        <nav aria-label="Footer">
          <div><h4>Product</h4><a href="#demo">How it works</a><a href="#features">Features</a><a href="#faq">FAQ</a></div>
          <div><h4>Account</h4><Link to="/login">Log in</Link><Link to="/signup">Create an account</Link></div>
        </nav>
        <small>© {YEAR} TravelPal</small>
      </footer>
    </div>
  )
}

function Head({ tag, title, children }: { tag: string; title: string; children?: ReactNode }) {
  return (
    <div className="lp-head" data-reveal>
      <span className="lp-tagline">{tag}</span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  )
}

function Story({ tag, color, tint, title, art, flip, children }:
  { tag: string; color: string; tint: string; title: string; art: ReactNode; flip?: boolean; children: ReactNode }) {
  return (
    <article className={`lp-story${flip ? ' flip' : ''}`}>
      <div className="lp-story-copy" data-reveal>
        <span className="lp-tagline" style={{ background: tint, color }}>{tag}</span>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
      <div className="lp-story-art" style={{ background: tint }} data-reveal>{art}</div>
    </article>
  )
}

function Wave({ flip }: { flip?: boolean }) {
  return (
    <svg className={`lp-wave${flip ? ' flip' : ''}`} viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 60 L0 30 C 240 0, 480 0, 720 26 S 1200 58, 1440 22 L1440 60 Z" />
    </svg>
  )
}

/* ---- story illustrations (small, interactive) ---- */

function CollectArt() {
  return (
    <div className="art-collect" aria-hidden="true">
      <div className="sources">
        <div className="src src-notes"><b>Tokyo ideas</b><span>ramen near hotel??</span><span>golden gai</span><span>teamlab (book ahead)</span></div>
        <div className="src src-link"><span className="src-label">Maps link</span>maps.app.goo.gl/x7Kp…</div>
        <div className="src src-video"><span className="play">▶</span><span>“best coffee in tokyo”</span></div>
      </div>
      <div className="flow">→</div>
      <div className="pins">
        {['Golden Gai', 'teamLab Planets', 'Blue Bottle Kiyosumi'].map((p, i) => (
          <span key={p} className="pin-chip" style={{ '--c': DAY_COLORS[i], ...delay(i * 0.12) } as CSSProperties}><span className="dot" />{p}</span>
        ))}
      </div>
    </div>
  )
}

function PlanArt() {
  const [after, setAfter] = useState(true)
  const stops = [
    ['Tsukiji Market', '8:00 AM', 0], ['Senso-ji', '1:30 PM', 0], ['Golden Gai', '9:00 PM', 1], ['Nikko', 'All day', 2],
  ] as const
  const shown = after ? stops : [stops[2], stops[3], stops[0], stops[1]]
  return (
    <div className="art-plan">
      <div className="segmented" role="group" aria-label="Show itinerary">
        <button aria-pressed={!after} onClick={() => setAfter(false)}>Before</button>
        <button aria-pressed={after} onClick={() => setAfter(true)}>After</button>
      </div>
      <div className="plan-list" key={String(after)}>
        {shown.map(([n, t, d], i) => (
          <div key={n} className="plan-row" style={{ '--c': after ? DAY_COLORS[d] : '#C9C4B8', ...delay(i * 0.06) } as CSSProperties}>
            <span className="dot" />
            <b>{n}</b>
            <small>{after ? `Day ${d + 1} · ${t}` : 'Not planned yet'}</small>
          </div>
        ))}
      </div>
    </div>
  )
}

function TogetherArt() {
  const [liked, setLiked] = useState(false)
  return (
    <div className="art-together">
      <div className="msg"><i style={{ background: '#C9E6FF' }}>M</i><div><b>Mina</b> suggested <b>Omoide Yokocho</b><p>Yakitori before Golden Gai?</p></div></div>
      <div className="check"><SparkleIcon size={14} /> Fits Day 2 at 7:30 PM, a 5-minute walk from Golden Gai</div>
      <div className="msg"><i style={{ background: '#D9F2D0' }}>K</i><div><b>Kenji</b><p>I'm in. Can we skip the sky deck then?</p></div></div>
      <div className="reacts">
        <button className={`react${liked ? ' on' : ''}`} aria-pressed={liked} onClick={() => setLiked(!liked)}>👍 {liked ? 3 : 2}</button>
        <span className="merge">Merge</span>
      </div>
    </div>
  )
}

/* ---- use cases ---- */

const House = ({ x, h, c }: { x: number; h: number; c: string }) => (
  <g>
    <rect x={x} y={90 - h} width="34" height={h + 10} fill={c} />
    <rect x={x + 7} y={100 - h} width="7" height="9" fill="#1C2430" opacity=".22" />
    <rect x={x + 20} y={100 - h} width="7" height="9" fill="#1C2430" opacity=".22" />
  </g>
)

const USES = [
  {
    where: 'Lisbon · 4 days', title: 'Six friends, one long weekend', bg: '#FDEBE4',
    body: 'Everyone sends their list. Nobody has to be the planner.',
    art: (
      <svg viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice">
        <rect width="240" height="110" fill="#FFD0BF" />
        <circle cx="196" cy="30" r="15" fill="#FFC94D" />
        <House x={18} h={40} c="#F2734E" /><House x={54} h={30} c="#FFD66B" /><House x={90} h={46} c="#fff" />
        <House x={126} h={28} c="#7C6CF0" /><House x={162} h={42} c="#14A098" /><House x={198} h={32} c="#D9548A" />
        <rect x="0" y="98" width="240" height="12" fill="#E2B74D" />
        <rect x="40" y="84" width="44" height="14" rx="4" fill="#FFD66B" />
        <circle cx="50" cy="100" r="4" fill="#1C2430" /><circle cx="74" cy="100" r="4" fill="#1C2430" />
      </svg>
    ),
  },
  {
    where: 'Kyoto · 6 days', title: 'Three generations, one plan', bg: '#E2F3F0',
    body: 'A relaxed pace, temples in the cool mornings, everyone back by ten.',
    art: (
      <svg viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice">
        <rect width="240" height="110" fill="#BFE6DF" />
        <path d="M0 80 C 60 60, 120 70, 240 56 L240 110 L0 110 Z" fill="#8ED1B7" />
        <g fill="#E04E3A">
          <rect x="70" y="28" width="100" height="9" rx="3" /><rect x="80" y="44" width="80" height="6" />
          <rect x="88" y="37" width="9" height="63" /><rect x="143" y="37" width="9" height="63" />
        </g>
        {[[30, 70], [210, 62]].map(([x, y]) => <g key={x}><circle cx={x} cy={y} r="14" fill="#F6B9CF" /><circle cx={x + 8} cy={y + 4} r="9" fill="#F9CDDD" /></g>)}
      </svg>
    ),
  },
  {
    where: 'Mexico City → Oaxaca · 2 weeks', title: 'A rough idea and no fixed plan', bg: '#ECEAFD',
    body: 'Add places as you find them and re-plan the days whenever things change.',
    art: (
      <svg viewBox="0 0 240 110" preserveAspectRatio="xMidYMid slice">
        <rect width="240" height="110" fill="#D6D1FA" />
        <circle cx="60" cy="38" r="17" fill="#FFC94D" />
        <path d="M0 90 L50 60 L90 82 L140 48 L190 78 L240 58 L240 110 L0 110 Z" fill="#B7A6F2" />
        <path d="M0 110 C 60 92, 140 104, 240 90 L240 110 Z" fill="#F2734E" />
        {[150, 200].map((x) => <g key={x} fill="#3FA77F"><rect x={x - 4} y={70} width="8" height="26" rx="4" /><rect x={x - 12} y={76} width="6" height="12" rx="3" /><rect x={x + 6} y={74} width="6" height="12" rx="3" /></g>)}
      </svg>
    ),
  },
]

const ico = (d: ReactNode) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>

// Each one removes a step where group planning usually stalls.
const PERKS = [
  {
    kind: 'Together', title: 'Everyone plans at once', bg: '#E2F3F0', fg: '#0A5F59',
    body: 'Share one link. Friends add places from their own phones and see each other\'s changes as they happen.',
    icon: ico(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>),
  },
  {
    kind: 'Together', title: 'Suggest, then merge', bg: '#E3F0FB', fg: '#2C64A0',
    body: 'Instead of rewriting the plan, friends can suggest a change. The group talks it over and AI checks it fits before it goes in.',
    icon: ico(<><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /><path d="M9 11.5l2 2 4-4" /></>),
  },
  {
    kind: 'Auto-planned', title: 'Days sorted in one tap', bg: '#ECEAFD', fg: '#5B4BD0',
    body: 'Places are grouped by neighborhood and put in a sensible order, so nobody spends an evening dragging pins around.',
    icon: ico(<><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" /><path d="M8.5 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.5" /></>),
  },
  {
    kind: 'Auto-planned', title: 'The right hour for each place', bg: '#FFF1CC', fg: '#7A4F00',
    body: 'Markets in the morning, bar streets after dark, and the far-off mountain town on a day of its own.',
    icon: ico(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  },
  {
    kind: 'Tailored by AI', title: 'Picks that match your taste', bg: '#FCE3EC', fg: '#A63266',
    body: 'Ask for more places like the ones you love. Suggestions learn from what you add and skip, and each one says why it fits.',
    icon: ico(<><path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z" /><path d="M19 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" /></>),
  },
  {
    kind: 'Tailored by AI', title: 'Answers instead of research', bg: '#FDEBE4', fg: '#B5472A',
    body: 'Ask “can we fit teamLab on Day 2?” and get a straight answer from your actual plan, with the change ready to apply.',
    icon: ico(<><path d="M4 5h16v11H8l-4 4z" /><path d="M9 10h6" /></>),
  },
]

const FAQ: [string, string][] = [
  ['Do my friends need an account?', 'Yes. They open your invite link, sign up, and land straight in the trip.'],
  ['Will the AI change my plan without asking?', 'No. The optimizer and the assistant only suggest. You see a preview, nothing changes until you apply it, and you can undo it afterwards.'],
  ['What happens if two of us edit at the same time?', "Whoever saves second is shown the latest version first, so nobody's changes get silently overwritten."],
  ['Where does place information come from?', "Map data comes from OpenStreetMap. Opening hours and reviews aren't verified yet, so check before you go."],
  ['Can I use it for a solo trip?', 'Of course. Same planning tools, fewer opinions.'],
]

function FinalArt() {
  return (
    <svg className="lp-final-art" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="dusk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0E7C74" />
          <stop offset=".5" stopColor="#3FA79B" />
          <stop offset=".78" stopColor="#F7B27F" />
          <stop offset="1" stopColor="#FFD38F" />
        </linearGradient>
      </defs>
      <rect width="1200" height="420" fill="url(#dusk)" />
      {[[160, 70], [300, 120], [420, 50], [760, 90], [1040, 60], [1120, 130]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="2" fill="#fff" opacity=".75" />)}
      <circle cx="930" cy="292" r="84" fill="#FFC94D" />
      <circle cx="930" cy="292" r="120" fill="#FFC94D" opacity=".18" />
      <g fill="#fff" opacity=".85">
        <ellipse cx="200" cy="230" rx="60" ry="14" /><ellipse cx="236" cy="220" rx="34" ry="16" />
        <ellipse cx="1010" cy="200" rx="50" ry="12" /><ellipse cx="984" cy="192" rx="28" ry="13" />
      </g>
      <path d="M0 330 L140 250 L240 300 L380 220 L520 300 L640 240 L780 310 L920 250 L1060 300 L1200 260 L1200 420 L0 420 Z" fill="#7C6CF0" opacity=".45" />
      <path d="M0 362 C 180 320, 380 360, 560 340 S 900 300, 1200 344 L1200 420 L0 420 Z" fill="#14A098" />
      <path d="M0 392 C 220 360, 460 404, 700 380 S 1040 366, 1200 388 L1200 420 L0 420 Z" fill="#0A5F59" />
      {[[120, 380], [150, 386], [1080, 372], [1110, 380]].map(([x, y]) => (
        <path key={x} d={`M${x} ${y - 30} L${x + 12} ${y} L${x - 12} ${y} Z`} fill="#06463F" />
      ))}
    </svg>
  )
}
