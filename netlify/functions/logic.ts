const rnd = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

export function tally(ballots: string[][], options: string[]) {
  const t: Record<string, number> = Object.fromEntries(options.map(o => [o, 0]))
  ballots.forEach(b => b.forEach(o => t[o]++))
  const max = Math.max(...Object.values(t))
  return { counts: t, winner: rnd(options.filter(o => t[o] === max)) }
}

// Instant-runoff: drop the lowest option(s) until someone holds a majority of live ballots.
export function irv(ballots: string[][], options: string[]) {
  let active = [...options]
  const rounds: Record<string, number>[] = []
  for (;;) {
    const t: Record<string, number> = Object.fromEntries(active.map(o => [o, 0]))
    let total = 0
    for (const b of ballots) { const c = b.find(o => active.includes(o)); if (c) { t[c]++; total++ } }
    rounds.push(t)
    const top = active.reduce((a, b) => (t[a] >= t[b] ? a : b))
    if (active.length === 1 || t[top] * 2 > total) return { winner: top, rounds }
    const min = Math.min(...active.map(o => t[o]))
    const losers = active.filter(o => t[o] === min)
    if (losers.length === active.length) return { winner: rnd(losers), rounds }
    active = active.filter(o => !losers.includes(o))
  }
}

// Fair turn: nobody repeats until every member has gone once. A new cycle avoids an instant repeat.
export function pickNext(members: string[], turned: string[], last?: string) {
  let done = turned.filter(m => members.includes(m))
  let pool = members.filter(m => !done.includes(m))
  if (!pool.length) {
    done = []
    pool = members.length > 1 ? members.filter(m => m !== last) : members
  }
  const next = rnd(pool)
  return { next, turned: [...done, next] }
}
