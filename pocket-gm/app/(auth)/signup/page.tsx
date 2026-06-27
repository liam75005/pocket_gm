'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
    })
    if (error) { setError(error.message); setLoading(false); return }
    setConfirming(true)
    setLoading(false)
  }

  async function handleGoogle() {
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` },
    })
    if (error) { setError(error.message); setLoading(false) }
  }

  if (confirming) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f0d09', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: "'Crimson Pro', serif", color: '#f0ead8' }}>
        <div style={{ textAlign: 'center', maxWidth: '380px' }}>
          <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '22px', color: '#c9952a', marginBottom: '16px' }}>Pocket GM</div>
          <div style={{ background: '#1a1610', border: '1px solid #2a6b3a', padding: '24px' }}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '2px', color: '#3d9954', textTransform: 'uppercase', marginBottom: '12px' }}>Compte créé</div>
            <p style={{ fontSize: '14px', color: '#b8a878', lineHeight: '1.6' }}>
              Un email de confirmation a été envoyé à <strong style={{ color: '#f0ead8' }}>{email}</strong>. Cliquez sur le lien pour activer votre compte.
            </p>
          </div>
          <div style={{ marginTop: '16px', fontSize: '13px', color: '#7a6840' }}>
            <Link href="/login" style={{ color: '#c9952a', textDecoration: 'none' }}>Retour à la connexion</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0d09', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: "'Crimson Pro', serif", color: '#f0ead8' }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontFamily: "'Cinzel Decorative', cursive", fontSize: '22px', color: '#c9952a', marginBottom: '6px' }}>Pocket GM</div>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '9px', letterSpacing: '3px', color: '#7a6840', textTransform: 'uppercase' }}>D&amp;D 2024 · Maître du Jeu solo IA</div>
        </div>

        <form onSubmit={handleSignup} style={{ background: '#1a1610', border: '1px solid #3a3020', padding: '24px' }}>
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '2px', color: '#b8a878', textTransform: 'uppercase', textAlign: 'center', marginBottom: '20px' }}>
            Créer un compte
          </div>

          <div style={{ marginBottom: '12px' }}>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              required
              style={{ width: '100%', fontFamily: "'Crimson Pro', serif", fontSize: '14px', padding: '10px 12px', background: '#241f17', border: '1px solid #3a3020', color: '#f0ead8', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: '18px' }}>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Mot de passe (8 caractères min.)"
              required
              minLength={8}
              style={{ width: '100%', fontFamily: "'Crimson Pro', serif", fontSize: '14px', padding: '10px 12px', background: '#241f17', border: '1px solid #3a3020', color: '#f0ead8', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {error && (
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: '10px', color: '#c8392b', textAlign: 'center', marginBottom: '12px' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{ width: '100%', fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', padding: '13px', background: '#2a6b3a', border: '2px solid #3d9954', color: '#fff', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Création...' : 'Créer mon compte'}
          </button>

          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            style={{ width: '100%', marginTop: '10px', fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', padding: '13px', background: 'transparent', border: '1px solid #3a3020', color: '#b8a878', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            Continuer avec Google
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '13px', color: '#7a6840' }}>
          Déjà un compte ?{' '}
          <Link href="/login" style={{ color: '#c9952a', textDecoration: 'none' }}>
            Se connecter
          </Link>
        </div>
      </div>
    </div>
  )
}
