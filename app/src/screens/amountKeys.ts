// Pure: no React. The keypad's typing rule, tested from client/test/app-screens.test.ts.

/** The amount text after one key (the site's rule): one ".", at most 9 decimals and 10 digits. */
export function pressKey(text: string, key: string): string {
  if (key === "del") return text.slice(0, -1);
  if (key === ".") return text.includes(".") ? text : `${text === "" ? "0" : text}.`;
  const dec = text.split(".")[1];
  if (dec !== undefined && dec.length >= 9) return text;
  if (text.replace(".", "").length >= 10) return text;
  return text === "0" ? key : text + key;
}
