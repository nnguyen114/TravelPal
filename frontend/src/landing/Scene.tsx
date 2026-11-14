import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'

/**
 * The hero illustration: a layered travel landscape. Layers shift with the pointer at different depths (parallax),
 * clouds drift, the balloon bobs, a camper van drives the road and a paper plane loops overhead.
 */
const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const layer = (depth: number) => ({ '--depth': depth }) as CSSProperties

const ROAD = 'M-20 560 C 120 520, 180 470, 300 462 S 470 470, 520 430 S 600 380, 640 372'
const FLIGHT = 'M-60 150 C 120 60, 300 40, 420 110 S 660 210, 860 90'

export function Scene() {
  const box = useRef<HTMLDivElement>(null)
  const [still] = useState(reduced)

  function move(e: PointerEvent<HTMLDivElement>) {
    if (still || e.pointerType !== 'mouse' || !box.current) return
    const r = box.current.getBoundingClientRect()
    box.current.style.setProperty('--px', String((e.clientX - r.left) / r.width - 0.5))
    box.current.style.setProperty('--py', String((e.clientY - r.top) / r.height - 0.5))
  }

  return (
    <div className="scene-art" ref={box} onPointerMove={move} onPointerLeave={() => {
      box.current?.style.setProperty('--px', '0')
      box.current?.style.setProperty('--py', '0')
    }} aria-hidden="true">
      <svg viewBox="0 0 800 560" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8FD3EC" />
            <stop offset=".55" stopColor="#CBEFF0" />
            <stop offset="1" stopColor="#FFE3C2" />
          </linearGradient>
          <radialGradient id="glow">
            <stop offset="0" stopColor="#FFF4C7" stopOpacity=".9" />
            <stop offset="1" stopColor="#FFF4C7" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5FB9DE" />
            <stop offset="1" stopColor="#3E95C7" />
          </linearGradient>
          <linearGradient id="balloon" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#F2734E" /><stop offset=".25" stopColor="#F2734E" />
            <stop offset=".25" stopColor="#FFD66B" /><stop offset=".5" stopColor="#FFD66B" />
            <stop offset=".5" stopColor="#F2734E" /><stop offset=".75" stopColor="#F2734E" />
            <stop offset=".75" stopColor="#FFD66B" /><stop offset="1" stopColor="#FFD66B" />
          </linearGradient>
        </defs>

        <rect width="800" height="560" fill="url(#sky)" />
        <g className="px" style={layer(4)}>
          <circle cx="600" cy="160" r="150" fill="url(#glow)" />
          <circle className="sun" cx="600" cy="160" r="54" fill="#FFC94D" />
        </g>

        <g className="px drift" style={layer(8)}>
          <Cloud x={90} y={90} s={1} />
          <Cloud x={430} y={70} s={0.7} />
          <Cloud x={660} y={250} s={0.8} />
        </g>

        {/* far range */}
        <g className="px" style={layer(6)}>
          <path d="M0 330 L90 250 L150 290 L240 200 L330 280 L400 240 L470 300 L560 220 L650 290 L720 250 L800 300 L800 380 L0 380 Z" fill="#B7B0F0" />
          <path d="M240 200 L262 220 L248 218 L236 228 L224 216 Z M560 220 L580 238 L566 236 L556 244 L546 234 Z" fill="#fff" opacity=".85" />
        </g>

        {/* the big snowy peak */}
        <g className="px" style={layer(10)}>
          <path d="M120 400 L330 168 L380 210 L420 180 L620 400 Z" fill="#6E9FD8" />
          <path d="M330 168 L372 214 L352 210 L338 226 L322 208 L300 222 L292 206 Z" fill="#fff" />
          <path d="M420 180 L452 214 L436 212 L424 224 L410 210 L398 216 Z" fill="#fff" />
          <path d="M330 168 L390 400 L120 400 Z" fill="#5A8CC8" opacity=".45" />
        </g>

        {/* hot air balloon */}
        <g className="px" style={layer(14)}>
          <g className="balloon">
            <ellipse cx="660" cy="300" rx="30" ry="36" fill="url(#balloon)" />
            <path d="M636 320 L650 346 M684 320 L670 346" stroke="#8C5A2B" strokeWidth="1.5" />
            <rect x="648" y="346" width="24" height="16" rx="3" fill="#B97A3F" />
          </g>
        </g>

        {/* hills, lake and town */}
        <g className="px" style={layer(16)}>
          <path d="M0 400 C 120 360, 230 380, 330 400 C 430 420, 520 370, 640 380 C 720 386, 770 400, 800 396 L800 560 L0 560 Z" fill="#8ED1B7" />
          <ellipse cx="520" cy="440" rx="190" ry="34" fill="url(#lake)" />
          <path className="shimmer" d="M440 434 h40 M520 446 h56 M600 436 h30 M470 452 h24" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          <g className="boat">
            <path d="M548 430 h34 l-6 8 h-22 z" fill="#fff" />
            <path d="M564 430 v-22 l14 18 z" fill="#F2734E" />
          </g>
          <Town />
          <Lighthouse x={714} y={360} />
        </g>

        {/* road with camper van */}
        <g className="px" style={layer(22)}>
          <path d="M0 470 C 140 440, 260 480, 400 470 S 640 430, 800 450 L800 560 L0 560 Z" fill="#5DB7AA" />
          <path d={ROAD} stroke="#F7EEDB" strokeWidth="26" fill="none" strokeLinecap="round" />
          <path d={ROAD} stroke="#E2B74D" strokeWidth="2.5" strokeDasharray="10 12" fill="none" />
          <g>
            {!still && <animateMotion dur="16s" repeatCount="indefinite" rotate="auto" path={ROAD} />}
            <Van />
          </g>
          <Trees />
        </g>

        {/* paper plane looping above everything */}
        <path d={FLIGHT} stroke="#fff" strokeWidth="2.5" strokeDasharray="2 9" strokeLinecap="round" fill="none" opacity=".9" />
        <g>
          {!still && <animateMotion dur="11s" repeatCount="indefinite" rotate="auto" path={FLIGHT} />}
          <path d="M-14 -8 L16 0 L-14 8 L-8 0 Z" fill="#fff" stroke="#1C2430" strokeWidth="1.5" strokeLinejoin="round" />
        </g>
        <g className="birds" stroke="#1C2430" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".55">
          <path d="M200 160 q8 -8 16 0 q8 -8 16 0" />
          <path d="M240 186 q6 -6 12 0 q6 -6 12 0" />
        </g>
      </svg>
    </div>
  )
}

function Cloud({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill="#fff">
      <ellipse cx="40" cy="30" rx="40" ry="18" />
      <circle cx="30" cy="20" r="20" />
      <circle cx="58" cy="16" r="24" />
      <circle cx="84" cy="28" r="16" />
      <rect x="0" y="28" width="100" height="20" rx="10" />
    </g>
  )
}

// Small town by the lake: colorful roofs, lit windows.
const HOUSES = [
  { x: 300, w: 46, h: 40, wall: '#FFF7EC', roof: '#F2734E' },
  { x: 350, w: 34, h: 54, wall: '#FFE9B8', roof: '#7C6CF0' },
  { x: 388, w: 52, h: 34, wall: '#FFF7EC', roof: '#14A098' },
  { x: 444, w: 30, h: 46, wall: '#FCE3EC', roof: '#D9548A' },
  { x: 610, w: 40, h: 36, wall: '#FFF7EC', roof: '#D69A1E' },
  { x: 654, w: 30, h: 48, wall: '#E3F0FB', roof: '#3B7FC4' },
]

function Town() {
  const base = 412
  return (
    <g>
      {HOUSES.map((h) => (
        <g key={h.x}>
          <rect x={h.x} y={base - h.h} width={h.w} height={h.h} fill={h.wall} />
          <path d={`M${h.x - 4} ${base - h.h} L${h.x + h.w / 2} ${base - h.h - 18} L${h.x + h.w + 4} ${base - h.h} Z`} fill={h.roof} />
          <rect x={h.x + 7} y={base - h.h + 10} width="8" height="9" rx="1.5" fill="#FFC94D" />
          {h.w > 36 && <rect x={h.x + h.w - 15} y={base - h.h + 10} width="8" height="9" rx="1.5" fill="#9FC6E8" />}
          <rect x={h.x + h.w / 2 - 5} y={base - 14} width="10" height="14" rx="2" fill="#B97A3F" />
        </g>
      ))}
    </g>
  )
}

function Lighthouse({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <path d={`M${x - 12} ${y + 56} L${x - 7} ${y} L${x + 7} ${y} L${x + 12} ${y + 56} Z`} fill="#fff" />
      <path d={`M${x - 10} ${y + 40} L${x + 10} ${y + 40} L${x + 11} ${y + 50} L${x - 11} ${y + 50} Z M${x - 8} ${y + 14} L${x + 8} ${y + 14} L${x + 9} ${y + 24} L${x - 9} ${y + 24} Z`} fill="#F2734E" />
      <rect x={x - 9} y={y - 12} width="18" height="12" rx="2" fill="#FFC94D" className="beam" />
      <path d={`M${x - 11} ${y - 12} L${x} ${y - 24} L${x + 11} ${y - 12} Z`} fill="#F2734E" />
    </g>
  )
}

function Trees() {
  const pines = [[40, 470], [70, 486], [230, 488], [760, 470], [730, 490]]
  const rounds = [[120, 500], [690, 500], [580, 494]]
  return (
    <g>
      {pines.map(([x, y]) => (
        <g key={`p${x}`}>
          <rect x={x - 3} y={y} width="6" height="12" fill="#8C5A2B" />
          <path d={`M${x} ${y - 38} L${x + 16} ${y} L${x - 16} ${y} Z`} fill="#2F8F6B" />
          <path d={`M${x} ${y - 38} L${x + 16} ${y} L${x} ${y} Z`} fill="#257A5B" />
        </g>
      ))}
      {rounds.map(([x, y]) => (
        <g key={`r${x}`}>
          <rect x={x - 3} y={y} width="6" height="12" fill="#8C5A2B" />
          <circle cx={x} cy={y - 12} r="16" fill="#3FA77F" />
          <circle cx={x + 5} cy={y - 16} r="7" fill="#5FC198" />
        </g>
      ))}
    </g>
  )
}

function Van() {
  return (
    <g transform="translate(-22 -26)">
      <rect x="0" y="6" width="44" height="22" rx="6" fill="#F2734E" />
      <rect x="0" y="16" width="44" height="12" rx="3" fill="#fff" />
      <path d="M30 6 h8 a6 6 0 0 1 6 6 v4 h-14 z" fill="#CFEAF6" />
      <rect x="6" y="9" width="18" height="6" rx="1.5" fill="#CFEAF6" />
      <rect x="4" y="0" width="30" height="6" rx="2" fill="#7C6CF0" />
      <circle cx="11" cy="29" r="5" fill="#1C2430" />
      <circle cx="34" cy="29" r="5" fill="#1C2430" />
    </g>
  )
}
