// Preload to run build.mjs / sim.mjs strictly from the cache: any network request ends the process.
//   node --import ./tools/offline.mjs build.mjs ...
globalThis.fetch = async (url, opts) => {
  let method = '?';
  try { method = JSON.parse(opts?.body || '{}').method; } catch { /* ignore */ }
  console.error(`offline: a ${method} request was needed (not in the cache); stopping`);
  process.exit(3);
};
