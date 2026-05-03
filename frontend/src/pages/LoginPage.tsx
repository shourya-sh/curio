import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // No navigate — PublicOnlyRoute auto-redirects once onAuthStateChange fires
  }

  return (
    <main className='auth-page'>
      <div className='auth-card'>
        <div className='auth-brand'>
          <span className='landing-brand-mark'>C</span>
          <span>Curio</span>
        </div>
        <h1>Welcome back</h1>
        <p className='auth-subtitle'>Sign in to continue to your mind maps.</p>

        <form onSubmit={handleSubmit} className='auth-form'>
          {error && <div className='auth-error'>{error}</div>}
          <input
            type='email'
            placeholder='Email'
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
          <input
            type='password'
            placeholder='Password'
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type='submit' disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className='auth-switch'>
          Don't have an account? <Link to='/signup'>Create one</Link>
        </p>
      </div>
    </main>
  )
}
