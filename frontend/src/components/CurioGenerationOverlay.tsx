import { useMemo } from 'react'

export type GenerationOverlayStep = {
  id: string
  title: string
  detail?: string
  /** Visual lane: lead = primary agent row, pulse = status shimmer, tool = capability chip */
  lane: 'lead' | 'pulse' | 'tool'
}

type Props = {
  open: boolean
  /** Short headline, e.g. "Generating your map" */
  headline: string
  /** Optional subline under headline */
  kicker?: string
  steps: GenerationOverlayStep[]
  onStop: () => void
  stopLabel?: string
  /** When false, hide stop (e.g. brief instant before abort ref attaches) */
  stopEnabled?: boolean
  /** When true, overlay covers the full viewport (home project creation). */
  fixed?: boolean
  /** Extra layout tweaks for the dashboard create flow */
  home?: boolean
  /** Replaces the default footnote under Stop */
  recoveryHint?: string
}

function IconSparkOrbit({ className }: { className?: string }) {
  return (
    <svg className={className} width='40' height='40' viewBox='0 0 40 40' fill='none' aria-hidden>
      <circle cx='20' cy='20' r='8' stroke='currentColor' strokeWidth='1.4' opacity='0.35' />
      <circle cx='20' cy='20' r='3' fill='currentColor' opacity='0.9' />
      <ellipse cx='20' cy='20' rx='16' ry='6' stroke='currentColor' strokeWidth='1' opacity='0.45' transform='rotate(-24 20 20)' />
      <ellipse cx='20' cy='20' rx='14' ry='5' stroke='currentColor' strokeWidth='0.9' opacity='0.3' transform='rotate(58 20 20)' />
    </svg>
  )
}

function IconBrainMesh({ className }: { className?: string }) {
  return (
    <svg className={className} width='36' height='36' viewBox='0 0 36 36' fill='none' aria-hidden>
      <path
        d='M18 6c-3.2 0-6 1.6-7.6 4-1.2-.4-2.6-.2-3.6.6C5 12.2 4 14 4 16c0 1.2.4 2.4 1 3.4-.6 1-.9 2.1-.9 3.3 0 2.6 1.6 4.8 4 5.6.4 2.8 2.8 5 5.8 5h8c3 0 5.4-2.2 5.8-5 2.4-.8 4-3 4-5.6 0-1.2-.3-2.3-.9-3.3.6-1 1-2.2 1-3.4 0-2-1-3.8-2.8-4.8-1-.8-2.4-1-3.6-.6C24 7.6 21.2 6 18 6Z'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinejoin='round'
        opacity='0.85'
      />
      <path d='M12 16c2 1.5 4 2.2 6 2.2s4-.7 6-2.2' stroke='currentColor' strokeWidth='1' strokeLinecap='round' opacity='0.45' />
      <path d='M13 22h10' stroke='currentColor' strokeWidth='1' strokeLinecap='round' opacity='0.35' />
    </svg>
  )
}

function IconWrenchFlow({ className }: { className?: string }) {
  return (
    <svg className={className} width='28' height='28' viewBox='0 0 28 28' fill='none' aria-hidden>
      <path
        d='M8 20l10-10M14 8l4 4-3 3-4-4 3-3Z'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinejoin='round'
        opacity='0.85'
      />
      <path d='M6 22l3-3' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round' opacity='0.5' />
    </svg>
  )
}

function StepGlyph({ lane }: { lane: GenerationOverlayStep['lane'] }) {
  if (lane === 'lead') return <IconBrainMesh className='curio-gen-overlay__glyph' />
  if (lane === 'pulse') return <IconSparkOrbit className='curio-gen-overlay__glyph curio-gen-overlay__glyph--spin' />
  return <IconWrenchFlow className='curio-gen-overlay__glyph curio-gen-overlay__glyph--dim' />
}

export function CurioGenerationOverlay({
  open,
  headline,
  kicker,
  steps,
  onStop,
  stopLabel = 'Stop',
  stopEnabled = true,
  recoveryHint,
  fixed = false,
  home = false,
}: Props) {
  const visibleSteps = useMemo(() => steps.slice(-12), [steps])

  if (!open) return null

  return (
    <div
      className={`curio-gen-overlay${fixed ? ' curio-gen-overlay--fixed' : ''}${home ? ' curio-gen-overlay--home' : ''}`}
      role='dialog'
      aria-modal='true'
      aria-busy='true'
      aria-label={headline}
    >
      <div className='curio-gen-overlay__veil' />
      <div className='curio-gen-overlay__panel'>
        <div className='curio-gen-overlay__aurora' aria-hidden />
        <header className='curio-gen-overlay__head'>
          <div className='curio-gen-overlay__orb'>
            <IconSparkOrbit className='curio-gen-overlay__orb-icon' />
          </div>
          <div>
            <h2 className='curio-gen-overlay__title'>{headline}</h2>
            {kicker ? <p className='curio-gen-overlay__kicker'>{kicker}</p> : null}
          </div>
        </header>

        <ul className='curio-gen-overlay__timeline'>
          {visibleSteps.length === 0 ? (
            <li className='curio-gen-overlay__row curio-gen-overlay__row--empty'>
              <span className='curio-gen-overlay__shimmer'>Waking up agents…</span>
            </li>
          ) : (
            visibleSteps.map((step, i) => {
              const isLatest = i === visibleSteps.length - 1
              return (
                <li
                  key={step.id}
                  className={`curio-gen-overlay__row curio-gen-overlay__row--${step.lane}${isLatest ? ' curio-gen-overlay__row--latest' : ''}`}
                >
                  <div className='curio-gen-overlay__row-icon'>
                    <StepGlyph lane={step.lane} />
                  </div>
                  <div className='curio-gen-overlay__row-text'>
                    <span className='curio-gen-overlay__row-title'>{step.title}</span>
                    {step.detail ? <span className='curio-gen-overlay__row-detail'>{step.detail}</span> : null}
                  </div>
                </li>
              )
            })
          )}
        </ul>

        <footer className='curio-gen-overlay__foot'>
          <button
            type='button'
            className='curio-gen-overlay__stop'
            onClick={onStop}
            disabled={!stopEnabled}
          >
            <span className='curio-gen-overlay__stop-icon' aria-hidden>
              <svg width='18' height='18' viewBox='0 0 24 24' fill='currentColor'>
                <rect x='6' y='6' width='12' height='12' rx='2' />
              </svg>
            </span>
            {stopLabel}
          </button>
          <p className='curio-gen-overlay__hint'>
            {recoveryHint ?? 'Stopping discards this run and restores your map as it was.'}
          </p>
        </footer>
      </div>
    </div>
  )
}
