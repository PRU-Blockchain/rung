// Tapping the empty token box pastes straight from the clipboard when the
// clipboard holds a token address (Buğra, Nov 27): one tap less for someone who
// just copied an address or a pump.fun link. What counts as "holds a token
// address" is this rule.
import assert from "node:assert/strict";
import { test } from "node:test";

import { addressInText } from "../../app/src/screens/pasteAddress";

const CATE = "Ai66LHZG9MCzg1WKdawwqduVAXpNDUuV8M3uyq5ppump";
const OTHER = "3DkJhLpCpbWjs96zaBhFc2Y7fdFXnj2NffWcweeFpump";

test("a copied address is found, with or without spaces and line breaks around it", () => {
  assert.equal(addressInText(CATE), CATE);
  assert.equal(addressInText(`  ${CATE}\n`), CATE);
});

test("a copied link is enough: the address is taken out of it", () => {
  assert.equal(addressInText(`https://pump.fun/coin/${CATE}`), CATE);
  assert.equal(addressInText(`https://pump.fun/${CATE}?ref=x`), CATE);
  assert.equal(addressInText(`https://dexscreener.com/solana/${CATE}`), CATE);
});

test("an address inside a message is found", () => {
  assert.equal(addressInText(`CA: ${CATE} lfg`), CATE);
});

test("when there are two addresses the first one is taken", () => {
  assert.equal(addressInText(`${CATE} ${OTHER}`), CATE);
});

test("ordinary text is not an address", () => {
  assert.equal(addressInText(""), null);
  assert.equal(addressInText("hello world"), null);
  assert.equal(addressInText("https://pump.fun/board"), null);
  // 44 characters of the right alphabet that do not decode to 32 bytes
  assert.equal(addressInText("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"), null);
});

test("a transaction signature is not an address", () => {
  const signature = "63AGFwRQzoiCF6hZ1TkU6ZDmP8xGhwkU7MGRx163h8PG4rVftqRnKADeT91dgWdpvk4cjrHUTXjcNYgt8Mrbafw6";
  assert.equal(addressInText(signature), null);
  assert.equal(addressInText(`https://solscan.io/tx/${signature}`), null);
});
