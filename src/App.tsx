import { useState } from 'react'
import { api, useApi, useAuth, useCode, getUid, login, signup, recover, logout } from './api'

const lines = (t: string) => t.split('\n').map(x => x.trim()).filter(Boolean)

function useAct() {
  const [err, setErr] = useState('')
  const run = async (action: string, body?: any) => {
    setErr('')
    try { return await api(action, body) } catch (e: any) { setErr(e.message) }
  }
  return { err, run }
}
const Err = ({ m }: { m: string }) => (m ? <p role="alert" className="text-tb-red font-bold text-sm mt-2">{m}</p> : null)

export default function App() {
  const user = useAuth()
  const [code, clearCode] = useCode()
  const meR = useApi<{ me: any }>('me', {}, [user], user)
  const me = meR?.me
  const [route, setRoute] = useState<{ g?: string; p?: string }>({})
  return (
    <div className="mx-auto min-h-screen max-w-md bg-cream p-5 pb-16">
      {!user ? <Auth /> : code ? <Code code={code} done={clearCode} /> : !me ? null : route.p ? <Poll gid={route.g!} pid={route.p} uid={getUid()} back={() => setRoute({ g: route.g })} />
        : route.g ? <Group gid={route.g} me={me} uid={getUid()} open={p => setRoute({ g: route.g, p })} back={() => setRoute({})} />
        : <Home me={me} uid={getUid()} open={g => setRoute({ g })} />}
    </div>
  )
}

function Auth() {
  const [name, setN] = useState(''), [pw, setP] = useState(''), [rc, setRc] = useState(''), [mode, setM] = useState<'in' | 'up' | 'reset'>('in'), [err, setErr] = useState('')
  const go = async () => {
    setErr('')
    try { await (mode === 'in' ? login(name, pw) : mode === 'up' ? signup(name, pw) : recover(name, rc, pw)) } catch (e: any) { setErr(e.message) }
  }
  const sw = (m: 'in' | 'up' | 'reset', t: string) => <button className="block underline text-sm" onClick={() => { setM(m); setErr('') }}>{t}</button>
  return (
    <div className="pt-16 space-y-3">
      <h1 className="text-5xl font-extrabold">Tiebreaker</h1>
      <p className="text-stone-600">{mode === 'reset' ? 'Reset your password with your recovery code.' : 'Settle it with your group. Fairly.'}</p>
      <input className="inp" placeholder="Username" autoComplete="username" autoCapitalize="none" value={name} onChange={e => setN(e.target.value.replace('@', ''))} />
      {mode === 'reset' && <input className="inp" placeholder="Recovery code (XXXXX-XXXXX-XXXXX-XXXXX)" autoCapitalize="characters" value={rc} onChange={e => setRc(e.target.value)} />}
      <input className="inp" type="password" placeholder={mode === 'reset' ? 'New password (6+ characters)' : 'Password (6+ characters)'} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={pw} onChange={e => setP(e.target.value)} />
      <button className="btn btn-p w-full" onClick={go}>{mode === 'in' ? 'Log in' : mode === 'up' ? 'Create account' : 'Reset password'}</button>
      {mode !== 'in' && sw('in', 'Back to log in')}
      {mode === 'in' && sw('up', 'New here? Sign up')}
      {mode === 'in' && sw('reset', 'Forgot password?')}
      <Err m={err} />
    </div>
  )
}

function Code({ code, done }: { code: string; done: () => void }) {
  return (
    <div className="pt-16 space-y-3">
      <h1 className="text-3xl font-extrabold">Save your recovery code</h1>
      <p className="text-stone-600">This is the only way to reset your password. It is shown once. Store it somewhere safe.</p>
      <div className="card select-all text-center text-xl font-extrabold tracking-wider">{code}</div>
      <button className="btn w-full" onClick={() => navigator.clipboard?.writeText(code)}>Copy code</button>
      <button className="btn btn-p w-full" onClick={done}>I've saved it</button>
    </div>
  )
}

function Home({ me, uid, open }: { me: any; uid: string; open: (g: string) => void }) {
  const h = useApi<any>('home', {}, []), groups: any[] = h?.groups || [], invites: any[] = h?.invites || []
  const [name, setName] = useState(''), { err, run } = useAct()
  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold">Hey, @{me.username}</h1>
        <div className="flex gap-2">
          <button className="btn" onClick={() => window.confirm('This replaces your old recovery code. Continue?') && api('newRecoveryCode').catch(() => {})}>New recovery code</button>
          <button className="btn" onClick={() => logout()}>Log out</button>
        </div>
      </header>
      {invites.length > 0 && <section className="space-y-2"><h2 className="text-xl font-extrabold">Pending invites</h2>
        {invites.map(i => (
          <div key={i.id} className="card">
            <b>{i.groupName}</b><div className="text-sm text-stone-500">Invited by @{i.fromUsername}</div>
            <div className="mt-2 flex gap-2">
              <button className="btn btn-p flex-1" onClick={() => run('respondInvite', { inviteId: i.id, accept: true })}>Accept</button>
              <button className="btn flex-1" onClick={() => run('respondInvite', { inviteId: i.id, accept: false })}>Decline</button>
            </div>
          </div>))}
      </section>}
      <section className="space-y-2"><h2 className="text-xl font-extrabold">Your groups</h2>
        {groups.length === 0 && <p className="text-stone-600">No groups yet. Create one to get started.</p>}
        {groups.map(g => (
          <button key={g.id} className="card w-full text-left" onClick={() => open(g.id)}>
            <b>{g.name}</b><div className="text-sm text-stone-500">{g.members.length} members</div>
          </button>))}
        <input className="inp" placeholder="New group name" value={name} onChange={e => setName(e.target.value)} />
        <button className="btn btn-p w-full" onClick={async () => { const r = await run('createGroup', { name }); if (r) { setName(''); open(r.id) } }}>+ Create new group</button>
        <Err m={err} />
      </section>
    </div>
  )
}

const MODES: Record<string, string> = { single: 'Single choice', multiple: 'Multiple choice', ranked: 'Ranked choice', elimination: 'Elimination' }

function Group({ gid, uid, open, back }: { gid: string; me: any; uid: string; open: (p: string) => void; back: () => void }) {
  const gr = useApi<any>('group', { groupId: gid }, [gid]), g = gr?.g
  const presets: any[] = g?.presets || []
  const polls: any[] = gr?.polls || []
  const [inv, setInv] = useState(''), [pn, setPn] = useState(''), [po, setPo] = useState('')
  const [title, setTitle] = useState(''), [mode, setMode] = useState('single'), [opts, setOpts] = useState(''), [max, setMax] = useState(2)
  const { err, run } = useAct()
  if (!g) return null
  const admin = g.admins.includes(uid)
  return (
    <div className="space-y-5">
      <button className="btn" onClick={back} aria-label="Back">←</button>
      <h1 className="text-3xl font-extrabold">{g.name} {admin && <span className="align-middle rounded-full border-2 border-ink bg-tb-orange px-2 py-0.5 text-xs">Admin</span>}</h1>
      <section><h2 className="text-xl font-extrabold">Members</h2>
        <p className="text-sm text-stone-600">{Object.values<string>(g.memberNames).map(n => '@' + n).join(', ')}</p></section>
      <div className="card space-y-2"><b>Invite a friend</b>
        <div className="flex gap-2"><input className="inp" placeholder="@username" value={inv} onChange={e => setInv(e.target.value)} />
          <button className="btn" onClick={async () => { if (await run('invite', { groupId: gid, username: inv })) setInv('') }}>Send invite</button></div></div>
      <section className="card space-y-2"><b>Start a new poll</b>
        <input className="inp" placeholder="Question, e.g. Where should we eat?" value={title} onChange={e => setTitle(e.target.value)} />
        <select className="inp" value={mode} onChange={e => setMode(e.target.value)}>{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        {mode === 'multiple' && <label className="block text-sm">Votes per person <input className="inp" type="number" min={1} value={max} onChange={e => setMax(+e.target.value)} /></label>}
        {presets.length > 0 && <select className="inp" defaultValue="" onChange={e => setOpts(presets.find(p => p.id === e.target.value)?.options.join('\n') || opts)}>
          <option value="">Load a preset…</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <textarea className="inp" rows={4} placeholder="One option per line" value={opts} onChange={e => setOpts(e.target.value)} />
        <button className="btn btn-p w-full" onClick={async () => { const r = await run('createPoll', { groupId: gid, title, mode, options: lines(opts), maxVotes: max }); if (r) { setTitle(''); open(r.id) } }}>Launch poll</button>
      </section>
      <section className="space-y-2"><h2 className="text-xl font-extrabold">Polls</h2>
        {polls.length === 0 && <p className="text-stone-600">No polls yet. Launch one above.</p>}
        {polls.map(p => (
          <button key={p.id} className="card w-full text-left" onClick={() => open(p.id)}>
            <b>{p.title}</b><div className="text-sm text-stone-500">{MODES[p.mode]} · {p.status === 'open' ? 'Live now' : `Winner: ${p.result?.winner}`}</div>
          </button>))}
      </section>
      {admin && <section className="card space-y-2"><b>Save a preset</b>
        <input className="inp" placeholder="Preset name" value={pn} onChange={e => setPn(e.target.value)} />
        <textarea className="inp" rows={3} placeholder="One option per line" value={po} onChange={e => setPo(e.target.value)} />
        <button className="btn w-full" onClick={async () => { if (await run('createPreset', { groupId: gid, name: pn, options: lines(po) })) { setPn(''); setPo('') } }}>Save preset</button></section>}
      <section><h2 className="text-xl font-extrabold">Activity</h2>
        <ul className="text-sm text-stone-600">{[...g.activity].reverse().slice(0, 8).map((a: any, i: number) => <li key={i}>{a.text}</li>)}</ul></section>
      <Err m={err} />
    </div>
  )
}

function Poll({ gid, pid, uid, back }: { gid: string; pid: string; uid: string; back: () => void }) {
  const pr = useApi<any>('poll', { groupId: gid, pollId: pid }, [pid]), p = pr?.p, g = pr?.g
  const [sel, setSel] = useState<string[]>([]), { err, run } = useAct()
  if (!p || !g) return null
  const voted = !!p.myBallot, open = p.status === 'open'
  const toggle = (o: string) => setSel(s => (s.includes(o) ? s.filter(x => x !== o) : p.mode === 'single' ? [o] : s.length < p.maxVotes ? [...s, o] : s))
  const move = (i: number, d: number) => setSel(s => { const a = [...s]; [a[i], a[i + d]] = [a[i + d], a[i]]; return a })
  const submit = () => run('vote', { groupId: gid, pollId: pid, choices: sel })
  return (
    <div className="space-y-4">
      <button className="btn" onClick={back} aria-label="Back">←</button>
      <h1 className="text-3xl font-extrabold">{p.title}</h1>
      <p className="text-sm text-stone-600">{MODES[p.mode]}{p.mode !== 'elimination' && ` · ${p.voted.length} of ${p.memberCount} voted`}</p>

      {!open && <div className="card bg-tb-purple text-white"><div className="text-sm">Winner</div><div className="text-3xl font-extrabold">{p.result.winner}</div></div>}
      {!open && p.result.counts && <ul className="card">{Object.entries<number>(p.result.counts).map(([o, n]) => <li key={o} className="flex justify-between"><span>{o}</span><b>{n}</b></li>)}</ul>}
      {!open && p.result.rounds && p.result.rounds.map((r: any, i: number) => (
        <div key={i} className="card text-sm"><b>Round {i + 1}</b> — {Object.entries<number>(r).map(([o, n]) => `${o}: ${n}`).join(', ')}</div>))}

      {open && p.mode !== 'elimination' && !voted && p.mode !== 'ranked' && <>
        <p className="text-sm">Pick {p.mode === 'single' ? '1' : `up to ${p.maxVotes}`}.</p>
        {p.options.map((o: string) => <button key={o} className={`card w-full text-left ${sel.includes(o) ? '!bg-tb-purple text-white' : ''}`} onClick={() => toggle(o)}>{o}</button>)}
        <button className="btn btn-p w-full" disabled={!sel.length} onClick={submit}>Submit vote</button></>}

      {open && p.mode === 'ranked' && !voted && <>
        <p className="text-sm">Tap options to rank them. 1 is your top pick.</p>
        {sel.map((o, i) => (
          <div key={o} className="card flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full border-2 border-ink bg-tb-purple font-extrabold text-white">{i + 1}</span>
            <span className="flex-1">{o}</span>
            <button className="btn !px-2 !py-0" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
            <button className="btn !px-2 !py-0" disabled={i === sel.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
            <button className="btn !px-2 !py-0" onClick={() => toggle(o)} aria-label="Remove">✕</button>
          </div>))}
        <div className="flex flex-wrap gap-2">{p.options.filter((o: string) => !sel.includes(o)).map((o: string) => <button key={o} className="btn" onClick={() => setSel([...sel, o])}>+ {o}</button>)}</div>
        <button className="btn btn-p w-full" disabled={!sel.length} onClick={submit}>Submit my ranking</button></>}

      {open && p.mode !== 'elimination' && voted && <p className="card">Vote in. Waiting on the rest of the group.</p>}
      {open && p.mode !== 'elimination' && (g.admins.includes(uid) || p.createdBy === uid) &&
        <button className="btn w-full" onClick={() => run('closePoll', { groupId: gid, pollId: pid })}>Close poll and count</button>}

      {p.mode === 'elimination' && <>
        {open && <div className="card bg-tb-red text-white">
          <div className="text-sm">Elimination spotlight</div>
          <div className="text-2xl font-extrabold">{p.elim.turn === uid ? 'Your turn: eliminate one' : `@${g.memberNames[p.elim.turn]} is picking`}</div></div>}
        {p.elim.active.map((o: string) => (
          <button key={o} className="card w-full text-left disabled:opacity-100" disabled={!open || p.elim.turn !== uid}
            onClick={() => run('eliminate', { groupId: gid, pollId: pid, option: o })}>{o}{open && p.elim.turn === uid && <span className="float-right text-tb-red font-extrabold">Eliminate</span>}</button>))}
        {p.elim.log.length > 0 && <ul className="text-sm text-stone-600">{p.elim.log.map((l: any, i: number) => <li key={i}>@{l.name} eliminated {l.option}</li>)}</ul>}</>}
      <Err m={err} />
    </div>
  )
}
