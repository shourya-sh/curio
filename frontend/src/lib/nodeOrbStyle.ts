/**
 * Map a single stored hex to landing-style gradient stops + readable ink, or defaults.
 */
const DEFAULT = {
  colorA: '#dff3ff',
  colorB: '#b9d7ff',
  ink: '#1e3a5f',
} as const

function mixToWhite(hex: string, t: number): string {
  const m = hex.replace('#', '')
  if (m.length !== 6) return DEFAULT.colorA
  const n = parseInt(m, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const mix = (c: number) => Math.round(c + (255 - c) * t)
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`
}

function inkFromHex(hex: string): string {
  const m = hex.replace('#', '')
  if (m.length !== 6) return DEFAULT.ink
  const n = parseInt(m, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const d = (x: number) => Math.max(0, Math.min(255, Math.floor(x * 0.32)))
  return `rgb(${d(r)},${d(g)},${d(b)})`
}

export function nodeOrbStyle(color: string | null | undefined): { background: string; color: string } {
  if (!color) {
    return {
      background: `linear-gradient(150deg, ${DEFAULT.colorA} 0%, ${DEFAULT.colorB} 100%)`,
      color: DEFAULT.ink,
    }
  }
  const c = color.startsWith('#') ? color : `#${color}`
  return {
    background: `linear-gradient(155deg, ${mixToWhite(c, 0.45)} 0%, ${mixToWhite(c, 0.12)} 48%, ${c} 100%)`,
    color: inkFromHex(c),
  }
}
