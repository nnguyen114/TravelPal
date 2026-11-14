type P = { size?: number; color?: string }
const base = (size: number, color: string) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 2,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true,
})

const PinIcon = ({ size = 22, color = '#fff' }: P) => (
  <svg {...base(size, color)}><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
)
export const PlusIcon = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)} strokeWidth={2.4}><path d="M12 5v14M5 12h14" /></svg>
)
export const LinkIcon = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
)
export const SparkleIcon = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)}><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
)
export const LockIcon = ({ size = 13, color = 'currentColor' }: P) => (
  <svg {...base(size, color)} strokeWidth={2.4}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
)
export const CloseIcon = ({ size = 20, color = '#44505E' }: P) => (
  <svg {...base(size, color)} strokeWidth={2.2}><path d="M6 6l12 12M18 6L6 18" /></svg>
)

export function Logo() {
  return <span className="logo"><PinIcon /></span>
}
