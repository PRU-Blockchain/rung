// A token's name, symbol and picture address, read from the chain. The bytes in
// token-vectors.json are real mainnet accounts (read Nov 25, 2026): two pump.fun
// mints of the Token-2022 kind, which keep their metadata inside the mint, and
// two older ones whose metadata sits in a Metaplex account.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  IPFS_GATEWAYS,
  PublicKey,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  base64Decode,
  cleanTokenText,
  decodeMetaplexMetadata,
  decodeToken2022Metadata,
  fetchTokenImageUrls,
  fetchUrls,
  imageFromMetadataJson,
  metaplexMetadataPda,
  tokenText,
} from "../src";

interface Vectors {
  token2022: { mint: string; owner: string; data: string }[];
  metaplex: { mint: string; mintOwner: string; mintData: string; metadataAddress: string; metadataOwner: string; data: string }[];
}
const vectors = JSON.parse(readFileSync(new URL("./token-vectors.json", import.meta.url), "utf8")) as Vectors;
const [cate, purrl] = vectors.token2022;
const [fartcoin, pnut] = vectors.metaplex;

test("a Token-2022 pump mint carries its name, symbol and uri", () => {
  assert.deepEqual(decodeToken2022Metadata(new PublicKey(cate.mint), base64Decode(cate.data)), {
    name: "Catecoin",
    symbol: "CATE",
    uri: "https://m.rapidlaunch.io/m/Tsg4I9WHC",
  });
  assert.deepEqual(decodeToken2022Metadata(new PublicKey(purrl.mint), base64Decode(purrl.data)), {
    name: "PURRL",
    symbol: "PURRL",
    uri: "https://ipfs.io/ipfs/bafkreiaciuucmbtx25psd7sjb2sgumczntyjklglrkbxsq7iroto6awtoq",
  });
});

test("metadata written for another mint is not this mint's", () => {
  assert.equal(decodeToken2022Metadata(new PublicKey(purrl.mint), base64Decode(cate.data)), null);
});

test("a mint without extensions has no metadata inside", () => {
  assert.equal(decodeToken2022Metadata(new PublicKey(fartcoin.mint), base64Decode(fartcoin.mintData)), null);
});

test("cut or scrambled mint data gives nothing and does not throw", () => {
  const data = base64Decode(cate.data);
  const mint = new PublicKey(cate.mint);
  for (let cut = 0; cut < data.length; cut += 7) {
    const part = decodeToken2022Metadata(mint, data.subarray(0, cut));
    assert.ok(part === null, `cut at ${cut}`);
  }
  // A name length that points past the end.
  const broken = Uint8Array.from(data);
  const at = data.length - 4 - "https://m.rapidlaunch.io/m/Tsg4I9WHC".length - 4 - 4 - 4 - 8 - 4;
  broken.set([255, 255, 255, 127], at);
  assert.equal(decodeToken2022Metadata(mint, broken), null);
});

test("the Metaplex account of an older pump token", () => {
  assert.equal(metaplexMetadataPda(new PublicKey(fartcoin.mint)).toBase58(), fartcoin.metadataAddress);
  assert.deepEqual(decodeMetaplexMetadata(new PublicKey(fartcoin.mint), base64Decode(fartcoin.data)), {
    name: "Fartcoin",
    symbol: "Fartcoin",
    uri: "https://ipfs.io/ipfs/QmYfe8zVGHA1heej47AkBX3Nnetg2h2kqj5yymz1xyKeHb",
  });
  assert.deepEqual(decodeMetaplexMetadata(new PublicKey(pnut.mint), base64Decode(pnut.data)), {
    name: "Peanut the Squirrel",
    symbol: "Pnut",
    uri: "https://ipfs.io/ipfs/QmSkEeAv71gDaLjcwnvVMmDnNsFrhHxrFSFX2Tg4upVe48",
  });
  assert.equal(decodeMetaplexMetadata(new PublicKey(pnut.mint), base64Decode(fartcoin.data)), null);
  assert.equal(decodeMetaplexMetadata(new PublicKey(fartcoin.mint), base64Decode(fartcoin.data).subarray(0, 90)), null);
});

test("tokenText reads the place this kind of mint uses, and checks who owns the account", () => {
  const metaplexProgram = new PublicKey(fartcoin.metadataOwner);
  const fromMint = tokenText(new PublicKey(cate.mint), { owner: TOKEN_2022_PROGRAM_ID, data: base64Decode(cate.data) }, null);
  assert.equal(fromMint?.symbol, "CATE");

  const legacyMint = { owner: TOKEN_PROGRAM_ID, data: base64Decode(fartcoin.mintData) };
  const fromMetaplex = tokenText(new PublicKey(fartcoin.mint), legacyMint, { owner: metaplexProgram, data: base64Decode(fartcoin.data) });
  assert.equal(fromMetaplex?.name, "Fartcoin");

  // An account at that address that the Metaplex program does not own says nothing.
  assert.equal(tokenText(new PublicKey(fartcoin.mint), legacyMint, { owner: TOKEN_PROGRAM_ID, data: base64Decode(fartcoin.data) }), null);
  assert.equal(tokenText(new PublicKey(fartcoin.mint), legacyMint, null), null);
  // Bytes shaped like a Token-2022 mint under another program are not read.
  assert.equal(tokenText(new PublicKey(cate.mint), { owner: metaplexProgram, data: base64Decode(cate.data) }, null), null);
});

test("names are cleaned before they reach the screen", () => {
  assert.equal(cleanTokenText("Fartcoin \0\0\0", 32), "Fartcoin");
  assert.equal(cleanTokenText("  two\n\nlines\there ", 32), "two lines here");
  // Direction overrides and zero-width characters can make one name look like another.
  assert.equal(cleanTokenText("US‮DC​⁦!﻿", 32), "USDC!");
  assert.equal(cleanTokenText("a".repeat(50), 32), "a".repeat(32));
  // Cut by character, never through the middle of one.
  assert.equal(cleanTokenText("🐱🐱🐱", 2), "🐱🐱");
  assert.equal(cleanTokenText("\u0007\u001B", 32), "");
});

test("only https addresses are fetched; ipfs content goes through gateways that answer", () => {
  assert.deepEqual(fetchUrls("https://m.rapidlaunch.io/m/Tsg4I9WHC"), ["https://m.rapidlaunch.io/m/Tsg4I9WHC"]);
  const cid = "bafkreiaciuucmbtx25psd7sjb2sgumczntyjklglrkbxsq7iroto6awtoq";
  const viaGateways = IPFS_GATEWAYS.map((g) => `${g}${cid}`);
  // ipfs.io no longer serves plain requests (429 on Nov 25, 2026), so it is not asked.
  assert.deepEqual(fetchUrls(`https://ipfs.io/ipfs/${cid}`), viaGateways);
  assert.deepEqual(fetchUrls(`ipfs://${cid}`), viaGateways);
  assert.deepEqual(fetchUrls(`ipfs://ipfs/${cid}`), viaGateways);
  assert.deepEqual(fetchUrls(`ipfs://${cid}/meta.json`), IPFS_GATEWAYS.map((g) => `${g}${cid}/meta.json`));
  // Another host's own gateway is asked first: it may be the only one that has the file.
  assert.deepEqual(fetchUrls(`https://pump.mypinata.cloud/ipfs/${cid}?img-width=64`), [
    `https://pump.mypinata.cloud/ipfs/${cid}?img-width=64`,
    ...viaGateways,
  ]);
  assert.ok(IPFS_GATEWAYS.length >= 2 && IPFS_GATEWAYS.every((g) => g.startsWith("https://") && g.endsWith("/ipfs/")));
});

test("addresses that are not fetched", () => {
  for (const uri of [
    "",
    "   ",
    "http://example.com/a.json",
    "javascript:alert(1)",
    "data:application/json,{}",
    "file:///etc/passwd",
    "https://",
    "https://localhost/a.json",
    "https://127.0.0.1/a.json",
    "https://192.168.1.1/a.json",
    "https://[::1]/a.json",
    "https://user:pass@example.com/a.json",
    "https://exa mple.com/a.json",
    "ipfs://",
    "ipfs://../../etc",
    `https://example.com/${"a".repeat(600)}`,
  ]) {
    assert.deepEqual(fetchUrls(uri), [], JSON.stringify(uri));
  }
});

test("the picture address comes from the metadata file's image field", () => {
  assert.deepEqual(imageFromMetadataJson({ name: "Catecoin", image: "https://m.rapidlaunch.io/images/Tsg4I9WHC.jpg" }), [
    "https://m.rapidlaunch.io/images/Tsg4I9WHC.jpg",
  ]);
  const cid = "bafkreihgph5q4aboae7gljh63gybvtxmgyiymyrn2bihzjhlqau6v7h3xi";
  assert.deepEqual(
    imageFromMetadataJson({ image: `https://ipfs.io/ipfs/${cid}` }),
    IPFS_GATEWAYS.map((g) => `${g}${cid}`),
  );
  for (const bad of [null, undefined, 7, "text", [], {}, { image: 5 }, { image: "http://x.example/a.png" }, { image: "javascript:alert(1)" }]) {
    assert.deepEqual(imageFromMetadataJson(bad), []);
  }
});

// --- Reading the metadata file ---------------------------------------------------

const CID = "bafkreiaciuucmbtx25psd7sjb2sgumczntyjklglrkbxsq7iroto6awtoq";
const IMAGE_CID = "bafkreihgph5q4aboae7gljh63gybvtxmgyiymyrn2bihzjhlqau6v7h3xi";
const answer = (body: string, status = 200) => ({ ok: status >= 200 && status < 300, status, text: async () => body });

test("the picture address is read from the first address that answers with a metadata file", async () => {
  const asked: string[] = [];
  const fetchFn = async (url: string) => {
    asked.push(url);
    if (url.startsWith(IPFS_GATEWAYS[0])) throw new Error("Network request failed");
    return answer(JSON.stringify({ name: "PURRL", image: `https://ipfs.io/ipfs/${IMAGE_CID}` }));
  };
  const urls = await fetchTokenImageUrls(fetchFn, `https://ipfs.io/ipfs/${CID}`);
  assert.deepEqual(urls, IPFS_GATEWAYS.map((g) => `${g}${IMAGE_CID}`));
  assert.deepEqual(asked, [`${IPFS_GATEWAYS[0]}${CID}`, `${IPFS_GATEWAYS[1]}${CID}`]);
});

test("an answer that is an error, too large, not a metadata file or too slow is passed over", async () => {
  const good = JSON.stringify({ image: "https://example.com/a.png" });
  const replies = [
    async () => answer("Too many requests", 429),
    async () => answer(JSON.stringify({ image: "https://example.com/big.png", pad: "x".repeat(5000) })),
    async () => answer("<html>not json</html>"),
  ];
  let i = 0;
  const fetchFn = async (_url: string) => (i < replies.length ? replies[i++]() : answer(good));
  // Three addresses to try (the gateways), all with bad answers.
  assert.deepEqual(await fetchTokenImageUrls(fetchFn, `ipfs://${CID}`, { maxBytes: 1000 }), []);
  assert.equal(i, 3);

  const never = async (_url: string) => new Promise<ReturnType<typeof answer>>(() => {});
  const started = Date.now();
  assert.deepEqual(await fetchTokenImageUrls(never, "https://example.com/meta.json", { timeoutMs: 30 }), []);
  assert.ok(Date.now() - started < 2000);

  // A file without a picture is a file: the search ends there.
  let asked = 0;
  const noImage = async (_url: string) => (asked++, answer(JSON.stringify({ name: "x" })));
  assert.deepEqual(await fetchTokenImageUrls(noImage, `ipfs://${CID}`), []);
  assert.equal(asked, 1);
});

test("an address that is not fetched asks nobody", async () => {
  let asked = 0;
  const fetchFn = async (_url: string) => (asked++, answer("{}"));
  assert.deepEqual(await fetchTokenImageUrls(fetchFn, "http://example.com/meta.json"), []);
  assert.deepEqual(await fetchTokenImageUrls(fetchFn, ""), []);
  assert.equal(asked, 0);
});
