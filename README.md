# Tiebreaker (Netlify only)

React + Tailwind frontend, Netlify Functions (TypeScript) API, **Netlify Identity** for auth, **Netlify Blobs** for data. No other services or env vars.

## Deploy
1. Push to GitHub and import the repo in Netlify (settings come from `netlify.toml`).
2. Site configuration > Identity > **Enable Identity**, set registration to Open, and turn on **Auto-confirm** (otherwise sign-ups wait on an email confirmation).
3. Deploy, then test on the live Netlify URL. Identity does not work under `netlify dev`.

## Notes
- Live updates: clients poll every 2.5s and refresh right after any action. Blobs has no push channel, so this stands in for realtime.
- Blobs has no transactions; `mutate()` in `api.ts` retries on etag mismatch, so simultaneous votes and eliminations stay consistent.
- `netlify/functions/logic.ts`: instant-runoff and fair-turn picker. `src/App.tsx`: all screens.
- Sign-in is username + password only. Identity needs an email, so each username maps to a hidden placeholder address. Without email, password resets use a one-time **recovery code** shown at sign-up (stored hashed; regenerate it from Home). Resetting calls the Identity admin API from the function, so Identity must be enabled.
