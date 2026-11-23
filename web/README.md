# Rung web page

Next.js app deployed on Vercel from the `web/` directory of this repository.
One page (`app/page.tsx`):

- **Intro**: what Rung does, the terms, the modes table and the numbers with
  their sources. The text is in `lib/copy.ts`; the network, program id, APK link
  and test status are in `lib/status.ts` (edit that file when the state changes).
- **How to try**: the Android APK link once `STATUS.apkUrl` is set (until then
  "Android APK: not yet."), and links to the repository README.
- **Counter**: read on the server from the Rung program's transactions on the
  network in `lib/status.ts` (`lib/counter.ts`): orders opened, bought, not
  bought, which rung filled, fees, recent orders. Cached for about a minute; if
  the RPC does not answer in time the page shows the counter as unavailable.

## Run

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # production build (also checks types)
```

`RPC_URL` (see `.env.example`) is a server-side variable for the counter's RPC
endpoint. It has no `NEXT_PUBLIC_` prefix, so it is never sent to the browser.
Empty: the public endpoint in `lib/status.ts` is used, paced to its rate limit.

## Checking the fixed texts

```bash
node scripts/check-verbatim.mjs <path to the hand-off prompt, devir-promptu-rung.md>
```

compares every line marked `// verbatim` in `lib/copy.ts` and `lib/status.ts`
with the hand-off prompt, character by character (table rows cell by cell). It
prints `ok` or `FAIL` with where the text differs, and exits with 1 if any line
differs.
