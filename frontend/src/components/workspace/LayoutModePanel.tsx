import { LAYOUT_MODES, type LayoutMode } from '../../lib/api'

type Props = {
  value: LayoutMode
  onChange: (next: LayoutMode) => void
  disabled?: boolean
}

const LABELS: Record<LayoutMode, { title: string; hint: string; glyph: React.ReactNode }> = {
  radial: {
    title: 'Radial',
    hint: 'Sun pattern around the root. Best for hierarchical maps.',
    glyph: (
      <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
        <circle cx='12' cy='12' r='2.6' fill='currentColor' />
        <circle cx='5' cy='12' r='1.8' />
        <circle cx='19' cy='12' r='1.8' />
        <circle cx='12' cy='5' r='1.8' />
        <circle cx='12' cy='19' r='1.8' />
        <path d='M12 12 L5 12 M12 12 L19 12 M12 12 L12 5 M12 12 L12 19' strokeLinecap='round' />
      </svg>
    ),
  },
  tree: {
    title: 'Tree',
    hint: 'Top-down layered. Best for clear hierarchies and flows.',
    glyph: (
      <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
        <circle cx='12' cy='5' r='1.8' fill='currentColor' />
        <circle cx='6' cy='13' r='1.6' />
        <circle cx='12' cy='13' r='1.6' />
        <circle cx='18' cy='13' r='1.6' />
        <circle cx='4' cy='20' r='1.4' />
        <circle cx='12' cy='20' r='1.4' />
        <circle cx='20' cy='20' r='1.4' />
        <path d='M12 7 L6 11 M12 7 L12 11 M12 7 L18 11 M6 15 L4 18 M12 15 L12 18 M18 15 L20 18' strokeLinecap='round' />
      </svg>
    ),
  },
  grid: {
    title: 'Grid',
    hint: 'Compact square packing. Best for dense maps.',
    glyph: (
      <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
        <circle cx='6' cy='6' r='1.6' />
        <circle cx='12' cy='6' r='1.6' />
        <circle cx='18' cy='6' r='1.6' />
        <circle cx='6' cy='12' r='1.6' />
        <circle cx='12' cy='12' r='1.6' fill='currentColor' />
        <circle cx='18' cy='12' r='1.6' />
        <circle cx='6' cy='18' r='1.6' />
        <circle cx='12' cy='18' r='1.6' />
        <circle cx='18' cy='18' r='1.6' />
      </svg>
    ),
  },
  web: {
    title: 'Web',
    hint: 'Force-directed weave. Best when nodes have lots of cross-links.',
    glyph: (
      <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
        <circle cx='12' cy='12' r='2' fill='currentColor' />
        <circle cx='5' cy='7' r='1.4' />
        <circle cx='19' cy='7' r='1.4' />
        <circle cx='4' cy='17' r='1.4' />
        <circle cx='20' cy='18' r='1.4' />
        <path
          d='M5 7 L12 12 M19 7 L12 12 M4 17 L12 12 M20 18 L12 12 M5 7 L19 7 M4 17 L20 18 M5 7 L4 17 M19 7 L20 18'
          strokeLinecap='round'
        />
      </svg>
    ),
  },
}

export function LayoutModePanel({ value, onChange, disabled }: Props) {
  return (
    <div className='mf-layout-panel' role='toolbar' aria-label='Layout pattern'>
      <span className='mf-layout-panel__label'>Layout</span>
      <div className='mf-layout-panel__group'>
        {LAYOUT_MODES.map((mode) => {
          const meta = LABELS[mode]
          const active = mode === value
          return (
            <button
              key={mode}
              type='button'
              className={`mf-layout-panel__btn${active ? ' is-active' : ''}`}
              aria-pressed={active}
              disabled={disabled}
              title={meta.hint}
              onClick={() => {
                if (!active) onChange(mode)
              }}
            >
              <span className='mf-layout-panel__glyph' aria-hidden>
                {meta.glyph}
              </span>
              <span className='mf-layout-panel__name'>{meta.title}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
