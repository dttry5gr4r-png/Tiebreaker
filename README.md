# Tiebreaker (Netlify only)

React + Tailwind frontend, Netlify Functions (TypeScript) API, **Netlify Identity** for auth, **Netlify Blobs** for data. No other services or env vars.

## Deploy
1. Push to GitHub and import the repo in Netlify (settings come from `netlify.toml`).
2. Site configuration > Identity > **Enable Identity**, set registration to Open, and turn on **Auto-confirm** (otherwise sign-ups wait on an email confirmation).
3. Deploy. Test with `netlify dev` after `netlify link`; Identity needs a linked site.

## Notes
- Live updates: clients poll every 2.5s and refresh right after any action. Blobs has no push channel, so this stands in for realtime.
- Blobs has no transactions; `mutate()` in `api.ts` retries on etag mismatch, so simultaneous votes and eliminations stay consistent.
- Netlify has deprecated Identity for new features. It still works, but plan a swap if you grow.
- `netlify/functions/logic.ts`: instant-runoff and fair-turn picker. `src/App.tsx`: all screens.
