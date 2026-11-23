// Compares every `// verbatim` line in lib/copy.ts and lib/status.ts with the
// hand-off prompt, character by character.
// Usage: node scripts/check-verbatim.mjs <path to devir-promptu-rung.md>
// A line with one string must appear in the prompt exactly; a line with
// several strings is a table row and must equal a prompt table row cell by cell.

import { readFileSync } from "node:fs";

const promptPath = process.argv[2];
if (!promptPath) {
  console.error("usage: node scripts/check-verbatim.mjs <devir-promptu-rung.md>");
  process.exit(2);
}
const prompt = readFileSync(promptPath, "utf8").replace(/\r\n/g, "\n");
const tableRows = prompt
  .split("\n")
  .filter((l) => l.startsWith("|"))
  .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));

const STRING = /"((?:[^"\\]|\\.)*)"/g;
let checked = 0;
let failed = 0;

for (const file of ["lib/copy.ts", "lib/status.ts"]) {
  const lines = readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!/\/\/ verbatim\s*$/.test(line)) return; // a marker ends the line; header comments only mention it
    const code = line.slice(0, line.indexOf("// verbatim"));
    const strings = [...code.matchAll(STRING)].map((m) => JSON.parse(`"${m[1]}"`));
    const where = `${file}:${i + 1}`;
    if (strings.length === 0) {
      console.log(`FAIL ${where}: no string literal on the line`);
      failed++;
      return;
    }
    checked++;
    if (strings.length === 1) {
      const s = strings[0];
      if (prompt.includes(s)) {
        console.log(`ok   ${where}: ${s.slice(0, 60)}${s.length > 60 ? "…" : ""}`);
        return;
      }
      // Longest prefix that does occur, to show where it differs.
      let n = 0;
      while (n < s.length && prompt.includes(s.slice(0, n + 1))) n++;
      const at = prompt.indexOf(s.slice(0, n));
      console.log(`FAIL ${where}: differs after ${n} chars`);
      console.log(`     ours:   ${JSON.stringify(s.slice(Math.max(0, n - 20), n + 30))}`);
      console.log(`     prompt: ${JSON.stringify(prompt.slice(at + Math.max(0, n - 20), at + n + 30))}`);
      failed++;
      return;
    }
    const row = tableRows.find((r) => r.length === strings.length && r.every((c, k) => c === strings[k]));
    if (row) console.log(`ok   ${where}: | ${strings.join(" | ")} |`);
    else {
      console.log(`FAIL ${where}: no prompt table row equals | ${strings.join(" | ")} |`);
      failed++;
    }
  });
}

console.log(`\n${checked} verbatim lines checked, ${failed} failed`);
process.exit(failed ? 1 : 0);
