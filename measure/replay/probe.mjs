// Probe: does getSignaturesForAddress accept a `before` signature that does not involve the address?
import { rpc, stats } from './lib/rpc.mjs';
import { bondingCurvePda } from './lib/solana.mjs';

const mint = process.argv[2];
const createSig = process.argv[3];
const createSlot = Number(process.argv[4]);
const curve = bondingCurvePda(mint);
let blk = null, s = createSlot + 3300;
for (; !blk; s++) blk = await rpc('getBlock', [s, { transactionDetails: 'signatures', rewards: false, maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]);
console.log('block', s - 1, 'sigs', blk.signatures.length, 'time', blk.blockTime);
const page = await rpc('getSignaturesForAddress', [curve, { limit: 1000, before: blk.signatures[0], until: createSig }]);
console.log('page n', page?.length, 'newest', page?.[0]?.slot, page?.[0]?.transactionIndex, 'oldest', page?.at(-1)?.slot, page?.at(-1)?.blockTime);
console.log(stats);
