import { useEffect, useState } from 'react'

// Netlify Identity (GoTrue) over plain fetch, so no extra client dependency.
const ID = '/.netlify/identity'
type Tok = { access_token: string; refresh_token: string; expires_at: number }
let tok: Tok | null = JSON.parse(localStorage.getItem('tb_tok') || 'null')
const subs = new Set<() => void>()
const save = (t: Tok | null) => { tok = t; t ? localStorage.setItem('tb_tok', JSON.stringify(t)) : localStorage.removeItem('tb_tok'); subs.forEach(f => f()) }

async function token(body: Record<string, string>) {
  const r = await fetch(`${ID}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error_description || j.msg || 'Login failed')
  save({ ...j, expires_at: Date.now() + j.expires_in * 1000 - 30000 })
}
// Identity requires an email, so the username is mapped to a private placeholder address. Users never see it.
const em = (u: string) => `${u.trim().toLowerCase()}@users.tiebreaker.app`
const NAME = /^[a-z0-9_.]{3,20}$/i
export const login = (username: string, password: string) => token({ grant_type: 'password', username: em(username), password })
export async function signup(username: string, password: string) {
  if (!NAME.test(username.trim())) throw new Error('Username: 3-20 letters, numbers, _ or .')
  const r = await fetch(`${ID}/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em(username), password }) })
  const j = await r.json()
  if (!r.ok) throw new Error(/already/i.test(j.msg || '') ? 'Username already taken' : j.msg || 'Sign up failed')
  await login(username, password)
  await api('setUsername', { username: username.trim() })
}
export async function recover(username: string, code: string, password: string) {
  await api('recover', { username, code, password })
  await login(username, password)
}
export const useCode = () => {
  const [c, set] = useState(sessionStorage.getItem('tb_code'))
  useEffect(() => { const f = () => set(sessionStorage.getItem('tb_code')); window.addEventListener('tb:code', f); return () => window.removeEventListener('tb:code', f) }, [])
  return [c, () => { sessionStorage.removeItem('tb_code'); window.dispatchEvent(new Event('tb:code')) }] as const
}
export const logout = () => save(null)
export const getUid = (): string => JSON.parse(atob(tok!.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub
export const useAuth = () => {
  const [on, set] = useState(!!tok)
  useEffect(() => { const f = () => set(!!tok); subs.add(f); return () => void subs.delete(f) }, [])
  return on
}

const READS = ['me', 'home', 'group', 'poll']
export async function api(action: string, body: any = {}) {
  if (tok && tok.expires_at < Date.now()) await token({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }).catch(logout)
  const r = await fetch(`/api/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${tok?.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (r.status === 401) logout()
  if (!r.ok) throw new Error(j.error || 'Request failed')
  if (j.recoveryCode) { sessionStorage.setItem('tb_code', j.recoveryCode); window.dispatchEvent(new Event('tb:code')) }
  if (!READS.includes(action)) window.dispatchEvent(new Event('tb:refresh'))
  return j
}

// Live updates: poll every 2.5s (paused when the tab is hidden) and refresh right after any write.
export function useApi<T = any>(action: string, body: any, deps: any[], enabled = true): T | undefined {
  const [v, setV] = useState<T>()
  useEffect(() => {
    if (!enabled) return
    let live = true
    const tick = () => api(action, body).then(r => live && setV(r)).catch(() => {})
    tick()
    const t = setInterval(() => !document.hidden && tick(), 2500)
    window.addEventListener('tb:refresh', tick)
    return () => { live = false; clearInterval(t); window.removeEventListener('tb:refresh', tick) }
  }, [...deps, enabled])
  return v
}
