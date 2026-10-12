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
export const login = (email: string, password: string) => token({ grant_type: 'password', username: email, password })
export async function signup(email: string, password: string) {
  const r = await fetch(`${ID}/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.msg || 'Sign up failed')
  await login(email, password)
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
