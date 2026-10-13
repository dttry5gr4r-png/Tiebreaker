import { useEffect, useState } from 'react'

let tok: string | null = localStorage.getItem('tb_tok')
const subs = new Set<() => void>()
const save = (t: string | null) => { tok = t; t ? localStorage.setItem('tb_tok', t) : localStorage.removeItem('tb_tok'); subs.forEach(f => f()) }
const NAME = /^[a-z0-9_.]{3,20}$/i

export const login = (username: string, password: string) => api('login', { username, password })
export async function signup(username: string, password: string) {
  if (!NAME.test(username.trim())) throw new Error('Username: 3-20 letters, numbers, _ or .')
  return api('signup', { username: username.trim(), password })
}
export const recover = (username: string, code: string, password: string) => api('recover', { username, code, password })
export const logout = () => save(null)
export const getUid = (): string => JSON.parse(atob(tok!.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'))).sub
export const useAuth = () => {
  const [on, set] = useState(!!tok)
  useEffect(() => { const f = () => set(!!tok); subs.add(f); return () => void subs.delete(f) }, [])
  return on
}
export const useCode = () => {
  const [c, set] = useState(sessionStorage.getItem('tb_code'))
  useEffect(() => { const f = () => set(sessionStorage.getItem('tb_code')); window.addEventListener('tb:code', f); return () => window.removeEventListener('tb:code', f) }, [])
  return [c, () => { sessionStorage.removeItem('tb_code'); window.dispatchEvent(new Event('tb:code')) }] as const
}

const READS = ['me', 'home', 'group', 'poll']
export async function api(action: string, body: any = {}) {
  const r = await fetch(`/api/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (r.status === 401 && tok) logout()
  if (!r.ok) throw new Error(j.error || 'Request failed')
  if (j.recoveryCode) { sessionStorage.setItem('tb_code', j.recoveryCode); window.dispatchEvent(new Event('tb:code')) }
  if (j.token) save(j.token)
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
