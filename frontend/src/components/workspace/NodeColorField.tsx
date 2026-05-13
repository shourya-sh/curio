import { useEffect, useId, useRef, useState } from 'react'

/** Light, desirable tints (single anchor hexes — gradients applied in the canvas). */
export const NODE_TINT_CHOICES = [
  '#c7e2ff', '#b9e8ff', '#d4c4ff', '#a8eef8', '#ffe6a8', '#c4d0ff', '#ffd6e8', '#ffe0c7',
  '#c8d6ff', '#b3f0d4', '#d4f0ff', '#e8d4ff', '#fff3bf',
] as const

/** Normalize user or API input to `#rrggbb`, or null if invalid. */
export function normalizeNodeFillHex(raw: string): string | null {
  let s = raw.trim()
  if (s.startsWith('#')) s = s.slice(1)
  if (s.length === 3 && /^[0-9a-f]{3}$/i.test(s)) {
    s = s
      .split('')
      .map((ch) => ch + ch)
      .join('')
  }
  if (!/^[0-9a-f]{6}$/i.test(s)) return null
  return `#${s.toLowerCase()}`
}

const MATRIX_EXTRA = [
  '#eef3ff', '#e0f2fe', '#f3e8ff', '#e0fdfa', '#fef3c7', '#fce7f3', '#ffedd5', '#ecfccb',
  '#f0fdf4', '#f5f3ff', '#f8fafc', '#ecfeff',
] as const

type Props = {
  value: string | null
  onChange: (hex: string | null) => void
  nodeId: number
}

export function NodeColorField({ value, onChange, nodeId }: Props) {
  const popId = useId()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  const normalizedPicker = value ? normalizeNodeFillHex(value) : null
  const hexForPicker = normalizedPicker ?? '#c7e2ff'

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('click', onDoc, true)
    return () => document.removeEventListener('click', onDoc, true)
  }, [open])

  return (
    <div className='mf-color-field' ref={ref}>
      <div className='mf-color-chips' role='group' aria-label='Node tint'>
        {NODE_TINT_CHOICES.map((c) => (
          <button
            key={c}
            type='button'
            className={`mf-color-chip${value === c ? ' is-picked' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => onChange(c)}
            aria-pressed={value === c}
          />
        ))}
      </div>
      <div className='mf-color-custom-row'>
        <button
          type='button'
          className='mf-color-custom-trigger'
          aria-expanded={open}
          aria-controls={popId}
          onClick={() => setOpen((o) => !o)}
        >
          <span
            className='mf-color-custom-swatch'
            style={{ background: value ? `linear-gradient(145deg, ${value}, ${value}cc)` : 'linear-gradient(145deg, #e2e8f0, #f8fafc)' }}
            aria-hidden
          />
          Custom
        </button>
        {open ? (
          <div id={popId} className='mf-color-pop' role='dialog' aria-label='Color matrix'>
            <p className='mf-color-pop-title'>Shades & tints</p>
            <div className='mf-color-matrix' role='list'>
              {MATRIX_EXTRA.map((c) => (
                <button
                  key={c}
                  type='button'
                  role='listitem'
                  className={`mf-color-matrix-swatch${value === c ? ' is-pick' : ''}`}
                  style={{ background: c }}
                  onClick={() => onChange(c)}
                />
              ))}
            </div>
            <label className='mf-color-hex-label'>
              Precise
              <input
                type='color'
                key={nodeId}
                value={hexForPicker}
                onChange={(e) => onChange(e.target.value)}
                className='mf-color-input-native'
              />
            </label>
            <button type='button' className='mf-color-clear' onClick={() => onChange(null)}>
              Clear to default
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
