import type { Handler } from '@netlify/functions'
import { connectLambda, getStore } from '@netlify/blobs'
import { randomUUID as uid4, randomBytes, createHash, createHmac, scryptSync, timingSafeEqual } from 'node:crypto'
import { irv, tally, pickNext } from './logic'

class Err extends Error { constructor(m: string, public code = 400) { super(m) } }
const must = (c: any, m: string, code = 400) => { if (!c) throw new Err(m, code) }
const clean = (a: any): string[] => [...new Set((Array.isArray(a) ? a : []).map((s: any) => String(s).trim()).filter(Boolean))].slice(0, 50) as string[]
// Recovery code: 80 random bits, shown once, stored only as a hash. Single use (rotated after a reset).
const newCode = () => randomBytes(10).toString('hex').toUpperCase().match(/.{5}/g)!.join('-')
const hash = (c: string) => createHash('sha256').update(String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex')
// Built-in auth: scrypt password hashes + HMAC-signed session tokens. The signing key is generated once and kept in Blobs.
const hashPw = (p: string) => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(p, salt, 32).toString('hex')}` }
const checkPw = (p: string, st: string) => { const [salt, h] = String(st || ':').split(':'); const a = Buffer.from(h, 'hex'), b = scryptSync(p, salt, 32); return a.length === b.length && timingSafeEqual(a, b) }
let KEY = ''
async function key() {
  if (!KEY) {
    let k = await get('secret:auth')
    if (!k) { await S.setJSON('secret:auth', { k: randomBytes(32).toString('hex') }, { onlyIfNew: true }); k = await get('secret:auth') }
    KEY = k.k
  }
  return KEY
}
const mac = async (p: string) => createHmac('sha256', await key()).update(p).digest('base64url')
async function sign(sub: string) { const p = Buffer.from(JSON.stringify({ sub, exp: Date.now() + 30 * 864e5 })).toString('base64url'); return `${p}.${await mac(p)}` }
async function verify(t: string) {
  const [p, m] = String(t).split('.'); if (!p || !m) return ''
  const ok = await mac(p); if (ok.length !== m.length || !timingSafeEqual(Buffer.from(ok), Buffer.from(m))) return ''
  const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.exp > Date.now() ? (d.sub as string) : ''
}
let S: ReturnType<typeof getStore>
const get = (k: string) => S.get(k, { type: 'json' }) as Promise<any>

// Optimistic concurrency: Blobs has no transactions, so retry on etag mismatch.
async function mutate(k: string, fn: (cur: any) => any, init?: any) {
  for (let i = 0; i < 6; i++) {
    const r = await S.getWithMetadata(k, { type: 'json' })
    const next = fn(r ? structuredClone(r.data) : init)
    const w = await S.setJSON(k, next, r ? { onlyIfMatch: r.etag } : { onlyIfNew: true })
    if (w.modified) return next
  }
  throw new Err('Busy, try again', 409)
}
async function groupFor(gid: string, uid: string) {
  const g = await get(`group:${gid}`)
  must(g && g.members.includes(uid), 'Not a member of this group', 403)
  return g
}
const log = (g: any, text: string) => { g.activity = [...g.activity, { text, at: Date.now() }].slice(-30) }
const result = (mode: string, all: string[][], o: string[]) => (mode === 'ranked' ? irv(all, o) : tally(all, o))
const view = (p: any, uid: string) => { const { ballots, ...rest } = p; return { ...rest, voted: Object.keys(ballots), myBallot: ballots[uid] } }

const actions: Record<string, (uid: string, b: any, ctx?: any) => Promise<any>> = {
  async me(uid) { const u = await get(`user:${uid}`); if (u) for (const f of ['pw', 'recovery', 'fails', 'lockUntil']) delete u[f]; return { me: u || null } },
  async signup(_u, { username, password }) {
    const name = String(username || '').trim(), k = name.toLowerCase(), pw = String(password || '')
    must(/^[a-z0-9_.]{3,20}$/i.test(name), 'Username: 3-20 letters, numbers, _ or .')
    must(pw.length >= 6 && pw.length <= 200, 'Password needs 6+ characters')
    const uid = uid4()
    must((await S.setJSON(`uname:${k}`, { uid, username: name }, { onlyIfNew: true })).modified, 'Username already taken')
    const code = newCode()
    await S.setJSON(`user:${uid}`, { uid, username: name, groups: [], pw: hashPw(pw), recovery: hash(code) })
    return { token: await sign(uid), recoveryCode: code }
  },
  async login(_u, { username, password }) {
    const t = await get(`uname:${String(username || '').trim().toLowerCase()}`)
    const u = t && (await get(`user:${t.uid}`))
    must(!u?.lockUntil || u.lockUntil < Date.now(), 'Too many tries. Wait a minute.', 429)
    if (!u || !checkPw(String(password || ''), u.pw)) {
      if (u) await mutate(`user:${t.uid}`, x => { x.fails = (x.fails || 0) + 1; if (x.fails >= 5) { x.fails = 0; x.lockUntil = Date.now() + 60000 } return x })
      throw new Err('Wrong username or password', 403)
    }
    if (u.fails) await mutate(`user:${t.uid}`, x => ({ ...x, fails: 0 }))
    return { token: await sign(t.uid) }
  },
  async newRecoveryCode(uid) {
    const code = newCode()
    await mutate(`user:${uid}`, u => ({ ...u, recovery: hash(code) }))
    return { recoveryCode: code }
  },
  async recover(_u, { username, code, password }) {
    const t = await get(`uname:${String(username || '').trim().toLowerCase()}`)
    const u = t && (await get(`user:${t.uid}`))
    const a = Buffer.from(u?.recovery || ''), b = Buffer.from(hash(code || ''))
    must(u?.recovery && a.length === b.length && timingSafeEqual(a, b), 'Username or recovery code is wrong', 403)
    const pw = String(password || ''); must(pw.length >= 6 && pw.length <= 200, 'Password needs 6+ characters')
    const rc = newCode()
    await mutate(`user:${t.uid}`, x => ({ ...x, pw: hashPw(pw), recovery: hash(rc), fails: 0, lockUntil: 0 }))
    return { token: await sign(t.uid), recoveryCode: rc }
  },
  async searchUsers(_uid, { q }) {
    const k = String(q || '').toLowerCase().replace(/^@/, '')
    if (k.length < 2) return { users: [] }
    const { blobs } = await S.list({ prefix: `uname:${k}` })
    return { users: (await Promise.all(blobs.slice(0, 8).map(b => get(b.key)))).map(x => x.username) }
  },
  async home(uid) {
    const me = await get(`user:${uid}`); must(me, 'Pick a username first')
    return { groups: await Promise.all(me.groups.map((g: string) => get(`group:${g}`))), invites: (await get(`inbox:${uid}`)) || [] }
  },
  async createGroup(uid, { name, description }) {
    must(String(name || '').trim(), 'Name required')
    const me = await get(`user:${uid}`); must(me, 'Pick a username first')
    const id = uid4()
    await S.setJSON(`group:${id}`, {
      id, name: String(name).trim(), description: String(description || ''), admins: [uid], members: [uid],
      memberNames: { [uid]: me.username }, activity: [], presets: [], pollIds: []
    })
    await mutate(`user:${uid}`, u => ({ ...u, groups: [...u.groups, id] }))
    return { id }
  },
  async group(uid, { groupId }) {
    const g = await groupFor(groupId, uid)
    const polls = (await Promise.all(g.pollIds.map((p: string) => get(`poll:${p}`)))).map((p: any) => ({ id: p.id, title: p.title, mode: p.mode, status: p.status, result: p.result && { winner: p.result.winner } }))
    return { g, polls }
  },
  async invite(uid, { groupId, username }) {
    const g = await groupFor(groupId, uid)
    const t = await get(`uname:${String(username).toLowerCase().replace(/^@/, '')}`)
    must(t, 'No user with that username'); must(!g.members.includes(t.uid), 'Already a member')
    await mutate(`inbox:${t.uid}`, box => (box.some((i: any) => i.groupId === groupId) ? box
      : [...box, { id: uid4(), groupId, groupName: g.name, fromUsername: g.memberNames[uid] }]), [])
    return { ok: true }
  },
  async respondInvite(uid, { inviteId, accept }) {
    let inv: any
    await mutate(`inbox:${uid}`, box => { inv = box.find((i: any) => i.id === inviteId); must(inv, 'Invite not found', 404); return box.filter((i: any) => i.id !== inviteId) }, [])
    if (accept) {
      const me = await get(`user:${uid}`)
      await mutate(`group:${inv.groupId}`, g => { if (!g.members.includes(uid)) { g.members.push(uid); g.memberNames[uid] = me.username; log(g, `@${me.username} joined`) } return g })
      await mutate(`user:${uid}`, u => ({ ...u, groups: [...new Set([...u.groups, inv.groupId])] }))
    }
    return { ok: true }
  },
  async createPreset(uid, { groupId, name, options }) {
    const opts = clean(options); must(opts.length >= 2 && String(name).trim(), 'Need a name and 2+ options')
    await groupFor(groupId, uid)
    await mutate(`group:${groupId}`, g => { must(g.admins.includes(uid), 'Admins only', 403); g.presets.push({ id: uid4(), name: String(name).trim(), options: opts }); return g })
    return { ok: true }
  },
  async createPoll(uid, { groupId, title, mode, options, maxVotes }) {
    const g0 = await groupFor(groupId, uid)
    must(['single', 'multiple', 'ranked', 'elimination'].includes(mode), 'Bad mode')
    const opts = clean(options); must(opts.length >= 2 && String(title).trim(), 'Need a title and 2+ options')
    const id = uid4()
    const poll: any = {
      id, groupId, title: String(title).trim(), mode, options: opts, status: 'open', ballots: {}, result: null, createdBy: uid, memberCount: g0.members.length,
      maxVotes: mode === 'single' ? 1 : mode === 'multiple' ? Math.max(1, Math.min(+maxVotes || 2, opts.length)) : opts.length
    }
    if (mode === 'elimination') { const n = pickNext(g0.members, []); poll.elim = { active: opts, turn: n.next, turned: n.turned, log: [] } }
    await S.setJSON(`poll:${id}`, poll)
    await mutate(`group:${groupId}`, g => { g.pollIds.unshift(id); log(g, `@${g.memberNames[uid]} started "${poll.title}"`); return g })
    return { id }
  },
  async poll(uid, { groupId, pollId }) {
    const g = await groupFor(groupId, uid), p = await get(`poll:${pollId}`)
    must(p && p.groupId === groupId, 'Poll not found', 404)
    return { p: view(p, uid), g }
  },
  async vote(uid, { groupId, pollId, choices }) {
    await groupFor(groupId, uid)
    await mutate(`poll:${pollId}`, p => {
      must(p.groupId === groupId && p.status === 'open' && p.mode !== 'elimination', 'Poll is closed')
      const c = clean(choices)
      must(c.length >= 1 && c.length <= p.maxVotes && c.every(x => p.options.includes(x)), 'Invalid ballot')
      p.ballots[uid] = c
      if (Object.keys(p.ballots).length >= p.memberCount) { p.status = 'closed'; p.result = result(p.mode, Object.values(p.ballots) as string[][], p.options) }
      return p
    })
    return { ok: true }
  },
  async closePoll(uid, { groupId, pollId }) {
    const g = await groupFor(groupId, uid)
    await mutate(`poll:${pollId}`, p => {
      must(p.groupId === groupId && (g.admins.includes(uid) || p.createdBy === uid), 'Not allowed', 403)
      must(p.status === 'open' && p.mode !== 'elimination' && Object.keys(p.ballots).length, 'Cannot close yet')
      p.status = 'closed'; p.result = result(p.mode, Object.values(p.ballots) as string[][], p.options)
      return p
    })
    return { ok: true }
  },
  async eliminate(uid, { groupId, pollId, option }) {
    const g = await groupFor(groupId, uid)
    await mutate(`poll:${pollId}`, p => {
      must(p.groupId === groupId && p.mode === 'elimination' && p.status === 'open', 'Not an open elimination')
      must(p.elim.turn === uid, "It's not your turn", 403)
      must(p.elim.active.includes(option), 'Option already gone')
      p.elim.active = p.elim.active.filter((o: string) => o !== option)
      p.elim.log.push({ uid, name: g.memberNames[uid], option })
      if (p.elim.active.length === 1) { p.status = 'closed'; p.elim.turn = null; p.result = { winner: p.elim.active[0] } }
      else { const n = pickNext(g.members, p.elim.turned, uid); p.elim.turn = n.next; p.elim.turned = n.turned }
      return p
    })
    return { ok: true }
  }
}

export const handler: Handler = async e => {
  try {
    connectLambda(e as any)
    S = getStore({ name: 'tiebreaker', consistency: 'strong' })
    must(e.httpMethod === 'POST', 'POST only', 405)
    const name = e.path.split('/').pop()!, fn = actions[name]; must(fn, 'Unknown action', 404)
    let uid = ''
    if (!['signup', 'login', 'recover'].includes(name)) { uid = await verify((e.headers.authorization || '').replace('Bearer ', '')); must(uid, 'Unauthorized', 401) }
    return { statusCode: 200, body: JSON.stringify(await fn(uid, JSON.parse(e.body || '{}'))) }
  } catch (err: any) {
    return { statusCode: err.code || 500, body: JSON.stringify({ error: err.code ? err.message : 'Server error' }) }
  }
}
