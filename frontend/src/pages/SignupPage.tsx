import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.signUp({ email, password })

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
        <h1>Create your account</h1>
        <p className='auth-subtitle'>Start building mind maps with Curio.</p>

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
          <input
            type='password'
            placeholder='Confirm password'
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          <button type='submit' disabled={loading}>
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className='auth-switch'>
          Already have an account? <Link to='/login'>Sign in</Link>
        </p>
      </div>
    </main>
  )
}
