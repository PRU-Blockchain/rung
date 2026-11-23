# pump / PumpSwap arayüz başvurusu (CPI ile "sabit SOL → en az token" alımı)

- **Kaynak:** https://github.com/pump-fun/pump-public-docs, commit `bc35796152027d2744ca02066d305438e34b67e7`
  (2026-11-20T21:34:02Z, "docs: protocol fee recipient rotation, 8 new fee recipients for pump and PumpSwap, cut off November 25").
- **Çıkarılma tarihi:** 2026-11-23. Ham dosyalar: `C:\Android\tmp\pump-docs-guncel\` (yalnız veri).
- **Uyarı:** Bu dosya 2026-11-23'te kaynaktan çıkarıldı. **Kod yazmadan önce güncel IDL ile yeniden karşılaştır.**
- Kural: adres, sıra, tohum, kod, sürüm kaynakta yazdığı gibidir. Kaynakta olmayan şey "kaynakta yok" diye işaretli.
  "Kaynak dışı" etiketli satırlar genel Solana bilgisidir, pump belgesi değildir.
- Bayraklar: W = writable, S = signer, OPT = optional. IDL'de hiçbir alım talimatında `optional` hesap yok.
  Hesap listelerindeki sıra 0 tabanlıdır; "BUY.md #16", "TRADE_V3 #9" gibi atıflar belgenin kendi 1 tabanlı numarasıdır.
## 0. Adresler
| Ne | Adres | Kaynak |
|---|---|---|
| pump programı | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | `idl/pump.json` `address` |
| PumpSwap programı | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | `idl/pump_amm.json` `address` |
| Pump Fees programı | `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ` | IDL `fee_program.address` |
| pump `Global` | `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf` (`["global"]`) | PUMP_PROGRAM_README |
| PumpSwap `GlobalConfig` | `ADyA8hdefvWN2dbGGWFotbzWxrAvLW83WG6QCVXvJKqw` (`["global_config"]`) | PUMP_SWAP_README, PUMP_SWAP_TRADE_V2 |
| pump `fee_config` | `8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt` | TRADE_V3 |
| PumpSwap `fee_config` | `5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx` | PUMP_SWAP_TRADE_V2 |
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | BUY.md, TRADE_V3 |
| Associated Token Program | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | IDL |
| Wrapped SOL mint | `So11111111111111111111111111111111111111112` | README, TRADE_V3 |

IDL `metadata`: her iki IDL'de `"version":"0.1.0","spec":"0.1.0"` (program sürümü hakkında başka bilgi kaynakta yok).
PDA tohumu gösterimi: `"metin"` = sabit bayt (ASCII), `acc:x` = x hesabının anahtarı, `prog=` = türetildiği program
(yazılmamışsa talimatın kendi programı). `fee_config` tohumundaki 32 baytlık sabit, base58'e çevrilince pump için
`6EF8rr…F6P`, PumpSwap için `pAMMBa…XEA` (yani `[b"fee_config", <program_id>]`, `prog=` Pump Fees).
## A. pump (bonding curve) alım talimatları
| Talimat | Discriminator (dec) | hex | Argümanlar (sırayla) | Hesap sayısı |
|---|---|---|---|---|
| `buy` | `[102,6,61,18,1,218,235,234]` | `66063d1201daebea` | `amount: u64`, `max_sol_cost: u64`, `track_volume: OptionBool`, `partial_fill: OptionBool` | 16 |
| `buy_exact_sol_in` | `[56,252,116,8,158,223,205,95]` | `38fc74089edfcd5f` | `spendable_sol_in: u64`, `min_tokens_out: u64`, `track_volume: OptionBool`, `partial_fill: OptionBool` | 16 |
| `buy_v2` | `[184,23,238,97,103,197,211,61]` | `b817ee6167c5d33d` | `amount: u64`, `max_sol_cost: u64`, `partial_fill: OptionBool` | 27 |
| `buy_exact_quote_in_v2` | `[194,171,28,70,104,77,91,47]` | `c2ab1c46684d5b2f` | `spendable_quote_in: u64`, `min_tokens_out: u64`, `partial_fill: OptionBool` | 27 |
| `buy_v3` | `[7,5,29,196,245,23,101,80]` | `07051dc4f5176550` | `amount: u64`, `max_sol_cost: u64`, `partial_fill: OptionBool` | 17 |
| `buy_exact_quote_in_v3` | `[225,247,80,30,213,179,132,136]` | `e1f7501ed5b38488` | `spendable_quote_in: u64`, `min_tokens_out: u64`, `partial_fill: OptionBool` | 17 |

`OptionBool` IDL'de `{"kind":"struct","fields":["bool"]}`. TRADE_V3: `partial_fill` "May be left off the end of the instruction data."
`buy_exact_sol_in_v2` adında bir talimat **yok**; v2/v3'te "exact in" karşılığı `buy_exact_quote_in_v*`.
### A1. `buy` ve `buy_exact_sol_in` (aynı 16 hesap)
Sıra (0 tabanlı; `[bayrak]`; PDA tohumu):
0 `global` [-] `["global"]` · 1 `fee_recipient` [W] · 2 `mint` [-] · 3 `bonding_curve` [W] `["bonding-curve", acc:mint]` ·
4 `associated_bonding_curve` [W] `[acc:bonding_curve, acc:token_program, acc:mint]` prog=ATA ·
5 `associated_user` [W] **tohum yok** · 6 `user` [**W S**] · 7 `system_program` [-] `1111…1111` ·
8 `token_program` [-] **sabit adres yok** · 9 `creator_vault` [W] `["creator-vault", acc:bonding_curve.creator]` ·
10 `event_authority` [-] `["__event_authority"]` · 11 `program` [-] `6EF8rr…F6P` ·
12 `global_volume_accumulator` [-] `["global_volume_accumulator"]` · 13 `user_volume_accumulator` [W] `["user_volume_accumulator", acc:user]` ·
14 `fee_config` [-] `["fee_config", <pump id>]` prog=`acc:fee_program` · 15 `fee_program` [-] `pfeeUx…VjZ`

IDL `docs` — `buy`: "Buys tokens from a bonding curve." `buy_exact_sol_in` (kelimesi kelimesine):
```text
Given a budget of spendable SOL, buy at least min_tokens_out tokens.
Fees are deducted from spendable_sol_in.

# Quote formulas
Where:
- total_fee_bps = protocol_fee_bps + creator_fee_bps (creator_fee_bps is 0 if no creator)
- floor(a/b) = a / b (integer division)
- ceil(a/b) = (a + b - 1) / b

SOL → tokens quote
To calculate tokens_out for a given spendable_sol_in:
1. net_sol = floor(spendable_sol_in * 10_000 / (10_000 + total_fee_bps))
2. fees = ceil(net_sol * protocol_fee_bps / 10_000) + ceil(net_sol * creator_fee_bps / 10_000) (creator_fee_bps is 0 if no creator)
3. if net_sol + fees > spendable_sol_in: net_sol = net_sol - (net_sol + fees - spendable_sol_in)
4. tokens_out = floor((net_sol - 1) * virtual_token_reserves / (virtual_sol_reserves + net_sol - 1))

Reverse quote (tokens → SOL)
To calculate spendable_sol_in for a desired number of tokens:
1. net_sol = ceil(tokens * virtual_sol_reserves / (virtual_token_reserves - tokens)) + 1
2. spendable_sol_in = ceil(net_sol * (10_000 + total_fee_bps) / 10_000)

Rent
Separately make sure the instruction's payer has enough SOL to cover rent for:
- creator_vault: rent.minimum_balance(0)
- user_volume_accumulator: rent.minimum_balance(UserVolumeAccumulator::LEN)
```
**Gizli ek hesaplar (dikkat):** `docs/BREAKING_FEE_RECIPIENT.md` (28 Nisan yükseltmesi): "Add any one of the 8 new fee
recipients at the end of the buy and sell instructions." / "This new account should be added AFTER the bonding-curve-v2
account" / "Buy instructions should have 18 accounts in total". Yani eski `buy` 16 IDL hesabı + `bonding_curve_v2` +
buyback alıcısı = 18. `bonding_curve_v2` hesabının **tohumları kaynakta yok** (yalnız hata 6074 `InvalidBondingCurveV2`
ve `sell` docs'unda adı geçiyor). Bu, eski `buy`/`buy_exact_sol_in`'i CPI için riskli yapar.
### A2. `buy_v2` ve `buy_exact_quote_in_v2` (aynı 27 hesap)
("ATA(o,tp,m)" = `[acc:o, acc:tp, acc:m]` prog=ATA programı)
0 `global` [-] `["global"]` · 1 `base_mint` [-] · 2 `quote_mint` [-] (SOL çifti: WSOL mint) · 3 `base_token_program` [-] sabit değil ·
4 `quote_token_program` [-] sabit değil · 5 `associated_token_program` [-] `ATokenGP…8knL` · 6 `fee_recipient` [W] ·
7 `associated_quote_fee_recipient` [W] ATA(fee_recipient, quote_token_program, quote_mint) · 8 `buyback_fee_recipient` [W] ·
9 `associated_quote_buyback_fee_recipient` [W] ATA(buyback_fee_recipient, quote_token_program, quote_mint) ·
10 `bonding_curve` [W] `["bonding-curve", acc:base_mint]` · 11 `associated_base_bonding_curve` [W] ATA(bonding_curve, base_token_program, base_mint) ·
12 `associated_quote_bonding_curve` [W] ATA(bonding_curve, quote_token_program, quote_mint) · 13 `user` [**W S**] ·
14 `associated_base_user` [W] **tohum yok** · 15 `associated_quote_user` [W] tohum yok ·
16 `creator_vault` [W] `["creator-vault", acc:bonding_curve.creator]` · 17 `associated_creator_vault` [W] ATA(creator_vault, quote_token_program, quote_mint) ·
18 `sharing_config` [-] `["sharing-config", acc:base_mint]` prog=`pfeeUx…VjZ` · 19 `global_volume_accumulator` [-] `["global_volume_accumulator"]` ·
20 `user_volume_accumulator` [W] `["user_volume_accumulator", acc:user]` · 21 `associated_user_volume_accumulator` [W] ATA(user_volume_accumulator, quote_token_program, quote_mint) ·
22 `fee_config` [-] `["fee_config", <pump id>]` prog=`acc:fee_program` · 23 `fee_program` [-] `pfeeUx…VjZ` · 24 `system_program` [-] ·
25 `event_authority` [-] `["__event_authority"]` · 26 `program` [-] `6EF8rr…F6P`

IDL hesap docs'u: #15 "canonical SPL associated-token PDA. Validated in handlers via `validate_user_quote_token_account`
for non-legacy mints; ignored for legacy (SOL) trades."; #18 "...the account is intentionally not deserialized here
because it may be uninitialized for mints that have not created a fee sharing config..."

IDL'de v2 talimatları için talimat düzeyinde `docs` yok. BUY.md v2 SOL maliyetleri: #8 "ATA rent if missing", #11
"Rent top-up to make the account data length 115 bytes if it is smaller", #17 "Rent-exempt top-up if needed", #18 "ATA
rent if missing", #21 "Rent for 137-byte account if missing: 0.0018444 SOL", #22 "ATA rent if missing".
README (SOL çiftleri): "the following accounts are only Anchor seed constrained to the quote mint and do not need to be
initialized for the instruction to work: `associated_quote_fee_recipient`, `associated_quote_buyback_fee_recipient`,
`associated_quote_bonding_curve`, `associated_quote_user`, `associated_creator_vault`, `associated_user_volume_accumulator`".
### A3. `buy_v3` ve `buy_exact_quote_in_v3` (aynı 17 hesap)
(parantez içi: TRADE_V3 tablosundan alıntı)
0 `global` [-] `["global"]` · 1 `base_mint` [-] · 2 `quote_mint` [-] ("For SOL-paired coins pass wrapped SOL") ·
3 `base_token_program` [-] sabit değil ("Token-2022 (…) for `create_v2` coins, SPL Token for older coins.") ·
4 `quote_token_program` [-] sabit değil ("SPL Token for wrapped SOL and USDC.") ·
5 `bonding_curve` [W] `["bonding-curve", acc:base_mint]` ("Small rent top-up if the account still has an older, shorter layout. Paid by `user`.") ·
6 `associated_base_bonding_curve` [W] ATA(bonding_curve, base_token_program, base_mint) ·
7 `associated_quote_bonding_curve` [W] ATA(bonding_curve, quote_token_program, quote_mint) (SOL çiftinde "it is not used and does not need to exist") ·
8 `user` [**W S**] ("Transaction signer and trader.") ·
9 `associated_base_user` [W] **tohum yok** ("User's token account for `base_mint`. **Must exist.** The trade does not create it.") ·
10 `associated_quote_user` [W] tohum yok (SOL çiftinde "pass the user's wrapped SOL ATA address; it is not used and does not need to exist.") ·
11 `user_volume_accumulator` [W] `["user_volume_accumulator", acc:user]` ("Created if missing, paid by `user`." / "Rent for a 137-byte account if missing: 0.0018444 SOL") ·
12 `fee_config` [-] `["fee_config", <pump id>]` prog=`pfeeUx…VjZ` (sabit; adres `8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt`) ·
13 `buyback_fee_recipient` [W] (SOL çiftinde 8 buyback cüzdanından biri; "Never created by the trade. **Must exist.**") ·
14 `system_program` [-] `11111111111111111111111111111111` · 15 `event_authority` [-] `["__event_authority"]` ·
16 `program` [-] `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`

v3'te `fee_recipient`, `creator_vault`, `fee_program`, `global_volume_accumulator`, `sharing_config` **yok**: ücretler
eğride kalır (`BondingCurve.protocol_fees`, `creator_fee`), sonra `sweep_*` ile ödenir.
## B. PumpSwap (AMM) alım talimatları
| Talimat | Discriminator | hex | Argümanlar | Hesap |
|---|---|---|---|---|
| `buy` | `[102,6,61,18,1,218,235,234]` | `66063d1201daebea` | `base_amount_out: u64`, `max_quote_amount_in: u64`, `track_volume: OptionBool` | 23 |
| `buy_exact_quote_in` | `[198,46,21,82,180,217,232,112]` | `c62e1552b4d9e870` | `spendable_quote_in: u64`, `min_base_amount_out: u64`, `track_volume: OptionBool` | 23 |
| `buy_v2` | `[184,23,238,97,103,197,211,61]` | `b817ee6167c5d33d` | `base_amount_out: u64`, `max_quote_amount_in: u64` | 17 |
| `buy_exact_quote_in_v2` | `[194,171,28,70,104,77,91,47]` | `c2ab1c46684d5b2f` | `spendable_quote_in: u64`, `min_base_amount_out: u64` | 17 |

(Discriminator'lar pump'takilerle aynı baytlar; ayrım program kimliğiyle olur.)
### B1. `buy` ve `buy_exact_quote_in` (aynı 23 hesap)
0 `pool` [W] · 1 `user` [**W S**] · 2 `global_config` [-] · 3 `base_mint` [-] rel=pool · 4 `quote_mint` [-] rel=pool ·
5 `user_base_token_account` [W] tohum yok · 6 `user_quote_token_account` [W] tohum yok · 7 `pool_base_token_account` [W] rel=pool ·
8 `pool_quote_token_account` [W] rel=pool · 9 `protocol_fee_recipient` [-] ·
10 `protocol_fee_recipient_token_account` [W] ATA(protocol_fee_recipient, quote_token_program, quote_mint) ·
11 `base_token_program` [-] sabit değil · 12 `quote_token_program` [-] sabit değil · 13 `system_program` [-] ·
14 `associated_token_program` [-] `ATokenGP…8knL` · 15 `event_authority` [-] `["__event_authority"]` · 16 `program` [-] `pAMMBa…XEA` ·
17 `coin_creator_vault_ata` [W] ATA(coin_creator_vault_authority, quote_token_program, quote_mint) ·
18 `coin_creator_vault_authority` [-] `["creator_vault", acc:pool.coin_creator]` · 19 `global_volume_accumulator` [-] `["global_volume_accumulator"]` ·
20 `user_volume_accumulator` [W] `["user_volume_accumulator", acc:user]` · 21 `fee_config` [-] `["fee_config", <pump_amm id>]` prog=`acc:fee_program` ·
22 `fee_program` [-] `pfeeUx…VjZ`

IDL `docs` — `buy`: "For cashback coins, optionally pass user_volume_accumulator_wsol_ata as remaining_accounts[0]. If
provided and valid, the ATA will be initialized if needed." `buy_exact_quote_in` (kelimesi kelimesine):
```text
Given a budget of spendable_quote_in, buy at least min_base_amount_out
Fees will be deducted from spendable_quote_in

f(quote) = tokens, where tokens >= min_base_amount_out

Make sure the payer has enough SOL to cover creation of the following accounts (unless already created):
- protocol_fee_recipient_token_account: rent.minimum_balance(TokenAccount::LEN)
- coin_creator_vault_ata: rent.minimum_balance(TokenAccount::LEN)
- user_volume_accumulator: rent.minimum_balance(UserVolumeAccumulator::LEN)

For cashback coins, optionally pass user_volume_accumulator_wsol_ata as remaining_accounts[0].
If provided and valid, the ATA will be initialized if needed.
```
BREAKING_FEE_RECIPIENT (AMM): "Add 2 new accounts in this order at the end: One of the 8 fee recipients. ( Second last
account, readonly) / Quote mint ATA for fee recipient. ( Last account, mutable )" ve "These 2 new accounts should be
added AFTER the pool-v2 account". `pool_v2` **tohumları kaynakta yok** (yalnız hata 6062 `InvalidPoolV2`).
### B2. `buy_v2` ve `buy_exact_quote_in_v2` (aynı 17 hesap, "no remaining accounts")
0 `pool` [W] ("Small rent top-up if … older, shorter layout. Paid by `user`.") · 1 `user` [**W S**] ("Transaction signer and trader.") ·
2 `global_config` [-] (`ADyA8h…JKqw`) · 3 `base_mint` [-] rel=pool · 4 `quote_mint` [-] rel=pool (SOL havuzunda WSOL) ·
5 `user_base_token_account` [W] tohum yok ("**Must exist.** The trade does not create it.") ·
6 `user_quote_token_account` [W] tohum yok ("For SOL pools this is a wrapped SOL account. **Must exist.**") ·
7 `pool_base_token_account` [W] rel=pool · 8 `pool_quote_token_account` [W] rel=pool · 9 `base_token_program` [-] sabit değil ·
10 `quote_token_program` [-] sabit değil · 11 `system_program` [-] ·
12 `user_volume_accumulator` [W] `["user_volume_accumulator", acc:user]` ("Created if missing, paid by `user`.") ·
13 `fee_config` [-] `["fee_config", <pump_amm id>]` prog=`pfeeUx…VjZ` (`5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx`) ·
14 `buyback_fee_recipient` [W] (buyback cüzdanının `quote_mint` ATA'sı; "Never created by the trade. **Must exist.**") ·
15 `event_authority` [-] `["__event_authority"]` · 16 `program` [-] `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`

Pool PDA (PUMP_SWAP_README): `["pool", index, creator, baseMint, quoteMint]`; IDL alım talimatında `pool` için tohum yok.
## C. Hangi talimat?
**Kaynakta tek bir "CPI için şunu kullan" önerisi yok.** Bulunan ifadeler:

- README (v2 duyurusu): "We are moving to this new unified interface and would urge all integrations to switch to these
  instructions to future proof their setup." (eski `buy` → `buy_v2`/`buy_exact_quote_in_v2`)
- BUY.md: "**New, smaller version:** `buy_v3` and `buy_exact_quote_in_v3` do the same buy with 17 accounts instead of 27.
  … `buy_v2` keeps working unchanged."
- TRADE_V3: "Use them for any coin paired with SOL, USDC or a pump coin. Mayhem coins work too. Cashback coins are the one
  exception: a v3 trade on a cashback coin fails with `CashbackCoinNotSupported` (6094), so keep using v2 for those." /
  "The v2 and legacy instructions keep working unchanged."
- CPI_README örneği `buy_v2` üzerine yazılmış ("For CPI into pump's `buy_v2`, `sell_v2`, or any other pump instruction").
- Hiçbir alım talimatı için "deprecated" notu yok. Deprecated olanlar: cashback modu (yeni coin yaratılamaz), `withdraw`.

| | `buy_exact_sol_in` | `buy_exact_quote_in_v2` | `buy_exact_quote_in_v3` |
|---|---|---|---|
| IDL hesap | 16 (+ belgeye göre 2 ek remaining, tohum bilinmiyor) | 27 | 17 |
| `fee_recipient` gerekir mi | evet (25 Kasım rotasyonu etkiler) | evet | hayır |
| `creator_vault` (kira) | evet, `rent.minimum_balance(0)` | evet + ATA | hayır |
| `user_volume_accumulator` (kira, user öder) | evet | evet | evet |
| buyback alıcısı | remaining (BREAKING) | #8/#9 | #13, var olmalı |
| Cashback coin | çalışır | çalışır | **6094 ile düşer** |
| Mayhem coin | `partial_fill` | `partial_fill` (reserved fee recipient gerekir) | çalışır, `partial_fill` yalnız mayhem'de |
| Eğriyi bitiren büyük alım | `NotEnoughTokensToBuy` / `partial_fill` | aynı | synthetic migration (havuz fiyatıyla devam) |
| Ücretin gittiği yer | anında ödenir | anında ödenir | eğride kalır, sweep |

Karar sende; kaynak üçünün de çalıştığını söylüyor. (v2 mayhem: "choose one of the reserved fee recipients as `feeRecipient`".)
## D. Alıcı (user) = kasa PDA'sı
Kaynakta "user bir PDA olabilir / olamaz" diye **hiçbir ifade yok**. Belgeler `user`'ı "Transaction signer and trader"
diye tanımlar (TRADE_V3 #9, PUMP_SWAP_TRADE_V2 #2); IDL'de yalnız `signer: true, writable: true`.

1. **`user` W+S mi?** Evet, incelenen her alım talimatında (`buy`/`buy_exact_sol_in` #6, v2 #13, v3 #8, AMM #1).
   **SOL'un nasıl çekildiği:** kaynakta "system transfer" ifadesi yok. Yalnız: README "Trading and transfer will
   continue to happen with native SOL for these coins"; BUY.md #16 "native SOL is used for the transfer". AMM tarafında
   SOL native değil: `user_quote_token_account` "For SOL pools this is a wrapped SOL account. **Must exist.**"
   → PumpSwap için kasa PDA'sının sahibi olduğu, dolu bir WSOL token hesabı gerekir.
   *Kaynak dışı:* sistem programıyla `from` olan hesap sistem sahipli ve verisiz olmalı; kasa tarifimiz buna uyuyor.
2. **`associated_user` / `associated_base_user` kısıtı:** IDL'de **tohum/ilişki yok**, yalnız W. Mint/sahip kontrolünün
   handler'da yapılıp yapılmadığı, ATA olmak zorunda olup olmadığı **kaynakta yok**. Ad ve BUY.md #15 ("User's associated
   token account for `base_mint`, using `base_token_program`") ATA beklendiğini ima eder. Quote tarafında açık:
   "canonical SPL associated-token PDA. Validated in handlers…". **Açılıyor mu:** hayır — TRADE_V3 "**Must exist.** The
   trade does not create it."; PumpSwap v2 aynı. Rust SDK `buy_v2_instructions` "prepends the user's base/quote ATA
   creates" (yani ATA'yı ayrı talimatla önceden açmak gerekir). Güvenli yol: `ATA(owner = kasa PDA, mint, base_token_program)`.
3. **`user`'ın kirasını ödediği hesaplar:** `user_volume_accumulator` (her sürüm; "Created if missing, paid by `user`",
   "Rent for a 137-byte account if missing: 0.0018444 SOL") · `creator_vault` (`buy`/`buy_exact_sol_in`
   "rent.minimum_balance(0)", v2 "Rent-exempt top-up if needed", v3'te yok) · `bonding_curve` takviyesi (v2 "115 bytes if
   it is smaller", v3 "Paid by `user`") · v2 ATA'ları "ATA rent if missing" (SOL çiftinde README'ye göre gerekmez) ·
   AMM v1: `protocol_fee_recipient_token_account`, `coin_creator_vault_ata`, `user_volume_accumulator` (B1 alıntısı).
   Belge notları A1 ("Separately make sure the instruction's payer has enough SOL to cover rent for: …") ve B1'de aynen.
   Hata: 6040 `BuyNotEnoughSolToCoverRent`. *Kaynak dışı:* bu açılışlar CPI içinde `user` imzası ister; `invoke_signed`
   imza yetkisi iç CPI'lara geçer. Kasa = alım tutarı + bu kiralar + kendi kira muafiyeti kadar SOL tutmalı.
4. **`user_volume_accumulator`:** tohum `["user_volume_accumulator", user]` — alıcıya bağlı, pump ve PumpSwap'ta ayrı
   PDA ("They share a seed `"user_volume_accumulator"` with the program ID being the only difference", CASHBACK README).
   Ayrı talimat var: `init_user_volume_accumulator` (iki programda da), disc `[94,6,202,115,255,96,232,183]`, argüman yok,
   hesaplar: `payer` [W S], `user` [-], `user_volume_accumulator` [W] `["user_volume_accumulator", acc:user]`,
   `system_program`, `event_authority`, `program`. → **ödeyici `user`'dan farklı olabilir ve `user` imzalamaz**
   (IDL bayraklarına göre). Önceden açılırsa alımda bu kira çıkmaz. Kapatma: `close_user_volume_accumulator` (4 hesap) var.
5. **CPI rehberi (CPI_README.md) — aynen:**
```rust
use anchor_lang::prelude::*;

declare_id!("7enkT8uLQrwKYSRMrazjr1YZPT7unToAtwdLMWa2QLYY");
declare_program!(pump);

#[program]
pub mod example_cpi_program {
    use super::*;

    pub fn buy_v2(ctx: Context<BuyV2>, amount: u64, max_sol_cost: u64) -> Result<()> {
        pump::cpi::buy_v2(
            CpiContext::new(
                ctx.accounts.program.to_account_info(),
                pump::cpi::accounts::BuyV2 {
                    global: ctx.accounts.global.to_account_info(),
                    // ... all pump BuyV2 accounts, same order ...
                    program: ctx.accounts.program.to_account_info(),
                },
            ),
            amount,
            max_sol_cost,
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct BuyV2<'info> {
    /// CHECK: passed straight to pump
    pub global: UncheckedAccount<'info>,
    // ... fields in the same order as pump::cpi::accounts::BuyV2 ...
    #[account(mut)]
    pub user: Signer<'info>,
    // ...
    /// CHECK: pump program; CPI target
    pub program: UncheckedAccount<'info>,
}
```
```rust
use pump_rust_client::state::BondingCurve;

#[derive(Accounts)]
pub struct BuyV2<'info> {
    // ...
    pub bonding_curve: Account<'info, BondingCurve>,
    // ...
}
```
```toml
[features]
idl-build = [
    "anchor-lang/idl-build",
    "anchor-spl/idl-build",
    "pump-rust-client/idl-build",
]

[dependencies]
pump-rust-client = { version = "...", path = "..." }
```
   Rehber kuralları: "Your wrapper's `Accounts` struct must mirror pump's `BuyV2` account order exactly"; tipli hesap
   için "import the type from `pump_rust_client::state`, **not** from `declare_program!(pump)`'s generated
   `pump::accounts` module"; "`pump_rust_client::state` types are wrapped in `AccountWrapper`, which zero-pads short
   buffers so older on-chain accounts (e.g. pre-existing `BondingCurve`s) still deserialize. The raw IDL type does not,
   and will fail on legacy accounts." Kaynak kodu: `src/account_wrapper.rs`.
   Not: örnekte `user: Signer` — bizde `user` kasa PDA'sı olduğu için dış talimatta imzalayan olamaz; `UncheckedAccount`
   + `CpiContext::new_with_signer` gerekir (*kaynak dışı*, rehberde PDA örneği yok).
6. **`pump_rust_client`:** crates.io'da `pump-rust-client`. Belgeler 0.4.1 diyor (README, TRADE_V3); crates.io'da en yeni
   **0.5.0** (2026-10-19; 0.4.1 2026-10-13). Lisans MIT, `rust_version` 1.89, edition 2021, `repository` alanı boş
   (git deposu bulunamadı). Bağımlılıklar (0.5.0 ve 0.4.1 aynı): `anchor-lang >=0.31, <2` (özellikler `event-cpi,
   init-if-needed, allow-missing-optionals`), `anchor-spl >=0.31, <2`, `solana-program >=2.1.21` (üst sınır yok),
   opsiyonel `solana-sdk`/`solana-client >=2.1.21, <3`, `spl-token =7.0.0`, `spl-token-2022 =6.0.0`. Özellikler:
   `idl-build = ["anchor-lang/idl-build","anchor-spl/idl-build"]`, `client`, `local-validator`. Anchor 1.1.2 aralıkta
   (`<2`); solana 3.x ile çözümleme uyumu derleyerek doğrulanmalı.
## E. Hesap düzenleri (IDL `types`, sırayla) ve discriminator'lar
| Hesap | Discriminator | Alanlar |
|---|---|---|
| `BondingCurve` (pump) | `[23,183,248,55,96,216,172,96]` | `virtual_token_reserves u64, virtual_quote_reserves u64, real_token_reserves u64, real_quote_reserves u64, token_total_supply u64, complete bool, creator pubkey, is_mayhem_mode bool, is_cashback_coin bool, quote_mint pubkey, creator_fee_bps u64, can_edit_creator_fee bool, is_holder_reward bool, creator_fee u64, protocol_fees u64, depth u8, initial_virtual_quote_reserves u64, post_complete_base_out u64, post_complete_quote_in u64` |
| `Global` (pump) | `[167,232,232,177,200,108,114,127]` | `initialized bool, authority pubkey, fee_recipient pubkey, initial_virtual_token_reserves u64, initial_virtual_sol_reserves u64, initial_real_token_reserves u64, token_total_supply u64, fee_basis_points u64, withdraw_authority pubkey, enable_migrate bool, pool_migration_fee u64, creator_fee_basis_points u64, fee_recipients [pubkey;7], set_creator_authority pubkey, admin_set_creator_authority pubkey, create_v2_enabled bool, whitelist_pda pubkey, reserved_fee_recipient pubkey, mayhem_mode_enabled bool, reserved_fee_recipients [pubkey;7], is_cashback_enabled bool, buyback_fee_recipients [pubkey;8], buyback_basis_points u64, initial_virtual_quote_reserves u64, whitelisted_quote_mints [pubkey;1], creator_fee_configurable bool, max_configurable_creator_fee_bps u64, holder_reward_claim_authority pubkey, is_holder_reward_enabled bool, max_curve_depth u8` |
| `FeeConfig` (Pump Fees; iki IDL'de aynı) | `[143,52,146,187,219,123,76,155]` | `bump u8, admin pubkey, flat_fees Fees, fee_tiers Vec<FeeTier>, stable_fee_tiers Vec<FeeTier>, exotic_flat_fees Fees` — `Fees{lp_fee_bps u64, protocol_fee_bps u64, creator_fee_bps u64}`, `FeeTier{market_cap_lamports_threshold u128, fees Fees}` |
| `UserVolumeAccumulator` (pump) | `[86,255,112,14,102,53,154,250]` | `user pubkey, needs_claim bool, total_unclaimed_tokens u64, total_claimed_tokens u64, current_sol_volume u64, last_update_timestamp i64, has_total_claimed_tokens bool, cashback_earned u64, total_cashback_claimed u64, stable_cashback_earned u64, total_stable_cashback_claimed u64` |
| `UserVolumeAccumulator` (AMM) | aynı | pump'takinin ilk 9 alanı (`stable_*` iki alan yok) |
| `GlobalVolumeAccumulator` | `[202,42,246,43,142,190,30,255]` | `start_time i64, end_time i64, seconds_in_a_day i64, mint pubkey, total_token_supply [u64;30], sol_volumes [u64;30]` |
| `Pool` (AMM) | `[241,154,109,4,17,177,109,188]` | `pool_bump u8, index u16, creator pubkey, base_mint pubkey, quote_mint pubkey, lp_mint pubkey, pool_base_token_account pubkey, pool_quote_token_account pubkey, lp_supply u64, coin_creator pubkey, is_mayhem_mode bool, is_cashback_coin bool, virtual_quote_reserves i128, creator_fee_bps u64, can_edit_creator_fee bool, is_holder_reward bool, protocol_fees u64, creator_fees u64` |
| `GlobalConfig` (AMM) | `[149,8,156,202,160,252,176,217]` | `admin pubkey, lp_fee_basis_points u64, protocol_fee_basis_points u64, disable_flags u8, protocol_fee_recipients [pubkey;8], coin_creator_fee_basis_points u64, admin_set_coin_creator_authority pubkey, whitelist_pda pubkey, reserved_fee_recipient pubkey, mayhem_mode_enabled bool, reserved_fee_recipients [pubkey;7], is_cashback_enabled bool, buyback_fee_recipients [pubkey;8], buyback_basis_points u64, boost_authority pubkey, boost_enabled bool, creator_fee_configurable bool, max_configurable_creator_fee_bps u64` |

Kısa (eski) hesaplar: "accounts written before a field existed are shorter; read the missing trailing fields as `0` /
`false` / `Pubkey::default()`" (PUMP_PROGRAM_README). `BondingCurve.quote_mint` SOL çiftlerinde `Pubkey::default()`.
**Fiyat için:** eğri → `virtual_token_reserves`, `virtual_quote_reserves` (README: "Renamed `virtual_sol_reserves` to
`virtual_quote_reserves`"; `buy_exact_sol_in` docs'u hâlâ eski adı kullanıyor), `real_token_reserves`, `complete`.
AMM → `pool_base_token_account.amount` ve `effective_quote_reserves = pool_quote_token_account.amount +
Pool::virtual_quote_reserves` (`i128`, "can be **negative**"; README 30 Eylül notu).
## F. Ücretler ve kotasyon
- Ücret kaynağı: FEE_PROGRAM_README — `feeConfig != null` ise piyasa değerine göre `fee_tiers`'tan (`calculateFeeTier`),
  değilse pump `global.feeBasisPoints` / `global.creatorFeeBasisPoints`, AMM `lpFeeBasisPoints` /
  `protocolFeeBasisPoints` / `coinCreatorFeeBasisPoints`. AMM'de kanonik olmayan havuz → `feeConfig.flatFees`.
  Eğri piyasa değeri: `virtualSolReserves * mintSupply / virtualTokenReserves`; havuz: `quoteReserve * baseMintSupply / baseReserve`.
  v3/AMM v2: "The fee schedule is read from the Pump Fees `fee_config` account directly."
- Baz puanları: kademe değerleri **metin olarak kaynakta yok** (yalnız `docs/fees.png` görselinde). Eski örnekler:
  pump `fee_basis_points == 100 bps`, `creator_fee` "set to `0`" (PUMP_PROGRAM_README); AMM "`lp_fee_basis_points == 20
  bps` and `protocol_fee_basis_points == 5 bps`" (PUMP_SWAP_README). Bunlar güncel kademeler değil; zincirden `FeeConfig` oku.
- Buyback payı: `Global.buyback_basis_points` / `GlobalConfig.buyback_basis_points`; v3 ve AMM v2'de "still paid in the trade".
- Eğri SOL→token formülü: A1'deki `buy_exact_sol_in` docs'u. Eğriyi aşan v3 alımı için SYNTHETIC_MIGRATION:
  `out = floor((in - 1) * pool_base / (pool_quote + in - 1))`, `pool_base = associated_base_bonding_curve.amount - remaining`,
  `pool_quote = real_quote_reserves + curve_quote - Global.pool_migration_fee` (SOL çifti). "The bonding curve fee schedule applies to each part separately."
- AMM: kaynakta açık SOL→token formülü **yok**; yalnız "`f(quote) = tokens, where tokens >= min_base_amount_out`" ve
  "Price against the effective quote reserves". SDK fonksiyonları: Rust `buy_quote_bonding_curve_v3_sol_in`,
  `buy_quote_bonding_curve_v3_token_out`; TS `getBuyV3TokenAmountFromQuoteAmount`.
## G. Hatalar (ilgili olanlar)
**pump:** 6002 `TooMuchSolRequired` "slippage: Too much SOL required to buy the given amount of tokens." ·
6005 `BondingCurveComplete` "The bonding curve has completed and liquidity migrated to raydium." · 6020 `BuyZeroAmount` "Buy zero amount" ·
6021 `NotEnoughTokensToBuy` "Not enough tokens to buy" · 6040 `BuyNotEnoughSolToCoverRent` "Buy: Not enough SOL to cover for rent exemption." ·
6042 `BuySlippageBelowMinTokensOut` "Slippage: Would buy less tokens than expected min_tokens_out" · 6048 `MayhemModeDisabled` (mesaj yok) ·
6061 `WrongBuybackFeeRecipientsCount` "buyback fee recipients require exactly 8 remaining accounts (or none)" ·
6072 `MissingCashbackAccounts` "Cashback trade is missing the required remaining accounts" ·
6074 `InvalidBondingCurveV2` "bonding_curve_v2 remaining account is missing or invalid" ·
6094 `CashbackCoinNotSupported` "v3 trades do not support cashback coins; use the v2 instructions" ·
6097 `FeeConfigTooShort` "The fee config account is shorter than its initialize size" ·
6107 `QuoteCurveAwaitingMigration` "A quote-chain coin's curve is complete but not yet migrated; retry once migrate_v2 creates its pool"

**AMM:** 6004 `ExceededSlippage` (mesaj yok) · 6020 `DisabledBuy` (mesaj yok) ·
6039 `BuyNotEnoughQuoteTokensToCoverFees` "buy: Not enough quote tokens to cover for fees." ·
6040 `BuySlippageBelowMinBaseAmountOut` "buy: slippage - would buy less tokens than expected min_base_amount_out" ·
6041 `MayhemModeDisabled` (mesaj yok) · 6059 `MissingCashbackAccounts` "Cashback trade is missing the required remaining accounts" ·
6062 `InvalidPoolV2` "pool_v2 remaining account is missing or invalid" ·
6079 `CashbackCoinNotSupported` "v2 trades do not support cashback coins; use the v1 instructions" ·
6080 `MayhemPoolNotSupported` "v2 trades do not support mayhem-mode pools; use the v1 instructions" ·
6083 `FeeConfigTooShort` "The fee config account is shorter than its initialize size"

Çelişki: PUMP_SWAP_TRADE_V2 "Mayhem pools work too" derken AMM hata 6080 "v2 trades do not support mayhem-mode pools".
Ayrıca "kira yetmedi" hatası AMM'de yok; pump'ta yalnız 6040.
## H. Token programı
- TRADE_V3 #4: "Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) for `create_v2` coins, SPL Token for older coins."
  BUY.md #4: "For `create_v2` coins this is Token-2022". IDL `create_v2` docs: "Creates a new spl-22 coin and bonding curve."
- BUY.md (TS): "For legacy coins where the base mint uses the legacy SPL Token Program, pass `TOKEN_PROGRAM_ID` as both
  the base `tokenProgram` and `quoteTokenProgram`."
- Alım talimatlarında `token_program` / `base_token_program` / `quote_token_program` **sabit adres değil** (IDL'de
  `address` yok) → mint'in sahibine göre çalışma anında seçilmeli; ATA türetimine de girer.
- PUMP_PROGRAM_README hâlâ "creating SPL coins" diyor (eski metin).
## I. 22 Kasım kopyasıyla fark
`pump.json`, `pump_amm.json`, `CPI_README.md`, `PUMP_PROGRAM_README.md`, `PUMP_SWAP_README.md`, `FAQ.md`: **bayt bayt
aynı** (`cmp`). Talimat/hesap listesinde değişiklik **yok**. 22 Kasım kopyasında olmayan ama okunan dosyalar:
TRADE_V3, BUY, PUMP_SWAP_TRADE_V2, SYNTHETIC_MIGRATION, FEE_RECIPIENTS, FEE_RECIPIENT_ROTATION, BREAKING_FEE_RECIPIENT, ana README.
## J. Ek uyarılar
- **25 Kasım fee recipient rotasyonu:** "After **November 25**, only the 8 new ones work." Yeni liste README'de
  (`2aSWZ3QXsNLVVBr1UB1HxSw7sqMRR2pv2qa5ohsTi5Gp`, `DrcDxWxLi3i7Yd7cTyCyd44DE7pwS9BvFxSsPx1c7XTv`,
  `EAN7utdjyxhKVaqA69DRyxW5ffBhnidRZfifmfhwUgPm`, `Fso3Ggq2Um1pQT6Uzq8wDicgRh62vANYZUT8uqJd2fXh`,
  `BWNNnhN6id5j71h5wfkzmXjnV2fgF9zA61FqGJJjnakw`, `Eh7hTLi6iMbT55jAEYVgtN5QaSb6z9Ytzwxs2LGG5qg4`,
  `3Mqk6qHEj7r3TFNFYjCP85a5venbp2mefYQTSKVVchBC`, `A3cm36KqisUXVTSRCK6VQ7kvXLene4gsbQedhcd5MujQ`).
  Buyback alıcıları (v3 #13 için, FEE_RECIPIENTS): `5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD`, `9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7`,
  `GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL`, `3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR`, `5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6`,
  `EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL`, `5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD`, `A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW`.
  `docs/FEE_RECIPIENTS.md`'deki "Normal Fee Recipients" tablosu hâlâ **eski** adresleri gösteriyor. Reserved ve buyback
  listeleri değişmiyor. v3 / AMM v2 `fee_recipient` almadığı için bundan etkilenmez; `buy`, `buy_exact_sol_in`, `buy_v2`, AMM v1 etkilenir.
- FAQ: CU için "it is recommended to use a static big enough CU limit like `100_000`" (BUY.md Rust örneği 400_000 kullanıyor).
- Kaynakta yok: `associated_user`'ın handler kontrolleri, `bonding_curve_v2` / `pool_v2` tohumları, PDA alıcı hakkında
  herhangi bir not, güncel ücret kademelerinin metni, `UserVolumeAccumulator::LEN` sayısı (yalnız "137-byte").
