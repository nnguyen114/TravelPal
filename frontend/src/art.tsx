import type { ReactNode } from 'react'

/** Illustrated covers for trip cards. Each trip always gets the same scene (picked from its id). */

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

export function TripCover({ seed }: { seed: string }) {
  const Scene = SCENES[hash(seed) % SCENES.length]
  return (
    <svg className="trip-cover" viewBox="0 0 300 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <Scene />
    </svg>
  )
}

const Cloud = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <g className="cover-cloud" fill="#fff">
      <ellipse cx="20" cy="12" rx="20" ry="8" /><circle cx="14" cy="8" r="9" /><circle cx="27" cy="6" r="10" />
    </g>
  </g>
)

function Mountains() {
  return (
    <>
      <rect width="300" height="150" fill="#CDEFF0" />
      <circle className="cover-sun" cx="236" cy="42" r="22" fill="#FFC94D" />
      <Cloud x={40} y={24} />
      <path d="M0 110 L60 60 L100 86 L150 40 L210 96 L250 70 L300 100 L300 150 L0 150 Z" fill="#B7B0F0" />
      <path d="M150 40 L166 54 L156 53 L148 60 L140 52 Z" fill="#fff" />
      <path d="M0 150 L0 120 C 70 104, 160 132, 300 112 L300 150 Z" fill="#5DB7AA" />
      <path d="M40 128 l8 -22 l8 22 z M60 132 l7 -18 l7 18 z" fill="#2F8F6B" />
    </>
  )
}

function City() {
  const blocks = [[20, 58, '#F2734E'], [52, 40, '#FFD66B'], [80, 70, '#fff'], [112, 48, '#7C6CF0'], [140, 84, '#14A098'], [172, 52, '#D9548A'], [204, 64, '#3B7FC4'], [236, 44, '#FFD66B'], [264, 60, '#F2734E']] as const
  return (
    <>
      <rect width="300" height="150" fill="#FDE3D6" />
      <circle className="cover-sun" cx="60" cy="40" r="20" fill="#FFC94D" />
      <Cloud x={190} y={20} />
      {blocks.map(([x, h, c]) => (
        <g key={x}>
          <rect x={x} y={130 - h} width="26" height={h} fill={c} />
          {[0, 1, 2].map((r) => r * 16 + 12 < h && <rect key={r} x={x + 6} y={130 - h + 8 + r * 16} width="6" height="7" fill="#1C2430" opacity=".18" />)}
        </g>
      ))}
      <rect y="130" width="300" height="20" fill="#E2B74D" />
    </>
  )
}

function Coast() {
  return (
    <>
      <rect width="300" height="150" fill="#D6EEFB" />
      <circle className="cover-sun" cx="220" cy="50" r="24" fill="#FFC94D" />
      <path d="M0 96 H300 V150 H0 Z" fill="#4FA9D9" />
      <path className="cover-wave" d="M10 108 h30 M90 118 h40 M180 106 h26 M240 120 h34" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M0 150 L0 124 C 60 112, 120 130, 190 150 Z" fill="#F7DFA6" />
      <path d="M58 122 C 56 100, 60 86, 66 74" stroke="#8C5A2B" strokeWidth="4" fill="none" />
      <path d="M66 74 c -14 -6 -24 0 -30 6 M66 74 c 12 -8 24 -4 30 2 M66 74 c -4 -12 2 -20 10 -24" stroke="#3FA77F" strokeWidth="6" strokeLinecap="round" fill="none" />
      <g className="cover-boat"><path d="M190 96 h28 l-5 7 h-18 z" fill="#fff" /><path d="M203 96 v-18 l11 15 z" fill="#F2734E" /></g>
    </>
  )
}

function Lake() {
  return (
    <>
      <rect width="300" height="150" fill="#E7E3FC" />
      <Cloud x={30} y={30} />
      <g className="cover-balloon">
        <ellipse cx="230" cy="44" rx="16" ry="19" fill="#F2734E" />
        <path d="M222 44 a8 19 0 0 0 16 0" fill="#FFD66B" />
        <rect x="225" y="66" width="10" height="7" rx="2" fill="#B97A3F" />
      </g>
      <path d="M0 104 C 60 80, 120 96, 180 84 S 270 88, 300 82 L300 150 L0 150 Z" fill="#9FD4CB" />
      <ellipse cx="150" cy="122" rx="110" ry="16" fill="#5FB9DE" />
      <path d="M0 150 L0 136 C 80 128, 200 146, 300 132 L300 150 Z" fill="#3FA77F" />
      <path d="M262 112 l10 -28 l10 28 z" fill="#2F8F6B" />
    </>
  )
}

const SCENES = [Mountains, City, Coast, Lake]

/** A friendly empty state: a small illustration, a title and one line of help. */
export function Empty({ title, children, compact }: { title: string; children?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty${compact ? ' compact' : ''}`}>
      <svg viewBox="0 0 120 80" aria-hidden="true">
        <ellipse cx="60" cy="70" rx="44" ry="6" fill="#EDEAE2" />
        <rect className="empty-case" x="36" y="30" width="48" height="36" rx="7" fill="#F2734E" />
        <rect x="36" y="44" width="48" height="5" fill="#D85C39" />
        <path d="M50 30v-6a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v6" stroke="#1C2430" strokeWidth="3" fill="none" />
        <circle cx="74" cy="40" r="5" fill="#FFD66B" />
        <g className="empty-plane"><path d="M86 14 L104 8 L96 24 L92 18 Z" fill="#fff" stroke="#1C2430" strokeWidth="1.6" strokeLinejoin="round" /></g>
        <path d="M30 22 q10 -12 24 -10" stroke="#7C6CF0" strokeWidth="2" strokeDasharray="2 4" fill="none" strokeLinecap="round" />
      </svg>
      <div>
        <b>{title}</b>
        {children && <p>{children}</p>}
      </div>
    </div>
  )
}
