import { Link } from 'react-router-dom'

export function LandingPage() {
  return (
    <main className='landing'>
      <section className='landing-card'>
        <p className='eyebrow'>Curio</p>
        <h1>Research better, map faster.</h1>
        <p>
          Landing page scaffold is ready. Auth, onboarding, and backend wiring come next.
        </p>
        <div className='landing-actions'>
          <button type='button'>Get started</button>
          <Link to='/'>See signed-in home</Link>
        </div>
      </section>
    </main>
  )
}
