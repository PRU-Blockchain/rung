> Method notes in Turkish, as written during the measurement.

# T3-06 "Tek Onay, Tek Alım" · İkinci ölçüm: başka pencereler, gerçek kullanıcıya yakın alt küme, ilan edilen tolerans, düşen denemenin bedeli

**Ölçüm:** 22 Kasım 2026. Yalnız okuma (`getBlock`, `getTransaction`, `getSignaturesForAddress`, `getBlockTime`; hesap, imza, işlem gönderimi, anahtar yok). Etiketler: `[ölç]` zincirden bu oturumda hesaplandı, `[kod]` IDL, `[kendi hesabım]` varsayımlı türetme, `[çıkarım]`.
**Önceki iki rapor:** `tekonay-olcum-tutma.md` (W1, tek pencere), `tekonay-olcum-onayarlar.md` (basamak ön ayarları). Aynı yöntem ve aynı benzetim kullanıldı. W1 bu oturumda yeniden çekilip aynı mantıkla yeniden işlendi ve önceki sayıları tekrarladı: (a) 1-2-3 %81,3; (b1) %77,9 (önceki %77,8, tek anchor farkı); (c) %98,7; (d) %90,5.
**Betikler ve ham veri:** `pano/olcum/` altında: `parse3.mjs` (genişletilmiş blok ayrıştırıcı: ücret ayrıştırma, Jito ipucu, üst düzey program listesi, ücret transferleri, düşen talimatın programı), `blkfetch3.mjs`, `load3.mjs`, `build3.mjs` (pencere başına alım satırları: `rows_W1/W2/W3.json`), `report3.mjs` (tüm tablolar: `rapor3_tablolar.md`, `rapor3.json`), `pool_age3.mjs`, `tipcheck.mjs`, `sigcheck.mjs`, `extra3.mjs`. Ham bloklar: `blk_w1`, `blk_w2`, `blk_w3s`.

## 0. Sonuç (kısa)

1. **Pencereler arası tutarlılık: açılış (a) ve olgun havuz (c) tekrar ediyor; geçiş (b) ve en hacimli havuzlar (d) oynuyor.** %3 tavanlı 1-2-3 merdiveni: (a) **%80,1–81,3** (3 pencere, 27.403 anchor, 705 token; birleşik %95 GA %79,5–81,6); (c) **%98,7–99,4** (52.373 anchor, 1.211 havuz); (d) **%89,6–98,0**; (b) **%77,9–98,9** (pencere başına 4–5 havuz).
2. **"Bıraktıracak gözlem" yine tetiklenmedi:** hiçbir pencerede, hiçbir durumda 1-2-3 merdiveninin tutması %77,9'un altına inmedi. Açılışta tek %3 deneme %67,1–70,8, merdiven +%10–13 puan ekliyor; (c)'de ≈0, (d)'de tek %3'e göre −4…+0 puan.
3. **Elle alım benzeri, 5–500 $ alt kümesinde:** bütün örneklemden **fark yok** (tüm durumlar birleşik: tek %1 %86,0 / %86,1; 1-2-3 %93,1 / %94,0, fark −0,9 puan, GA −2,0…+0,4). **Ama durum içinde var: açılışta (a) %70,2 / %80,1 (−9,9 puan, GA −14,7…−5,8, n=983); olgun havuzda (c) %97,4 / %99,0 (−1,6 puan, GA −2,6…−0,9, n=5.399).** Alt küme alımların %6,4'ü; elle-benzeri sınıf alımların %27,6–34,0'ı, bot-benzeri %55–61.
4. **İlan edilen tolerans gerekenin çok üstünde (kurucunun gözlemi veride doğrulandı):** tolerans çıkarılabilen 71.873 başarılı alımda (alımların %30,7'si) ilan ortanca **%10,2** [çeyrekler %2,4–22,3], gereken ortanca **%0,36** (p90 %8,2). Alımların **%56,8'inde ilan gerekenin 5 katından, %43,5'inde 10 katından fazla** (gereken tabanı %0,5; taban %1 ile %55,6 / %37,5). Elle-benzeri 5–500 $'da ilan ortanca %20,0, gereken %1,1; 5×: %67,7; 10×: %53,1. Pencere bazında 5×: %56,8 / %44,3 / %66,9.
5. **Geniş tolerans tipik alımın fiyatını kötüleştirmiyor; ortalama farkı sıçrama kuyruğu yaratıyor, sandwich değil.** Bireysel alım ortancaları eşit (dar ≤%5: +%0,13; geniş ≥%20: %0,00). Aynı mekân + 10 slot eşleştirmesinde havuzlarda fark sıfır (ortalama +%0,86, GA −0,05…+2,28). Eğrilerde ortalama fark +%5–8 puan, ama geniş alımların **%14,9'u %5'in üstünde (ortalama %30,5) fazla ödemeyle gerçekleşiyor**, yani dar toleranslı alımın zaten alamayacağı sıçramalar (kesilme etkisi). Sandwich payı iki grupta eşit (%0,13 / %0,12). Cümlenin "tolerans üst sınırdır, tipik fiyatı değiştirmez" kısmı **destekleniyor**, "fark sıçramaya razı olmaktan gelir" kısmı **destekleniyor**, "sandwich" kısmı **bu veride desteklenmiyor** (ayrılabilen sandwich %0,13, alt sınır).
6. **Düşen kayma denemesinin bedeli:** tüm düşenlerde toplam ücret ortanca **$0,0004** (135.217 deneme, %82,7'sinde yalnız taban ücret); **elle-benzeri grupta ortanca $0,016, p90 $0,56 (n=362)** çünkü bu gruptaki düşenlerin %96'sı öncelik ücreti ödüyor. **Öncelik ücreti düşen işlemde de tahsil ediliyor** (35/35 örnek işlemde imzacı kaybı = `meta.fee`). **Jito ipucu düşen işlemde tahsil edilmiyor** (ilan ipucu >0 olan 25/25 işlemde ek kayıp yok). Elle-benzeri imzacıların alım denemelerinin yalnız %0,5'i kayma hatasıyla düşüyor (bot-benzeri %50,1).
7. **En büyük kısıtlar:** (i) hafta içi sabah penceresi yapılamadı (RPC erişimi; W3 Cumartesi 08:00 UTC); (ii) tolerans yalnız alımların %30,7'sinde çıkarılabildi (WSOL tabanlı havuzların alımı `sell*` talimatı, parse bunu kaydetmiyor; 171 aktarım ücretli/vergili token mekânı dışarıda) ve (d)/(b) için tolerans sonucu yok; (iii) "elle benzeri" bir davranış kuralıdır, 40 örnekle doğrulandı; (iv) Axiom/Photon/Bloom adları verideki programlara bağlanamadı.

## 1. Pencere seçim kuralı (sonuçlara bakmadan önce yazıldı)

- **Uzunluk ve yöntem W1 ile aynı:** 3.600 slot (≈12,8 dk), `getBlock` full, aynı çapa/merdiven/durum tanımları; "100 dolarlık alım" için SOL fiyatı pencerenin saatinin Binance SOLUSDT saatlik hacim ağırlıklı ortalaması (W1: önceki raporun 70,33 $'ı; W2 68,2 $; W3 67,2 $).
- **Kural:** "bugünden geriye erişebildiğin kadar; W1'den farklı gün ve farklı saat; hafta içi bir akşam ve bir sabah saati UTC." Hedef saat başı `getBlockTime` ikili aramasıyla ilk slota çevrildi.
- **W2 = Cuma 20 Kas 2026 19:00:00 UTC** (hafta içi akşam), slot 471.846.601–471.850.200. 3.587 blok okundu (8 atlanmış, 5 erişilemeyen).
- **W3 için ilk plan = Perşembe 19 Kas 08:00 UTC** (hafta içi sabah, slot 471.261.015–471.264.614). Başlanıp **terk edildi**: bu yaştaki bloklara yalnız `public.rpc.solanavibestation.com` yanıt veriyor (publicnode `-32007` ile "atlanmış" diyor, `api.mainnet-beta`, tatum, pocket sürekli 429); ≈0,3 blok/sn, tam pencere ≈3 saat. Karar sonuç görülmeden verildi (Perşembe verisi hiç işlenmedi).
- **W3 = Cumartesi 21 Kas 2026 08:00:00 UTC** (slot 472.064.043–472.067.642). Yedek kural: "en yakın sabah saati, hızlı uçların tuttuğu aralıkta". 3.600 blok, atlanmış 0. **Hafta içi sabah ölçülemedi.**
- **Üç pencere:** Pazar 22 Kas 15:24 (W1), Cuma 20 Kas 19:00 (W2), Cumartesi 21 Kas 08:00 (W3).
- **Veri bütünlüğü hatası ve düzeltme:** publicnode eski/yarım aralıkta `-32007` döndürüyor (gerçek atlanmış slottan ayırt edilemiyor). W3'te ilk geçişte 296 blok (%8) yanlış "atlanmış" yazılmıştı; hepsi silinip öteki uçlarla yeniden çekildi (üç uç aynı şeyi söylemeden "atlanmış" yazılmıyor). W1 (tek uç, 1 atlanmış, ilk raporla aynı) ve W2 (üç uç oyu) etkilenmedi.
- **(b)** önceki rapordaki (b1): pencerede görülen geçiş havuzları, geçişten sonraki 5 dk (W1 4 havuz, W2 5, W3 4). Önceki raporun (b2)'si (geçiş sonrası ilk 10 sn, 16 havuz) tekrarlanamadı.
- **(c)** her pencere için A−20.000 slot (≈72 dk) önceki referans imzadan önce işlemi olan, ≥3 işlemli havuzlar (W2: 679/782 yaşlı; W3: 300/346), en hacimli 10 hariç. **(d)** pencerede SOL hacmi en yüksek 10 PumpSwap havuzu. **(a)** yaratımdan ≤120 sn.

## 2. İş 1 sonuç özeti (ayrıntılı tablo: Ek A)

| durum | ölçü | W1 Paz 15:24 | W2 Cum 19:00 | W3 Cmt 08:00 | en düşük–en yüksek | birleşik %95 GA |
|---|---|---|---|---|---|---|
| (a) açılış 2 dk (n: 7.950 / 9.652 / 9.801) | 1-2-3 tutma | 81,3% | 80,1% | 80,4% | 80,1–81,3 | 80,6% (79,5–81,6) |
| | 2-3-5 | 83,4% | 82,1% | 82,8% | 82,1–83,4 | 82,7% (81,9–83,7) |
| | 5-10-15 | 90,6% | 88,2% | 88,9% | 88,2–90,6 | 89,1% (88,4–90,0) |
| | 10-20-30 | 95,2% | 93,6% | 94,3% | 93,6–95,2 | 94,3% (93,7–94,9) |
| | tek %3 | 70,8% | 67,1% | 68,2% | 67,1–70,8 | |
| | tek %20 | 91,7% | 89,8% | 89,7% | 89,7–91,7 | |
| | ödenen ort. (kırp.) 1-2-3 / 10-20-30 | 0,10 / 2,06% | 0,07 / 2,19% | 0,10 / 2,21% | 0,07–0,10 / 2,06–2,21 | |
| (b) geçiş 5 dk (anchor, havuz: 303,4 / 2.924,5 / 3.079,4) | 1-2-3 | 77,9% | 84,2% | 98,9% | **77,9–98,9** | 91,1% (80,4–97,9) |
| | 10-20-30 | 96,4% | 99,8% | 100,0% | 96,4–100,0 | |
| | tek %3 | 65,7% | 86,3% | 99,0% | 65,7–99,0 | |
| (c) sıradan ≥70 dk (n: 12.355 / 17.288 / 22.730) | 1-2-3 | 98,7% | 98,7% | 99,4% | 98,7–99,4 | 99,0% (98,7–99,3) |
| | 2-3-5 | 99,3% | 99,3% | 99,7% | 99,3–99,7 | |
| | tek %3 | 98,7% | 98,7% | 99,5% | 98,7–99,5 | |
| (d) üst-10 hacim (n: 13.499 / 24.421 / 9.528) | 1-2-3 | 90,5% | 89,6% | 98,0% | **89,6–98,0** | 91,5% (89,0–94,4) |
| | 5-10-15 | 99,2% | 99,7% | 100,0% | 99,2–100,0 | |
| | tek %3 | 92,7% | 93,3% | 97,7% | 92,7–97,7 | |

- **İlk pencerenin sonuçları tekrar ediyor mu?** (a) ve (c): evet, 0,6–1,2 puan içinde. (d): W1 ≈ W2 (%90), W3 %98. (b): hayır; 4–5 havuzla kararlı sayı çıkmıyor, "%77,9–98,9" yazılabilir, tek sayı yazılamaz.
- **Hangi sayı oynuyor?** (b): anchor'ların çoğu 1–2 havuzdan geliyor ve geçişten sonraki 5 dk havuza bağlı; W1'in 4 havuzu en oynak olanıydı. (d): W3'te en hacimli 10 havuz daha az hareket etmiş (tek %3: %97,7); sabah saati hipotezi `[çıkarım]`, tek pencereyle doğrulanamaz.
- **İniş gecikmesi duyarlılığı (birleşik, 1-2-3, d=2/3/4):** (a) 84,9 / 80,6 / 78,8; (b) 93,3 / 91,1 / 89,7; (c) 99,1 / 99,0 / 98,9; (d) 93,5 / 91,5 / 90,0.
- **Merdiven − tek %3 (aynı birleşik örneklemde):** (a) 80,6 − 68,5 = +12,1 puan; (c) 99,0 − 99,0 = 0; (d) 91,5 − 94,0 = −2,5 (ilk adım %1 olduğundan); (b) 91,1 − 91,5 = −0,4.

## 3. İş 2 sonuç özeti: gerçek kullanıcıya yakın alt küme

**Sınıflandırma kuralı** (imzacı = ücret ödeyen; pencere içi pump/PumpSwap işlemlerinden):
- **Bot benzeri:** pencerede ≥10 pump/PumpSwap işlemi **ya da** aynı slotta ≥2 işlemi **ya da** alımında "özel program" (pencerede <25 farklı imzacının kullandığı bir üst düzey program).
- **Elle alım benzeri:** pencerede ≤3 pump/PumpSwap işlemi, aynı slotta tek işlem, özel program yok.
- **Belirsiz:** geri kalan (4–9 işlem).
- **Gerekçe:** botlar aynı hesaptan yüksek frekansta/aynı slotta çoklu işlem gönderir ve kendi sözleşmesini çağırır; elle alıcı 12,8 dk'da birkaç işlem yapar. Jito ipucu tek başına bot göstergesi sayılmadı (terminallerin "MEV koruması" ayarı da ipucu atar); ayrı sütun.
- **Yönlendirici/terminal işareti (ayrı grup):** alım işleminde paylaşımlı bir yönlendirici program (≥25 farklı imzacı kullanıyor; Jupiter ve Lighthouse hariç) ya da ≥40 farklı imzacının SOL gönderdiği popüler bir ücret hesabı. Alımların %19,2'si (W1 %23,7, W2 %18,4, W3 %16,7). **Axiom/Photon/Bloom adlarını koyamadım**: program ve hesap kimliklerini güvenilir kaynakla doğrulayamadım. Doğrulananlar: `JUP6Lkb…` Jupiter v6; `L2TExMF…` Lighthouse (Phantom cüzdan koruması; [orbmarkets.io](https://orbmarkets.io/address/L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95/history)); `DF1ow4t…` DFlow v4 ([Helius](https://www.helius.dev/parsed-data/dflow/program-v4)). `GMgnVFR8…`, `GMGNreQc…`, `gmgnpkx…` hesabı GMGN olabilir (vanity önek, doğrulanmadı). `6Vo3245esz…` (5.196 imzacı), `FLASHX8Dr…` (5.048), `term9YPb…`, `proVF4pM…`, `KfHbT5J…` ücret hesabı (3.702 imzacı) **etiketlenemedi**.
- **Jito ipucu:** 8 resmi ipucu hesabına sistem transferi; alımların %1,7'sinde (elle-benzeride %1,0).
- **Bağımsız doğrulama:** W2'den her sınıftan 40 imzacı için `getSignaturesForAddress` (son 100 işlem): **elle-benzeri** 17/40 hesapta 100 işlem dolu, bunların 100 işlemi ortanca **48,8 saate** yayılıyor (23/40 hesapta ömür boyu 100'den az işlem var); belirsiz 23/40 dolu, ortanca 9,1 saat; **bot-benzeri** 29/40 dolu, ortanca **1,6 saat**. Kural hesap etkinliğini ayırıyor. Zayıf yer: pencerede ≤3 işlem yapan başka zamanlarda sık işlem yapan hesaplar elle sınıfında kalır (elle sınıfın 17 dolu hesabının p25'i 34,7 saat, p75'i 236,9 saat).
- **Tutar bandı:** SOL tutarı × pencerenin SOL fiyatı.

**Tutma (alımın kendi tutarıyla benzetim; tüm durumlar birleşik, 232.770 anchor):**

| alt küme | n | 1-2-3 | 2-3-5 | tek %1 (dar ilk deneme) | tek %3 |
|---|---|---|---|---|---|
| tümü | 232.770 | 94,0% | 95,8% | 86,1% | 92,9% |
| <5 $ / 5–50 $ / 50–500 $ / >500 $ | 144.648 / 52.790 / 35.026 / 306 | 95,3 / 91,7 / 92,2 / 90,2 | 96,5 / 94,5 / 94,8 / 92,2 | 87,6 / 82,4 / 85,5 / 83,3 | 93,6 / 90,8 / 93,0 / 88,9 |
| elle-benzeri / belirsiz / bot-benzeri | 74.586 / 25.233 / 132.951 | 95,9 / 94,8 / 92,8 | 97,9 / 96,7 / 94,5 | 87,3 / 88,9 / 84,9 | 96,6 / 94,6 / 90,5 |
| **elle ∩ 5–500 $** | 14.976 | **93,1%** | **95,6%** | **86,0%** | 93,6% |
| elle ∩ 5–500 $ ∩ yönlendiricisiz / yönlendirici | 9.910 / 5.066 | 96,7 / 86,1 | 98,4 / 90,1 | 91,9 / 74,5 | 97,7 / 85,5 |
| yönlendirici/terminal (tüm sınıflar) | 44.846 | 87,3 | 90,5 | 75,9 | 84,1 |

**Soru: elle alım benzeri ve 5–500 $ alımlarda dar ilk denemenin tutması bütün örneklemden farklı mı?** (alt küme − bütün, %95 GA mekân kümeli bootstrap)
- **Tüm durumlar birleşik: hayır.** tek %1: %86,0 / %86,1 (fark −0,1 puan, GA −2,5…+2,2); 1-2-3: −0,9 puan (GA −2,0…+0,4); 2-3-5: −0,2 (GA −1,1…+0,7).
- **Durum bazında: açılışta ve olgun havuzda daha kötü, (d) ve (b)'de fark yok.** tek %1 farkı: (a) **−12,7 puan** (%50,4 / %63,1; GA −18,7…−7,7; n=983); (c) **−2,3 puan** (%95,1 / %97,4; GA −3,7…−1,3; n=5.399); (d) +1,3 (GA −7,7…+11,1; n=2.650); (b) −5,4 (GA −19,4…+13,5; n=667, yetersiz).
- **Neden "tümü" farksız görünüyor:** durum bileşimi. Elle∩5–500 alt kümesi (c)'de yoğun (%36), (a)'da %6,6; (a)'daki alımların %87'si bot-benzeri ve (a) zaten en zor durum; elle-benzeri alıcıların payı (a)'da düşük olduğundan bütün ortalama (a)'dan az etkileniyor, alt küme ise (a)'da bütünden belirgin kötü.
- **Açılışta elle-benzeri alıcı neredeyse hep terminalden geliyor:** elle∩5–500∩(a)'nın 900/983'ü yönlendirici/terminal işaretli; yönlendiricisiz yalnız 83 anchor (tutma %51,8, küçük n).
- **Tutar bandı etkisi (a):** <5 $ %82,1; 5–50 $ %80,0; **50–500 $ %61,1** (n=1.774); >500 $ %56,3 (n=32). (c)'de: <5 $ %99,7; 50–500 $ %94,4.
- **Yönlendirici etkisi (aynı durum içinde):** (c)'de elle∩5–500: yönlendiricisiz %98,9 (n=3.986), yönlendirici/terminal %93,0 (n=1.413).
- **Jito ipucu olan elle-benzeri:** (a) %50,0 (n=92), (c) %98,9 (n=471), (d) %97,8 (n=323).

## 4. İş 3 sonuç özeti: ilan edilen tolerans ve gereken

**Çıkarım yöntemi (arayüzde yazılan kayma gibi):** başarılı alımın `buy*` talimat verisinden. **Exact-in** (`buy_exact_quote_in*`, `buy_exact_sol_in`): ilan = 1 − `min_tokens_out` / q_ref; gereken = 1 − gerçekleşen_token / q_ref. **max_cost** (`buy`, `buy_v2/v3`): ilan = `max_sol_cost` / maliyet_ref − 1; gereken = gerçekleşen_maliyet / maliyet_ref − 1. q_ref ve maliyet_ref: alımdan k=3 slot önceki slot-sonu durumunda aynı harcama/miktarla (kullanıcının kotasyonu o anda aldığı varsayımı; k=2/4 duyarlılığı Ek A). Ücret payı: pump olay alanları, PumpSwap'ta sabit %0,3 `[kendi hesabım]`. İlan ≥%99 (exact-in) ya da ≥%200 (max_cost) "korumasız" (%14,1) ve istatistikte %100'e kırpıldı. 
**Güvenilirlik:** `min_out` ve `max_cost` talimat verisinden kesin; belirsiz olan kotasyonun alındığı an. Fiyatı sabit kalan alımlarda (|gereken|<%0,3) ilan değerleri yuvarlak sayılara oturuyor (aşağıda), yani çıkarım orada doğru; fiyatın hareket ettiği alımlarda (açılış) ilan ± birkaç puan oynar. Botlar kotasyonu k=0–1 slotta alır; bot max_cost alımlarının ilanı k=3 varsayımıyla bir miktar büyük görünür.
**Kapsam:** 234.131 başarılı alımın 71.873'ünde (%30,7). Çıkarılamayanlar: WSOL tabanlı havuzlarda alım `sell*` talimatı (`parse3` yalnız `buy*` kaydediyor; en hacimli havuzların çoğu bu türden), ana yol dışı yollar ve 171 mekân (68.312 alım) "aktarım ücretli/vergili token" göstergesiyle çıkarıldı (kasa bakiyesi ile kullanıcıya ulaşan token sürekli farklı; ortanca gereken >%5). **(d) ve (b) için tolerans sonucu yok** (n=624, 61).

**Boşluk (k=3, gereken tabanı %0,5):**

| grup | n | ilan ortanca [çeyrekler] | gereken ortanca / p90 | boşluk ortanca [çeyrekler] | ilan >5× | >10× |
|---|---|---|---|---|---|---|
| tümü | 71.873 | %10,2 [2,4–22,3] | %0,36 / %8,2 | %9,8 [1,7–19,7] | %56,8 | %43,5 |
| (a) açılış | 23.693 | %5,5 [0–35,9] | %0,00 / %15,6 | %1,0 [0–30,0] | %34,9 | %31,4 |
| (c) sıradan | 32.231 | %10,3 [6,0–22,0] | %1,12 / %3,6 | %9,8 [4,8–19,1] | %74,5 | %49,5 |
| exact-in (min_out) | 34.894 | %22,1 [17,8–100] | %0,91 / %10,6 | %19,4 [13,2–89,2] | %78,3 | %54,4 |
| max_cost | 36.979 | %5,1 [0–10,2] | %0,34 / %5,2 | %1,8 [0–9,8] | %36,4 | %33,2 |
| elle-benzeri | 14.660 | %10,8 [5,5–30,7] | %1,76 / %6,9 | %9,8 [2,5–21,0] | %56,0 | %37,7 |
| bot-benzeri | 48.993 | %10,1 [0–22,0] | %0,31 / %9,0 | %6,7 [0–19,3] | %52,5 | %43,8 |
| elle ∩ 5–500 $ | 4.955 | %20,0 [7,8–100] | %1,10 / %8,7 | %14,5 [4,9–87,4] | %67,7 | %53,1 |
| yönlendirici/terminal | 25.054 | %22,9 [9,7–100] | %0,00 / %11,8 | %20,0 [8,0–95,4] | %68,7 | %60,8 |
| yönlendiricisiz | 46.819 | %7,5 [0–21,5] | %0,52 / %4,2 | %4,8 [0–9,9] | %50,4 | %34,2 |
| <5 $ / 5–50 $ / 50–500 $ | 48.277 / 18.938 / 4.555 | %10,2 / 10,2 / 21,9 | %0,36 / 0,39 / 0,92 | | %57,0 / 53,4 / 68,1 | %42,2 / 43,9 / 55,0 |

- **Kurucunun gözlemi ("%3 girer, aslında %1'dir"):** olgun havuzlarda (c) ortanca ilan %10,3, ortanca gereken %1,1; açılışta kesin sonuç zayıf (ortanca ilan %5,5 ama p90 gereken %15,6, kuyruk geniş).
- **k duyarlılığı (5×):** k=2 %57,7 / k=3 %56,8 / k=4 %56,0. Pencere bazında (5×): W1 %56,8; W2 %44,3; W3 %66,9 (ilan ortancası %10,1 / %8,5 / %12,3).
- **Sınırlama:** "gereken" yalnız **başarılı** alımlarda ölçülebilir (düşenler tolerans yetersizliğiyle reddedildi); dağılım hayatta kalanlarındır, gerçek gereken biraz daha yüksek.

**İlan edilen tolerans dağılımı** (fiyatı sabit kalan 19.199 alım; hücre ±0,5 puan içindeki pay, %):

| grup | n | %1 | %2 | %3 | %5 | %10 | %15 | %20 | %25 | %30 | %40 | %50 | <%0,5 | korumasız (min_out≈0) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tümü | 19.199 | 1,0 | 3,5 | 1,2 | 2,4 | 2,8 | 0,9 | **9,5** | 0,9 | 1,5 | 1,4 | 1,4 | 47,3 | 18,0 |
| yönlendirici/terminal | 9.602 | 1,3 | 7,1 | 2,0 | 3,0 | 5,4 | 1,8 | **19,0** | 1,5 | 2,9 | 2,7 | 2,8 | 5,1 | **30,1** |
| yönlendiricisiz | 9.597 | 0,7 | 0,0 | 0,3 | 1,8 | 0,2 | 0,1 | 0,0 | 0,2 | 0,1 | 0,0 | 0,0 | **89,6** | 5,9 |
| elle-benzeri | 2.862 | 2,1 | **21,5** | 5,6 | 6,4 | 4,5 | 1,3 | 9,3 | 0,7 | 3,3 | 1,2 | 0,7 | 3,8 | 26,8 |
| bot-benzeri | 14.600 | 0,5 | 0,2 | 0,2 | 1,7 | 2,3 | 0,8 | 8,0 | 0,9 | 0,8 | 1,4 | 1,5 | 60,7 | |

- **%20 yığılması var ve yönlendirici/terminal işaretli alımlarda belirgin (%19,0); elle-benzeride %2 modu daha belirgin (%21,5).** Pencere bazında %20 payı: W1 %8,9, W2 %7,8, W3 %11,9. **Axiom ve Photon varsayılanıyla uyumu: uyumlu ama kanıtlanamaz.** Photon için tek üçüncü taraf kaynak "varsayılan maks. kayma %20" diyor (arama sonucu özeti, resmi doküman değil; Axiom için kaynak bulunamadı); veride programları adlandıramadığım için %20 modunu bir terminale bağlayamıyorum `[çıkarım]`.
- **Korumasız (min_out ≈ 0) yığılması büyük:** yönlendirici/terminal alımlarının **%30,1'i**, elle-benzerilerin %26,8'i (tümünde %18,0). İlanı fiilen %100 kayma olan bu alımlar yürütmeyi sandwich'e açık bırakıyor.
- **Yönlendiricisiz grup bot stili:** %89,6'sı <%0,5 (botlar kotasyonu kendi simülasyonundan alır), bunlar `max_cost` türü.
- **%1, %3, %5, %10, %15, %25, %30, %50:** belirgin yığılma yok (tümü %0,9–2,8); öne çıkan yuvarlak değerler %20, %2, %10, %5. "Herhangi bir yuvarlak değere ±0,5 puan": tümü %26,5; yönlendirici/terminal %49,6; elle %56,4.

**Geniş tolerans gerçekten daha pahalıya mı aldırıyor?** Eşleştirme: aynı mekân, aynı N slotluk aralık; dar = ilan ≤%5, geniş = ilan ≥%20; aralık başına ortalamaların farkı (geniş − dar), ağırlıklı ortalama, aralık bootstrap'iyle GA.
- **Bireysel alım ortancaları eşit:** dar (n=20.891) o3 ortanca +%0,13, geniş (n=27.878) %0,00. Sandwich payı: dar %0,13, geniş %0,12.
- **Havuzlarda fark yok:** 3 slot +%1,13 (GA −0,08…+3,46; 90 aralık), 10 slot +%0,86 (GA −0,05…+2,28; 143 aralık).
- **Eğrilerde ortalama fark pozitif:** o3 ölçüsü 3 slotta **+%5,26** (GA +4,41…+6,10; 2.129 aralık), 10 slotta **+%7,95** (GA +7,15…+8,69; 3.596 aralık). Ortak zeminde yürütme fiyatı ölçüsü (log): +%1,64 / +%2,09.
- **Bu farkın kaynağı kuyruk ve kesilme:** geniş alımların **%14,9'u %5'in üstünde fazla ödemeyle gerçekleşti (ortalama %30,5)**; dar toleranslı alım bu fiyatla yürütülemezdi (düşerdi), yani dar grup yalnız ≤%5 gerçekleşenleri içerir. Kesilmeyi hafifleten süzgeç (ilanın k=1 ve k=3'te aynı gruba düşmesi): 3 slotta +%0,67 (GA −0,04…+1,37), 10 slotta **−%1,86** (GA −2,68…−1,03); bot hariç ∩ aynı grup: +%2,40 / +%2,72 (GA 1,28…3,88; 76 / 133 aralık, ortanca +%0,06…+0,12). Yani işaret ve büyüklük koşullamaya bağlı; tek bir sayı çıkmıyor.
- **Cümlenin sınaması** ("tolerans yalnız bir üst sınırdır, dürüst yürütmede fiyatı değiştirmez; farkı sandwich ve fiyat sıçramasına razı olmak yaratır"): tipik alım ve havuzlar için **destekleniyor**; "sıçramaya razı olmak" **destekleniyor** (geniş alımların %14,9'u ortalama %30,5 fazla ödeme); "sandwich" **bu veride desteklenmiyor** (ayrılabilen sandwich %0,13 ve iki grupta eşit; ama bu alt sınır).

**Sandwich kurbanlarının ilan ettiği tolerans** (toleransı çıkarılabilen 66 kurban; toplam 294 kurban; alt sınır: aynı slot, aynı imzacı al–sat):

| dilim | alım | kurban | /10.000 (Wilson %95) | Bitquery dilimi /10.000 (önceki rapor) |
|---|---|---|---|---|
| ≤%3 | 19.150 | 26 | 13,6 (9,3–19,9) | 8 |
| %3–10 | 11.291 | 5 | 4,4 (1,9–10,4) | 44 |
| %10–20 | 13.553 | 1 | 0,7 (0,1–4,2) | 87 |
| >%20 | 27.878 | 34 | 12,2 (8,7–17,0) | 148 |

- **Bitquery'nin dilim oranlarını bu örneklemde yeniden üretebiliyor muyum: hayır.** Oran toleransla artmıyor (≤%3 ve >%20 aynı seviyede, ortadaki dilimler düşük) ve mutlak değerler Bitquery'den düşük; ayrılabilen sandwich alt sınır, dilim/evren tanımı farklı olabilir, 66 kurban dilim başına yetmiyor. Kurbanların ilan ortancası %22,3 [0–62,9], sandwichsiz alımlarda %10,2.

## 5. İş 4 sonuç özeti: düşen denemenin bedeli

**Tanım:** kayma hatasıyla düşen alım = hata kodu (pump 6002/6042, PumpSwap 6004/6040) ve işlemde o programın alım talimatı bulunması; 135.217 deneme (74.471'i doğrudan o programdan; 60.746'sı yönlendirici/bot programı içinden düşüyor, orada 6xxx kodları programlar arası çakışabilir, yani üst sınır). **Düşme oranı** (düşen / (düşen + başarılı), alım başına): W1 %35,1; W2 %44,9; W3 %19,9. Sınıfa göre: elle-benzeri **%0,5** (362 / 75.396), belirsiz %1,7 (450 / 25.823), bot-benzeri **%50,1** (134.405 / 268.129).

| grup | n | taban $ ort. | öncelik ücreti $ ortanca / p90 | **toplam ücret $ ortanca / p90** | ilan Jito ipucu olan | öncelik >0 olan |
|---|---|---|---|---|---|---|
| tümü | 135.217 | 0,00034 | 0,00007 / 0,00162 | **0,00041 / 0,00196** | %11,4 | %87,0 |
| (a) açılış | 24.836 | 0,00034 | 0,00002 / 0,00162 | 0,00038 / 0,00198 | %17,7 | %82,4 |
| (b) geçiş | 9.587 | 0,00034 | 0,00000 / 0,00046 | 0,00034 / 0,00081 | %0 | %100 |
| (c) sıradan | 2.714 | 0,00035 | 0,00001 / 0,00176 | 0,00036 / 0,00211 | %0,9 | %99,7 |
| (d) üst-10 | 27.239 | 0,00035 | 0,00002 / 0,00044 | 0,00037 / 0,00078 | %0 | %95,9 |
| pump eğrisi / PumpSwap | 51.802 / 83.415 | 0,00034 | 0,00001 / 0,00014 | 0,00035 / 0,00049 | %29,7 / %0,1 | %70,3 / %97,3 |
| bot-benzeri | 134.405 | 0,00034 | 0,00007 / 0,00161 | 0,00041 / 0,00195 | %11,5 | %87,0 |
| **elle-benzeri** | **362** | 0,00035 | **0,01558 / 0,56264** | **0,01591 / 0,56299** | %4,4 | %95,9 |
| elle ∩ yönlendirici/terminal | 178 | 0,00035 | 0,00974 / 0,34100 | 0,01009 / 0,34134 | %6,7 | %99,4 |
| elle ∩ yönlendiricisiz | 184 | 0,00034 | 0,05654 / 0,70330 | 0,05690 / 0,70365 | %2,2 | %92,4 |
| elle ∩ açılış (a) | 203 | 0,00034 | 0,04396 / 0,70330 | 0,04431 / 0,70365 | %7,9 | %99,5 |

- **"Elle alım benzeri" grupta düşen bir denemenin tipik bedeli ≈ $0,016 (ortanca), p90 $0,56, ortalama $0,36 (n=362).** Pencere bazında ortanca: W1 $0,018, W2 $0,009, W3 $0,041. Botta ortanca $0,0004 (yalnız taban ücret). Fark, elle-benzeri hesapların ücretinin %98'inin öncelik ücreti olmasından (yüksek öncelik ayarı). Küçük n ve ayar çeşitliliği (ortanca 1,6 sent, her 10 düşüşten biri ≥56 sent) nedeniyle aralık geniş.
- **Öncelik ücreti düşen işlemde de tahsil ediliyor `[ölç]`:** `getTransaction` ile 35 düşen kayma işleminde (25'i ilan Jito ipucu >0; 10'u öncelik ücreti 120.300–1.100.000 lamport) imzacı bakiyesi düşüşü **tam `meta.fee`** (35/35, fark 0); `meta.fee` taban + öncelik ücretini içeriyor. **İlan edilen Jito ipucu düşen işlemde tahsil edilmiyor** (25/25: ek kayıp yok; başarısız işlemde ipucu transferi geri alınıyor). Geniş örneklemde de aynı: düşen kayma denemelerinin %87,0'ında `fee − 5000×imza` > 0. Kanıt dosyası: `pano/olcum/tipcheck_rows_test_json.json`.
- **Düşenlerin %82,7'sinde toplamın ortancası "yalnız taban ücret" (5.000 lamport/imza)**; maliyet kuyruğu öncelik ücretinden.

## 6. Kısıtlar ve doğrulanamayanlar

1. **Hafta içi sabah penceresi yok** (§1): üç pencere Pazar 15:24, Cuma 19:00, Cumartesi 08:00 UTC; hepsi 19–22 Kas 2026 haftasında (SOL 67–70 $). Asya/ABD saatleri ve farklı haftalar ölçülmedi.
2. **Elle benzeri bir sınıftır, kimlik değil.** 40 örnekle doğrulandı; pencerede az işlem yapan botlar elle sınıfına girebilir. Elle sınıf alımların %27,6–34,0'ı; alım ortanca tutarı 1,1–1,9 $.
3. **Terminal/yönlendirici adlandırılamadı** (Axiom, Photon, Bloom, Trojan, GMGN program ve ücret hesabı eşleştirmesi güvenilir kaynakla doğrulanamadı); işaret yapısal, adlı değil. `[doğrulanamadı]`.
4. **Tolerans çıkarımı alımların %30,7'sinde**; WSOL tabanlı havuzlar ve 171 aktarım ücretli/vergili token mekânı dışarıda; (d), (b) için tolerans sonucu yok. İlan k=3 kotasyon varsayımına bağlı.
5. **"Gereken" yalnız başarılı alımda ölçülebilir** (hayatta kalma yanlılığı).
6. **Eşleştirilmiş karşılaştırma kesilme etkisi taşır;** elle-benzeri alt kümede eşleşen aralık yetersiz (3 slotta 16, 10 slotta 35).
7. **Sandwich ayrımı alt sınır** (aynı slot, aynı imzacı al–sat): %0,097–0,140; Jito paketleri ve çok imzacılı yapıları yakalamıyor.
8. **Düşenlerde yönlendirici içinden düşen 60.746 işlem kod çakışması riski taşıyor** (üst sınır). Düşen alımın durumu yalnız mekânın pencere içi işlem geçmişiyle belirlenebildi: %57,5'i durumsuz.
9. **Başarısız alım oranı pencereye çok duyarlı** (%19,9–44,9); tek sayı yazılamaz.
10. **Axiom/Photon %20 varsayılanı:** yalnız bir üçüncü taraf blog (Photon); Axiom kaynağı yok.
11. **(b2)** (geçiş sonrası ilk 10 sn, 16 havuz) tekrarlanamadı.
12. **Önceki rapordaki "tolerans" proxy'si** (`qtok/min_out − 1`, %25 modu) yerine bu raporda arayüz kayma tanımı kullanıldı; sayılar kıyaslanamaz.

## 7. README'ye girebilecek sayılar (en çok sekiz)

1. **"Yeni çıkan tokenda (ilk 2 dk) %1-2-3 merdiveni alımların %80–81'ini tutturuyor; tek %3 deneme %67–71'ini":** 3 pencere, 27.403 alım, 705 token; pencereler arası %80,1–81,3 (birleşik GA %79,5–81,6). Zayıf: alımların %87'si bot; elle-benzeri 5–500 $ alıcıda yalnız %70,2.
2. **"Olgun havuzda (≥70 dk) tek %3 deneme zaten %98,7–99,5 tutuyor; merdiven ≈0 ekliyor":** 52.373 alım, 1.211 havuz, 3 pencere. Zayıf: yaş ≥72 dk referansı; elle-benzeri 5–500 $ %97,4 (−1,6 puan).
3. **"En hacimli 10 havuzda 1-2-3 merdiveni %90–98, 5-10-15 %99,2–100 tutuyor":** 47.448 alım, 30 havuz. Zayıf: pencere aralığı geniş (W3 %98, W1–W2 %90); seçim hacme göre.
4. **"Eğriden havuza geçişten sonraki 5 dk'da 1-2-3 %78–99 tutuyor":** 13 havuz, pencere başına 4–5; tek sayı yazılamaz (sayı oynuyor).
5. **"Kullanıcıların girdiği tolerans, alımın gerektirdiğinin ortalama 5 katından büyük: alımların %57'sinde >5×, %44'ünde >10× (ortanca ilan %10, ortanca gereken %0,4)":** 71.873 başarılı alım (alımların %30,7'si); pencere bazında >5×: %44,3–66,9. Zayıf: çıkarım k=3 kotasyon varsayımına bağlı; yalnız başarılı alımlar; WSOL tabanlı havuzlar dışarıda.
6. **"Yönlendirici/terminalden gelen alımların %30'u korumasız (min_out≈0), %19'u tam %20 kayma ile gönderiliyor":** fiyatı sabit kalan 9.602 alım. Zayıf: terminal adı doğrulanamadı; yalnız talimatı çözülebilen alımlar.
7. **"Geniş tolerans tipik alımın fiyatını kötüleştirmiyor (ortanca fark ≈0, havuzlarda ortalama da ≈0); fark geniş toleranslı alımların %15'inde %5'in üstündeki sıçramadan geliyor, sandwich'ten değil (%0,13)":** 3 pencere, 20.891 dar / 27.878 geniş alım. Zayıf: kesilme etkisi; sonuç koşullamaya bağlı; havuz alt kümesi 90–143 aralık.
8. **"Kayma hatasıyla düşen bir alım botta $0,0004, elle-benzeri kullanıcıda ortanca $0,016 (p90 $0,56); öncelik ücreti düşende de tahsil edilir, Jito ipucu edilmez":** düşen 135.217 (elle-benzeri 362), 35 işlemlik doğrudan kanıt. Zayıf: elle-benzeri n küçük; ücret ayarına bağlı; düşme oranı pencerelerde %20–45.

## 8. Önceki raporlarda değişen sayılar

| önceki rapor / sayı | bu raporda | durum |
|---|---|---|
| tutma §0: (b) %75,5 (b2, 16 havuz, ilk 10 sn) / %77,8 (b1) | (b1) W1 %77,9; W2 %84,2; W3 %98,9; **%77,9–98,9** | tek pencerenin sayısı olarak yazılmamalı |
| (d) en hacimli 10: %90,5 | **%89,6–98,0** | aralık genişledi |
| (a): %81,3 | **%80,1–81,3** | tekrarlandı |
| (c): %98,7 | **%98,7–99,4** | tekrarlandı |
| alım ortanca tutarı 0,026 SOL ≈ 1,8 $ | W1 1,83 $; W2 1,88 $; W3 **1,08 $** | W3 daha küçük |
| sandwich %0,13 (alt sınır) | W1 0,133; W2 0,140; W3 **0,097**; birleşik 0,126 | tekrarlandı |
| düşme: pump %6,2, PumpSwap %26,7 (alım içeren işlemde kayma kodlu) | düşen/(düşen+başarılı) W1 %35,1, W2 %44,9, W3 %19,9 | tanım ve pencereye bağlı; tek sayı yok |
| onayarlar: Normal alım 2-3-5 (c) %99,3 | **%99,3–99,7** | tekrarlandı |
| onayarlar: Hızlı alım 5-10-15 (d) %99,2 | **%99,2–100,0** | tekrarlandı |
| onayarlar: Açılış avı 10-20-30 (a) %95,2 | **%93,6–95,2** | W1 en yüksek |
| onayarlar: Açılış avı 10-20-30 (b) %96,4–96,6 | **%96,4–100,0** (b1) | tekrarlandı |
| onayarlar: merdiven tek %20'den (a) +3,5 puan fazla tutuyor | W1 +3,5; W2 +3,8; W3 +4,6 | tekrarlandı |
| kısıt "tek pencere" | üç pencere (biri hafta içi akşam) | kısmen kapandı; hafta içi sabah yok |
| kısıt "alımların çoğu bot, perakende ölçülmedi" | elle-benzeri alt küme ölçüldü (alımların %28–34'ü; 5–500 $ ∩ elle %6,4) | kısmen kapandı |
| önceki tolerans proxy'si (`qtok/min_out − 1`, "%25" modu) | arayüz kayma tanımı (1 − min_out/q_ref), "%20" modu | tanım değişti, kıyaslanamaz |

## 9. Doğrulanamayanlar ve ikinci deneme planı

1. **Terminal adlandırması:** resmi doküman/GitHub/Solscan etiketinden program ve ücret hesabı doğrula (giriş gerekebilir); ya da cüzdanda test işlemi (test gerekli).
2. **WSOL tabanlı havuzlarda tolerans:** `parse3`'e `sell`/`sell_v2` talimatlarını ekleyip W1 ve W3'ü (hızlı uç) yeniden çek (≈25 dk/pencere); W2 yavaş uçla ≈1 saat.
3. **Hafta içi sabah penceresi:** Salı–Çarşamba 08:00 UTC veya Perşembe 19 Kas (yavaş uç ≈3 saat); hızlı uçlar bu yaşa yetişmiyor.
4. **Elle-benzeri sınıf doğrulaması:** daha büyük hesap yaşı örneklemi (bugün 40/sınıf).
5. **Geniş tolerans karşılaştırmasında kesilmeyi kaldırma:** düşen denemelerin talimat verisini (bugün `a2` kayıtlı, ref durumu yok) başarılı denemelerle eşleştir; aynı imzacının dar denemesi düşüp geniş denemesi tutan çiftler.
6. **Sandwich yeniden üretimi:** çok slotlu / çok imzacılı sandwich ayrımı (Jito paketi).
7. **Etkinlik öncesi test listesi adayları (hesap gerektiren, "test gerekli"):** gerçek cüzdanda tek onayla merdiven denemesi (Transaction v1/durum-nonce, bir slotta dört işlem); başarısız denemede öncelik ücretinin tahsili; dar tolerans + yüksek öncelik ayarının düşen bedeline etkisi.

---

# Ek A · Ayrıntılı tablolar (otomatik üretildi: `pano/olcum/report3.mjs`, girdi `rows_W1/W2/W3.json`)

## İş 1 · Pencere başına merdiven tablosu (X = 100 $, iniş gecikmesi d = 3 slot)
Hücre: tutma oranı / tutanlarda P0'a göre ödenen ortalama fazla ödeme (düşüş 0 sayılır, "kırp."). n = çapa alım sayısı (mekân sayısı).

### (a) açılış 2 dk
| pencere | n (mekân) | 1-2-3 | 2-3-5 | 5-10-15 | 10-20-30 | tek %2 | tek %3 | tek %5 | tek %10 | tek %20 |
|---|---|---|---|---|---|---|---|---|---|---|
| W1 | 7950 (222) | 81.3% / 0.10% | 83.4% / 0.22% | 90.6% / 0.96% | 95.2% / 2.06% | 68.4% / 0.11% | 70.8% / 0.19% | 75.1% / 0.40% | 81.7% / 0.95% | 91.7% / 2.45% |
| W2 | 9652 (261) | 80.1% / 0.07% | 82.1% / 0.16% | 88.2% / 0.89% | 93.6% / 2.19% | 65.3% / 0.08% | 67.1% / 0.14% | 70.5% / 0.33% | 78.7% / 1.07% | 89.8% / 2.73% |
| W3 | 9801 (222) | 80.4% / 0.10% | 82.8% / 0.22% | 88.9% / 0.94% | 94.3% / 2.21% | 65.9% / 0.12% | 68.2% / 0.19% | 71.6% / 0.38% | 78.9% / 1.02% | 89.7% / 2.66% |
| hepsi | 27403 (705) | 80.6% / 0.09% | 82.7% / 0.20% | 89.1% / 0.93% | 94.3% / 2.16% | 66.4% / 0.10% | 68.5% / 0.17% | 72.2% / 0.37% | 79.6% / 1.02% | 90.3% / 2.62% |
| **aralık (n≥100 pencereler: W1,W2,W3)** | | 80.1%–81.3% | 82.1%–83.4% | 88.2%–90.6% | 93.6%–95.2% | 65.3%–68.4% | 67.1%–70.8% | 70.5%–75.1% | 78.7%–81.7% | 89.7%–91.7% |
| **kırp. ödeme aralığı** | | 0.07%–0.10% | 0.16%–0.22% | 0.89%–0.96% | 2.06%–2.21% | 0.08%–0.12% | 0.14%–0.19% | 0.33%–0.40% | 0.95%–1.07% | 2.45%–2.73% |

### (b) geçiş 5 dk
| pencere | n (mekân) | 1-2-3 | 2-3-5 | 5-10-15 | 10-20-30 | tek %2 | tek %3 | tek %5 | tek %10 | tek %20 |
|---|---|---|---|---|---|---|---|---|---|---|
| W1 | 303 (4) | 77.9% / 0.08% | 80.5% / 0.21% | 93.4% / 1.53% | 96.4% / 2.32% | 63.4% / 0.03% | 65.7% / 0.12% | 73.6% / 0.54% | 86.1% / 1.52% | 96.4% / 2.79% |
| W2 | 2924 (5) | 84.2% / 0.32% | 92.6% / 0.59% | 99.5% / 1.15% | 99.8% / 1.26% | 74.9% / 0.48% | 86.3% / 0.74% | 96.2% / 1.05% | 98.5% / 1.18% | 99.4% / 1.30% |
| W3 | 3079 (4) | 98.9% / 0.14% | 99.2% / 0.15% | 99.9% / 0.21% | 100.0% / 0.22% | 98.5% / 0.13% | 99.0% / 0.14% | 99.4% / 0.16% | 99.7% / 0.18% | 100.0% / 0.21% |
| hepsi | 6306 (13) | 91.1% / 0.21% | 95.2% / 0.35% | 99.4% / 0.70% | 99.7% / 0.80% | 85.9% / 0.27% | 91.5% / 0.40% | 96.6% / 0.58% | 98.5% / 0.70% | 99.5% / 0.83% |
| **aralık (n≥100 pencereler: W1,W2,W3)** | | 77.9%–98.9% | 80.5%–99.2% | 93.4%–99.9% | 96.4%–100.0% | 63.4%–98.5% | 65.7%–99.0% | 73.6%–99.4% | 86.1%–99.7% | 96.4%–100.0% |
| **kırp. ödeme aralığı** | | 0.08%–0.32% | 0.15%–0.59% | 0.21%–1.53% | 0.22%–2.32% | 0.03%–0.48% | 0.12%–0.74% | 0.16%–1.05% | 0.18%–1.52% | 0.21%–2.79% |

### (c) sıradan ≥70 dk
| pencere | n (mekân) | 1-2-3 | 2-3-5 | 5-10-15 | 10-20-30 | tek %2 | tek %3 | tek %5 | tek %10 | tek %20 |
|---|---|---|---|---|---|---|---|---|---|---|
| W1 | 12355 (305) | 98.7% / 0.05% | 99.3% / 0.07% | 99.7% / 0.10% | 99.9% / 0.14% | 98.2% / 0.03% | 98.7% / 0.05% | 99.3% / 0.07% | 99.7% / 0.10% | 99.8% / 0.12% |
| W2 | 17288 (623) | 98.7% / 0.04% | 99.3% / 0.06% | 99.7% / 0.10% | 99.9% / 0.13% | 98.2% / 0.03% | 98.7% / 0.04% | 99.3% / 0.06% | 99.6% / 0.09% | 99.8% / 0.11% |
| W3 | 22730 (283) | 99.4% / 0.05% | 99.7% / 0.06% | 99.9% / 0.07% | 100.0% / 0.09% | 99.2% / 0.04% | 99.5% / 0.05% | 99.7% / 0.06% | 99.9% / 0.07% | 99.9% / 0.07% |
| hepsi | 52373 (1211) | 99.0% / 0.04% | 99.5% / 0.06% | 99.8% / 0.09% | 99.9% / 0.11% | 98.6% / 0.04% | 99.0% / 0.05% | 99.5% / 0.06% | 99.7% / 0.08% | 99.9% / 0.10% |
| **aralık (n≥100 pencereler: W1,W2,W3)** | | 98.7%–99.4% | 99.3%–99.7% | 99.7%–99.9% | 99.9%–100.0% | 98.2%–99.2% | 98.7%–99.5% | 99.3%–99.7% | 99.6%–99.9% | 99.8%–99.9% |
| **kırp. ödeme aralığı** | | 0.04%–0.05% | 0.06%–0.07% | 0.07%–0.10% | 0.09%–0.14% | 0.03%–0.04% | 0.04%–0.05% | 0.06%–0.07% | 0.07%–0.10% | 0.07%–0.12% |

### (d) üst-10 hacim
| pencere | n (mekân) | 1-2-3 | 2-3-5 | 5-10-15 | 10-20-30 | tek %2 | tek %3 | tek %5 | tek %10 | tek %20 |
|---|---|---|---|---|---|---|---|---|---|---|
| W1 | 13499 (10) | 90.5% / 0.22% | 94.9% / 0.36% | 99.2% / 0.66% | 99.8% / 0.76% | 88.1% / 0.25% | 92.7% / 0.36% | 96.9% / 0.51% | 99.1% / 0.65% | 99.6% / 0.71% |
| W2 | 24421 (10) | 89.6% / 0.27% | 95.2% / 0.44% | 99.7% / 0.71% | 99.9% / 0.74% | 87.8% / 0.34% | 93.3% / 0.46% | 98.1% / 0.63% | 99.7% / 0.72% | 99.9% / 0.75% |
| W3 | 9528 (10) | 98.0% / 0.18% | 99.6% / 0.28% | 100.0% / 0.36% | 100.0% / 0.37% | 93.5% / 0.19% | 97.7% / 0.29% | 99.8% / 0.36% | 100.0% / 0.37% | 100.0% / 0.37% |
| hepsi | 47448 (30) | 91.5% / 0.23% | 96.0% / 0.38% | 99.6% / 0.63% | 99.9% / 0.67% | 89.0% / 0.28% | 94.0% / 0.40% | 98.1% / 0.54% | 99.6% / 0.63% | 99.8% / 0.66% |
| **aralık (n≥100 pencereler: W1,W2,W3)** | | 89.6%–98.0% | 94.9%–99.6% | 99.2%–100.0% | 99.8%–100.0% | 87.8%–93.5% | 92.7%–97.7% | 96.9%–99.8% | 99.1%–100.0% | 99.6%–100.0% |
| **kırp. ödeme aralığı** | | 0.18%–0.27% | 0.28%–0.44% | 0.36%–0.71% | 0.37%–0.76% | 0.19%–0.34% | 0.29%–0.46% | 0.36%–0.63% | 0.37%–0.72% | 0.37%–0.75% |

### Pencereler birleşik, %95 güven aralığı (mekân kümeli bootstrap), tutma
| durum | 1-2-3 | 2-3-5 | 5-10-15 | 10-20-30 | tek %3 | tek %20 |
|---|---|---|---|---|---|---|
| (a) açılış 2 dk n=27403 | 80.6% (79.5%–81.6%) | 82.7% (81.9%–83.7%) | 89.1% (88.4%–90.0%) | 94.3% (93.7%–94.9%) | 68.5% (67.5%–69.7%) | 90.3% (89.3%–91.3%) |
| (b) geçiş 5 dk n=6306 | 91.1% (80.4%–97.9%) | 95.2% (86.7%–98.6%) | 99.4% (96.1%–100.0%) | 99.7% (98.2%–100.0%) | 91.5% (74.4%–97.7%) | 99.5% (97.0%–100.0%) |
| (c) sıradan ≥70 dk n=52373 | 99.0% (98.7%–99.3%) | 99.5% (99.3%–99.6%) | 99.8% (99.7%–99.9%) | 99.9% (99.9%–100.0%) | 99.0% (98.7%–99.3%) | 99.9% (99.8%–99.9%) |
| (d) üst-10 hacim n=47448 | 91.5% (89.0%–94.4%) | 96.0% (94.4%–97.8%) | 99.6% (99.4%–99.9%) | 99.9% (99.9%–100.0%) | 94.0% (91.6%–96.6%) | 99.8% (99.7%–100.0%) |

### İniş gecikmesi duyarlılığı (birleşik), 1-2-3 ve 10-20-30 tutma, d = 2 / 3 / 4 slot
| durum | 1-2-3 d2 / d3 / d4 | 10-20-30 d2 / d3 / d4 |
|---|---|---|
| (a) açılış 2 dk | 84.9% / 80.6% / 78.8% | 95.8% / 94.3% / 93.1% |
| (b) geçiş 5 dk | 93.3% / 91.1% / 89.7% | 99.9% / 99.7% / 99.7% |
| (c) sıradan ≥70 dk | 99.1% / 99.0% / 98.9% | 99.9% / 99.9% / 99.9% |
| (d) üst-10 hacim | 93.5% / 91.5% / 90.0% | 99.9% / 99.9% / 99.9% |

## İş 2 · Alt kümeler (3 pencere birleşik; merdiven, anchor alımın KENDİ tutarıyla, kendi büyüklüğünde alım olarak simüle)

### Tüm durumlar, kendi tutarıyla
| alt küme | n | pay | 1-2-3 | 2-3-5 | 10-20-30 | tek %1 (dar ilk deneme) | tek %3 | tek %20 | kırp. ort. ödeme (2-3-5) |
|---|---|---|---|---|---|---|---|---|---|
| tümü | 232770 | 100.0% | 94.0% | 95.8% | 98.9% | 86.1% | 92.9% | 98.0% | 0.20% |
| <5 $ | 144648 | 62.1% | 95.3% | 96.5% | 98.8% | 87.6% | 93.6% | 97.9% | 0.17% |
| 5–50 $ | 52790 | 22.7% | 91.7% | 94.5% | 98.9% | 82.4% | 90.8% | 97.9% | 0.26% |
| 50–500 $ | 35026 | 15.0% | 92.2% | 94.8% | 99.2% | 85.5% | 93.0% | 98.7% | 0.21% |
| >500 $ | 306 | 0.1% | 90.2% | 92.2% | 97.4% | 83.3% | 88.9% | 95.8% | 0.24% |
| elle-benzeri | 74586 | 32.0% | 95.9% | 97.9% | 99.8% | 87.3% | 96.6% | 99.7% | 0.24% |
| bot-benzeri | 132951 | 57.1% | 92.8% | 94.5% | 98.3% | 84.9% | 90.5% | 96.9% | 0.18% |
| belirsiz | 25233 | 10.8% | 94.8% | 96.7% | 99.6% | 88.9% | 94.6% | 99.1% | 0.19% |
| elle ∩ 5–500 $ | 14976 | 6.4% | 93.1% | 95.6% | 99.1% | 86.0% | 93.6% | 98.8% | 0.23% |
| elle ∩ 5–500 $ ∩ yönlendiricisiz | 9910 | 4.3% | 96.7% | 98.4% | 99.7% | 91.9% | 97.7% | 99.6% | 0.16% |
| elle ∩ 5–500 $ ∩ yönlendirici/terminal | 5066 | 2.2% | 86.1% | 90.1% | 98.1% | 74.5% | 85.5% | 97.2% | 0.40% |
| elle ∩ Jito ipucu var | 1064 | 0.5% | 93.2% | 94.9% | 97.3% | 89.2% | 93.9% | 97.0% | 0.16% |
| yönlendirici/terminal (tüm sınıflar) | 44846 | 19.3% | 87.3% | 90.5% | 97.7% | 75.9% | 84.1% | 95.7% | 0.30% |
| Lighthouse (Phantom koruması) var | 1159 | 0.5% | 74.5% | 79.8% | 96.9% | 55.1% | 67.0% | 94.8% | 0.55% |
| bot ∩ 5–500 $ | 56759 | 24.4% | 91.0% | 93.9% | 98.8% | 82.0% | 90.6% | 97.8% | 0.25% |

### Tüm durumlar, X = 100 $ sabit (karşılaştırma)
| alt küme | n | pay | 1-2-3 | 2-3-5 | 10-20-30 | tek %1 (dar ilk deneme) | tek %3 | tek %20 | kırp. ort. ödeme (2-3-5) |
|---|---|---|---|---|---|---|---|---|---|
| tümü | 232770 | 100.0% | 94.1% | 95.9% | 99.2% | 86.3% | 93.1% | 98.6% | 0.20% |
| <5 $ | 144648 | 62.1% | 95.4% | 96.7% | 99.2% | 87.8% | 93.9% | 98.7% | 0.18% |
| 5–50 $ | 52790 | 22.7% | 91.8% | 94.6% | 99.0% | 82.5% | 90.9% | 98.2% | 0.26% |
| 50–500 $ | 35026 | 15.0% | 92.3% | 94.9% | 99.2% | 85.5% | 93.0% | 98.7% | 0.21% |
| >500 $ | 306 | 0.1% | 89.9% | 92.2% | 96.7% | 83.3% | 88.9% | 95.8% | 0.25% |
| elle-benzeri | 74586 | 32.0% | 95.9% | 97.9% | 99.8% | 87.4% | 96.6% | 99.7% | 0.24% |
| bot-benzeri | 132951 | 57.1% | 93.0% | 94.7% | 98.7% | 85.1% | 90.8% | 97.9% | 0.18% |
| belirsiz | 25233 | 10.8% | 94.9% | 96.8% | 99.6% | 88.9% | 94.7% | 99.3% | 0.19% |
| elle ∩ 5–500 $ | 14976 | 6.4% | 93.2% | 95.7% | 99.2% | 86.1% | 93.6% | 98.8% | 0.23% |
| elle ∩ 5–500 $ ∩ yönlendiricisiz | 9910 | 4.3% | 96.8% | 98.4% | 99.7% | 91.9% | 97.7% | 99.6% | 0.16% |
| elle ∩ 5–500 $ ∩ yönlendirici/terminal | 5066 | 2.2% | 86.1% | 90.2% | 98.2% | 74.6% | 85.6% | 97.3% | 0.40% |
| elle ∩ Jito ipucu var | 1064 | 0.5% | 93.2% | 94.9% | 97.4% | 89.2% | 94.0% | 97.2% | 0.16% |
| yönlendirici/terminal (tüm sınıflar) | 44846 | 19.3% | 87.5% | 90.7% | 98.2% | 76.0% | 84.5% | 96.8% | 0.31% |
| Lighthouse (Phantom koruması) var | 1159 | 0.5% | 74.9% | 80.4% | 97.8% | 55.2% | 67.8% | 96.7% | 0.56% |
| bot ∩ 5–500 $ | 56759 | 24.4% | 91.1% | 94.0% | 98.9% | 82.0% | 90.6% | 98.1% | 0.25% |

### (a) açılış 2 dk, kendi tutarıyla
| alt küme | n | pay | 1-2-3 | 2-3-5 | 10-20-30 | tek %1 (dar ilk deneme) | tek %3 | tek %20 | kırp. ort. ödeme (2-3-5) |
|---|---|---|---|---|---|---|---|---|---|
| tümü | 27403 | 100.0% | 80.1% | 82.0% | 92.8% | 63.1% | 67.5% | 86.9% | 0.18% |
| <5 $ | 16658 | 60.8% | 82.1% | 83.3% | 92.4% | 65.8% | 68.1% | 86.2% | 0.11% |
| 5–50 $ | 8939 | 32.6% | 80.0% | 82.8% | 94.7% | 62.5% | 69.7% | 89.8% | 0.26% |
| 50–500 $ | 1774 | 6.5% | 61.1% | 65.8% | 87.5% | 40.7% | 50.1% | 80.3% | 0.50% |
| >500 $ | 32 | 0.1% | 56.3% | 59.4% | 75.0% | 43.8% | 53.1% | 62.5% | 0.66% |
| elle-benzeri | 1660 | 6.1% | 79.4% | 82.8% | 94.0% | 64.9% | 75.6% | 92.1% | 0.37% |
| bot-benzeri | 23765 | 86.7% | 80.3% | 81.9% | 92.4% | 63.0% | 66.6% | 86.2% | 0.15% |
| belirsiz | 1978 | 7.2% | 77.3% | 81.4% | 96.4% | 61.6% | 70.4% | 92.2% | 0.37% |
| elle ∩ 5–500 $ | 983 | 3.6% | 70.2% | 74.8% | 90.9% | 50.4% | 64.6% | 88.0% | 0.52% |
| elle ∩ 5–500 $ ∩ yönlendiricisiz | 83 | 0.3% | 51.8% | 51.8% | 67.5% | 37.3% | 48.2% | 62.7% | 0.42% |
| elle ∩ 5–500 $ ∩ yönlendirici/terminal | 900 | 3.3% | 71.9% | 76.9% | 93.1% | 51.6% | 66.1% | 90.3% | 0.53% |
| elle ∩ Jito ipucu var | 92 | 0.3% | 50.0% | 53.3% | 68.5% | 39.1% | 52.2% | 67.4% | 0.59% |
| yönlendirici/terminal (tüm sınıflar) | 13653 | 49.8% | 78.9% | 81.8% | 94.1% | 61.9% | 69.0% | 88.7% | 0.28% |
| Lighthouse (Phantom koruması) var | 544 | 2.0% | 75.7% | 78.5% | 94.7% | 55.9% | 64.2% | 91.9% | 0.35% |
| bot ∩ 5–500 $ | 8460 | 30.9% | 78.3% | 80.9% | 93.4% | 60.4% | 66.8% | 87.8% | 0.24% |

### (b) geçiş 5 dk, kendi tutarıyla
| alt küme | n | pay | 1-2-3 | 2-3-5 | 10-20-30 | tek %1 (dar ilk deneme) | tek %3 | tek %20 | kırp. ort. ödeme (2-3-5) |
|---|---|---|---|---|---|---|---|---|---|
| tümü | 6306 | 100.0% | 91.0% | 95.0% | 99.4% | 76.0% | 91.3% | 98.9% | 0.35% |
| <5 $ | 4947 | 78.4% | 91.5% | 95.1% | 99.4% | 78.0% | 91.8% | 98.8% | 0.30% |
| 5–50 $ | 732 | 11.6% | 87.2% | 92.8% | 99.6% | 65.0% | 85.7% | 99.2% | 0.53% |
| 50–500 $ | 577 | 9.2% | 90.6% | 96.9% | 100.0% | 71.1% | 93.9% | 100.0% | 0.49% |
| >500 $ | 50 | 0.8% | 100.0% | 100.0% | 100.0% | 96.0% | 100.0% | 100.0% | 0.18% |
| elle-benzeri | 2131 | 33.8% | 83.2% | 92.7% | 99.9% | 58.6% | 88.1% | 99.9% | 0.60% |
| bot-benzeri | 3743 | 59.4% | 96.1% | 96.8% | 99.2% | 87.3% | 93.9% | 98.5% | 0.18% |
| belirsiz | 432 | 6.9% | 84.7% | 91.0% | 99.5% | 65.0% | 84.7% | 98.6% | 0.58% |
| elle ∩ 5–500 $ | 667 | 10.6% | 89.5% | 95.8% | 100.0% | 70.6% | 94.0% | 100.0% | 0.47% |
| elle ∩ 5–500 $ ∩ yönlendiricisiz | 562 | 8.9% | 89.3% | 95.9% | 100.0% | 70.5% | 94.7% | 100.0% | 0.45% |
| elle ∩ 5–500 $ ∩ yönlendirici/terminal | 105 | 1.7% | 90.5% | 95.2% | 100.0% | 71.4% | 90.5% | 100.0% | 0.54% |
| elle ∩ Jito ipucu var | 41 | 0.7% | 82.9% | 90.2% | 100.0% | 65.9% | 85.4% | 100.0% | 0.59% |
| yönlendirici/terminal (tüm sınıflar) | 699 | 11.1% | 83.4% | 88.8% | 98.1% | 60.8% | 79.0% | 96.6% | 0.54% |
| Lighthouse (Phantom koruması) var | 31 | 0.5% | 71.0% | 83.9% | 100.0% | 19.4% | 64.5% | 100.0% | 1.04% |
| bot ∩ 5–500 $ | 383 | 6.1% | 88.3% | 93.2% | 99.2% | 62.9% | 82.2% | 98.4% | 0.50% |

### (c) sıradan ≥70 dk, kendi tutarıyla
| alt küme | n | pay | 1-2-3 | 2-3-5 | 10-20-30 | tek %1 (dar ilk deneme) | tek %3 | tek %20 | kırp. ort. ödeme (2-3-5) |
|---|---|---|---|---|---|---|---|---|---|
| tümü | 52373 | 100.0% | 99.0% | 99.4% | 99.9% | 97.4% | 99.0% | 99.9% | 0.06% |
| <5 $ | 38575 | 73.7% | 99.7% | 99.8% | 100.0% | 98.6% | 99.7% | 99.9% | 0.04% |
| 5–50 $ | 10536 | 20.1% | 98.0% | 99.0% | 99.9% | 95.4% | 98.0% | 99.9% | 0.11% |
| 50–500 $ | 3156 | 6.0% | 94.4% | 96.2% | 99.4% | 90.7% | 94.5% | 98.9% | 0.16% |
| >500 $ | 106 | 0.2% | 94.3% | 98.1% | 100.0% | 89.6% | 93.4% | 100.0% | 0.27% |
| elle-benzeri | 16717 | 31.9% | 98.9% | 99.4% | 99.9% | 97.8% | 99.0% | 99.8% | 0.05% |
| bot-benzeri | 28211 | 53.9% | 99.1% | 99.5% | 99.9% | 97.3% | 99.1% | 99.8% | 0.06% |
| belirsiz | 7445 | 14.2% | 98.6% | 99.3% | 100.0% | 97.1% | 98.8% | 99.9% | 0.07% |
| elle ∩ 5–500 $ | 5399 | 10.3% | 97.4% | 98.4% | 99.7% | 95.1% | 97.5% | 99.5% | 0.10% |
| elle ∩ 5–500 $ ∩ yönlendiricisiz | 3986 | 7.6% | 98.9% | 99.6% | 99.9% | 97.1% | 99.0% | 99.9% | 0.08% |
| elle ∩ 5–500 $ ∩ yönlendirici/terminal | 1413 | 2.7% | 93.0% | 94.9% | 99.1% | 89.5% | 93.1% | 98.4% | 0.16% |
| elle ∩ Jito ipucu var | 471 | 0.9% | 98.9% | 99.6% | 100.0% | 98.3% | 99.2% | 99.8% | 0.05% |
| yönlendirici/terminal (tüm sınıflar) | 6678 | 12.8% | 96.1% | 97.5% | 99.7% | 93.3% | 96.1% | 99.4% | 0.13% |
| Lighthouse (Phantom koruması) var | 111 | 0.2% | 69.4% | 77.5% | 100.0% | 47.7% | 66.7% | 100.0% | 1.05% |
| bot ∩ 5–500 $ | 5885 | 11.2% | 97.1% | 98.4% | 99.9% | 94.1% | 97.1% | 99.8% | 0.13% |

### (d) üst-10 hacim, kendi tutarıyla
| alt küme | n | pay | 1-2-3 | 2-3-5 | 10-20-30 | tek %1 (dar ilk deneme) | tek %3 | tek %20 | kırp. ort. ödeme (2-3-5) |
|---|---|---|---|---|---|---|---|---|---|
| tümü | 47448 | 100.0% | 91.5% | 96.0% | 99.9% | 78.4% | 94.0% | 99.8% | 0.38% |
| <5 $ | 18732 | 39.5% | 90.0% | 95.2% | 99.9% | 72.9% | 92.3% | 99.9% | 0.47% |
| 5–50 $ | 13366 | 28.2% | 91.4% | 96.1% | 99.9% | 78.8% | 94.3% | 99.8% | 0.41% |
| 50–500 $ | 15245 | 32.1% | 93.3% | 96.7% | 99.9% | 84.9% | 95.7% | 99.9% | 0.25% |
| >500 $ | 105 | 0.2% | 97.1% | 98.1% | 100.0% | 89.5% | 95.2% | 100.0% | 0.17% |
| elle-benzeri | 16587 | 35.0% | 90.8% | 95.8% | 99.9% | 74.4% | 93.0% | 99.9% | 0.45% |
| bot-benzeri | 25616 | 54.0% | 91.7% | 95.8% | 99.9% | 80.6% | 94.5% | 99.8% | 0.34% |
| belirsiz | 5245 | 11.1% | 92.9% | 96.9% | 99.9% | 80.5% | 94.2% | 99.8% | 0.40% |
| elle ∩ 5–500 $ | 2650 | 5.6% | 92.5% | 96.6% | 99.8% | 79.7% | 94.4% | 99.9% | 0.35% |
| elle ∩ 5–500 $ ∩ yönlendiricisiz | 1956 | 4.1% | 93.3% | 97.4% | 100.0% | 81.5% | 95.5% | 100.0% | 0.30% |
| elle ∩ 5–500 $ ∩ yönlendirici/terminal | 694 | 1.5% | 90.2% | 94.5% | 99.3% | 74.6% | 91.2% | 99.7% | 0.48% |
| elle ∩ Jito ipucu var | 323 | 0.7% | 97.8% | 99.1% | 100.0% | 94.7% | 98.8% | 99.7% | 0.13% |
| yönlendirici/terminal (tüm sınıflar) | 6223 | 13.1% | 87.9% | 93.3% | 99.7% | 71.3% | 88.6% | 99.4% | 0.50% |
| Lighthouse (Phantom koruması) var | 134 | 0.3% | 62.7% | 73.1% | 99.3% | 28.4% | 54.5% | 96.3% | 1.01% |
| bot ∩ 5–500 $ | 21980 | 46.3% | 92.1% | 96.2% | 99.9% | 82.2% | 95.1% | 99.8% | 0.32% |

### "Elle alım benzeri ∩ 5–500 $" bütün örneklemden farklı mı? (alt küme tutması − bütün; %95 GA mekân kümeli bootstrap)
| durum | ölçü | alt küme (n) | bütün (n) | fark | GA |
|---|---|---|---|---|---|
| tüm durumlar | 1-2-3 (kendi tutarı) | 93.1% (14976) | 94.0% (232770) | -0.9% | -2.0% … 0.4% |
| tüm durumlar | 2-3-5 (kendi tutarı) | 95.6% (14976) | 95.8% (232770) | -0.2% | -1.1% … 0.7% |
| tüm durumlar | tek %1 | 86.0% (14976) | 86.1% (232770) | -0.1% | -2.5% … 2.2% |
| tüm durumlar | 1-2-3 (100 $) | 93.2% (14976) | 94.1% (232770) | -1.0% | -2.1% … 0.3% |
| tüm durumlar | 2-3-5 (100 $) | 95.7% (14976) | 95.9% (232770) | -0.3% | -1.2% … 0.6% |
| tüm durumlar | tek %1 (100 $) | 86.1% (14976) | 86.3% (232770) | -0.2% | -2.5% … 2.2% |
| (a) açılış 2 dk | 1-2-3 (kendi tutarı) | 70.2% (983) | 80.1% (27403) | -9.9% | -14.7% … -5.8% |
| (a) açılış 2 dk | 2-3-5 (kendi tutarı) | 74.8% (983) | 82.0% (27403) | -7.2% | -12.2% … -2.8% |
| (a) açılış 2 dk | tek %1 | 50.4% (983) | 63.1% (27403) | -12.7% | -18.7% … -7.7% |
| (a) açılış 2 dk | 1-2-3 (100 $) | 70.3% (983) | 80.6% (27403) | -10.3% | -15.2% … -6.1% |
| (a) açılış 2 dk | 2-3-5 (100 $) | 74.9% (983) | 82.7% (27403) | -7.9% | -13.0% … -3.6% |
| (a) açılış 2 dk | tek %1 (100 $) | 50.5% (983) | 63.5% (27403) | -13.0% | -19.0% … -8.2% |
| (b) geçiş 5 dk | 1-2-3 (kendi tutarı) | 89.5% (667) | 91.0% (6306) | -1.5% | -11.4% … 7.9% |
| (b) geçiş 5 dk | 2-3-5 (kendi tutarı) | 95.8% (667) | 95.0% (6306) | 0.8% | -9.1% … 7.1% |
| (b) geçiş 5 dk | tek %1 | 70.6% (667) | 76.0% (6306) | -5.4% | -19.4% … 13.5% |
| (b) geçiş 5 dk | 1-2-3 (100 $) | 89.5% (667) | 91.1% (6306) | -1.6% | -11.5% … 7.5% |
| (b) geçiş 5 dk | 2-3-5 (100 $) | 95.8% (667) | 95.2% (6306) | 0.6% | -9.6% … 6.3% |
| (b) geçiş 5 dk | tek %1 (100 $) | 70.6% (667) | 76.2% (6306) | -5.6% | -19.5% … 13.2% |
| (c) sıradan ≥70 dk | 1-2-3 (kendi tutarı) | 97.4% (5399) | 99.0% (52373) | -1.6% | -2.6% … -0.9% |
| (c) sıradan ≥70 dk | 2-3-5 (kendi tutarı) | 98.4% (5399) | 99.4% (52373) | -1.1% | -1.9% … -0.5% |
| (c) sıradan ≥70 dk | tek %1 | 95.1% (5399) | 97.4% (52373) | -2.3% | -3.7% … -1.3% |
| (c) sıradan ≥70 dk | 1-2-3 (100 $) | 97.4% (5399) | 99.0% (52373) | -1.6% | -2.6% … -0.9% |
| (c) sıradan ≥70 dk | 2-3-5 (100 $) | 98.4% (5399) | 99.5% (52373) | -1.0% | -1.9% … -0.5% |
| (c) sıradan ≥70 dk | tek %1 (100 $) | 95.1% (5399) | 97.5% (52373) | -2.3% | -3.7% … -1.3% |
| (d) üst-10 hacim | 1-2-3 (kendi tutarı) | 92.5% (2650) | 91.5% (47448) | 1.0% | -3.1% … 5.5% |
| (d) üst-10 hacim | 2-3-5 (kendi tutarı) | 96.6% (2650) | 96.0% (47448) | 0.7% | -1.9% … 3.0% |
| (d) üst-10 hacim | tek %1 | 79.7% (2650) | 78.4% (47448) | 1.3% | -7.7% … 11.1% |
| (d) üst-10 hacim | 1-2-3 (100 $) | 92.5% (2650) | 91.5% (47448) | 1.0% | -3.2% … 5.5% |
| (d) üst-10 hacim | 2-3-5 (100 $) | 96.7% (2650) | 96.0% (47448) | 0.7% | -1.8% … 3.0% |
| (d) üst-10 hacim | tek %1 (100 $) | 79.7% (2650) | 78.5% (47448) | 1.2% | -7.7% … 11.0% |

### Sınıf dağılımı (alım başına, başarılı alımlar)
| pencere | alım | elle-benzeri | belirsiz | bot-benzeri | yönlendirici/terminal | Jito ipucu var | Lighthouse | medyan $ | 5–500 $ payı |
|---|---|---|---|---|---|---|---|---|---|
| W1 | 59467 | 33.8% | 10.8% | 55.5% | 23.7% | 1.8% | 0.6% | 1.83 | 38.5% |
| W2 | 105519 | 34.0% | 10.7% | 55.3% | 18.4% | 1.1% | 0.4% | 1.88 | 38.5% |
| W3 | 69145 | 27.6% | 11.1% | 61.4% | 16.7% | 2.5% | 0.5% | 1.08 | 35.9% |
| hepsi | 234131 | 32.0% | 10.8% | 57.1% | 19.2% | 1.7% | 0.5% | 1.55 | 37.7% |

## İş 3 · İlan edilen tolerans ve gereken (k = 3 slot kotasyon gecikmesi; k=2/4 duyarlılık)
Korumasız ilan (exact-in ≥%99 / max_cost ≥%200) payı: 14.1%.
Dışarıda bırakılan kalıcı sapmalı mekân (ortanca gereken > %5: aktarım ücretli/vergili token): 171 mekân, 68312 alım.
Tolerans çıkarılabilen başarılı alım: 71873 / 234131 (exact-in min_out: 34894, max_cost: 36979).

### k = 3 (ana), gereken tabanı %0,5
| grup | n | ilan edilen: ortanca [çeyrekler] | gereken: ortanca / p75 / p90 | boşluk (ilan−gereken) ortanca [çeyrekler] | ilan > 5× gereken | ilan > 10× gereken |
|---|---|---|---|---|---|---|
| tümü | 71873 | 10.2% [2.4%–22.3%] | 0.36% / 2.21% / 8.21% | 9.8% [1.7%–19.7%] | 56.8% | 43.5% |
| (a) açılış 2 dk | 23693 | 5.5% [0.0%–35.9%] | 0.00% / 1.17% / 15.56% | 1.0% [0.0%–30.0%] | 34.9% | 31.4% |
| (b) geçiş 5 dk | 61 | 99.7% [0.9%–100.0%] | 0.00% / 1.12% / 8.76% | 91.2% [16.0%–103.2%] | 67.2% | 62.3% |
| (c) sıradan ≥70 dk | 32231 | 10.3% [6.0%–22.0%] | 1.12% / 2.93% / 3.62% | 9.8% [4.8%–19.1%] | 74.5% | 49.5% |
| (d) üst-10 hacim | 624 | 10.8% [10.8%–10.9%] | 0.94% / 1.02% / 1.14% | 9.9% [9.9%–9.9%] | 96.6% | 86.7% |
| exact-in (min_out) | 34894 | 22.1% [17.8%–100.0%] | 0.91% / 3.08% / 10.56% | 19.4% [13.2%–89.2%] | 78.3% | 54.4% |
| max_cost tipi | 36979 | 5.1% [0.0%–10.2%] | 0.34% / 1.01% / 5.22% | 1.8% [0.0%–9.8%] | 36.4% | 33.2% |
| elle-benzeri | 14660 | 10.8% [5.5%–30.7%] | 1.76% / 3.54% / 6.88% | 9.8% [2.5%–21.0%] | 56.0% | 37.7% |
| bot-benzeri | 48993 | 10.1% [0.0%–22.0%] | 0.31% / 1.23% / 8.96% | 6.7% [0.0%–19.3%] | 52.5% | 43.8% |
| elle ∩ 5–500 $ | 4955 | 20.0% [7.8%–100.0%] | 1.10% / 2.92% / 8.68% | 14.5% [4.9%–87.4%] | 67.7% | 53.1% |
| yönlendirici/terminal | 25054 | 22.9% [9.7%–100.0%] | 0.00% / 1.83% / 11.84% | 20.0% [8.0%–95.4%] | 68.7% | 60.8% |
| yönlendiricisiz | 46819 | 7.5% [0.0%–21.5%] | 0.52% / 2.63% / 4.22% | 4.8% [0.0%–9.9%] | 50.4% | 34.2% |
| <5 $ | 48277 | 10.2% [2.1%–22.0%] | 0.36% / 2.20% / 4.19% | 9.8% [0.2%–19.3%] | 57.0% | 42.2% |
| 5–50 $ | 18938 | 10.2% [3.0%–40.0%] | 0.39% / 2.14% / 13.10% | 7.4% [1.8%–30.0%] | 53.4% | 43.9% |
| 50–500 $ | 4555 | 21.9% [10.2%–100.0%] | 0.92% / 3.47% / 12.33% | 19.0% [6.0%–96.9%] | 68.1% | 55.0% |
| >500 $ | 103 | 10.8% [5.5%–100.0%] | 0.94% / 2.69% / 4.25% | 9.9% [1.1%–97.3%] | 67.0% | 63.1% |

### k = 3, gereken tabanı %1 (daha ihtiyatlı)
| grup | n | ilan edilen: ortanca [çeyrekler] | gereken: ortanca / p75 / p90 | boşluk (ilan−gereken) ortanca [çeyrekler] | ilan > 5× gereken | ilan > 10× gereken |
|---|---|---|---|---|---|---|
| tümü | 71873 | 10.2% [2.4%–22.3%] | 0.36% / 2.21% / 8.21% | 9.8% [1.7%–19.7%] | 55.6% | 37.5% |
| (a) açılış 2 dk | 23693 | 5.5% [0.0%–35.9%] | 0.00% / 1.17% / 15.56% | 1.0% [0.0%–30.0%] | 33.5% | 29.4% |
| (b) geçiş 5 dk | 61 | 99.7% [0.9%–100.0%] | 0.00% / 1.12% / 8.76% | 91.2% [16.0%–103.2%] | 67.2% | 62.3% |
| (c) sıradan ≥70 dk | 32231 | 10.3% [6.0%–22.0%] | 1.12% / 2.93% / 3.62% | 9.8% [4.8%–19.1%] | 73.7% | 40.0% |
| (d) üst-10 hacim | 624 | 10.8% [10.8%–10.9%] | 0.94% / 1.02% / 1.14% | 9.9% [9.9%–9.9%] | 96.6% | 86.2% |
| exact-in (min_out) | 34894 | 22.1% [17.8%–100.0%] | 0.91% / 3.08% / 10.56% | 19.4% [13.2%–89.2%] | 76.8% | 49.9% |

### k = 2 (kotasyon 2 slot önce)
| grup | n | ilan edilen: ortanca [çeyrekler] | gereken: ortanca / p75 / p90 | boşluk (ilan−gereken) ortanca [çeyrekler] | ilan > 5× gereken | ilan > 10× gereken |
|---|---|---|---|---|---|---|
| tümü | 71873 | 10.2% [0.4%–22.1%] | 0.33% / 2.10% / 3.62% | 9.8% [1.7%–19.8%] | 57.7% | 44.6% |
| (a) açılış 2 dk | 23693 | 0.0% [0.0%–30.2%] | 0.00% / 0.00% / 3.40% | 1.0% [0.0%–30.0%] | 37.0% | 33.8% |
| (b) geçiş 5 dk | 61 | 99.7% [0.9%–100.0%] | 0.00% / 1.12% / 7.69% | 91.7% [16.0%–103.2%] | 68.9% | 65.6% |
| (c) sıradan ≥70 dk | 32231 | 10.3% [6.0%–22.0%] | 1.12% / 2.92% / 3.62% | 9.8% [4.8%–19.1%] | 74.5% | 49.5% |
| (d) üst-10 hacim | 624 | 10.8% [10.8%–10.8%] | 0.94% / 0.95% / 1.06% | 9.9% [9.9%–9.9%] | 98.2% | 91.5% |
| exact-in (min_out) | 34894 | 22.0% [17.9%–100.0%] | 0.70% / 3.00% / 7.69% | 19.4% [13.2%–90.1%] | 80.0% | 56.6% |

### k = 4 (kotasyon 4 slot önce)
| grup | n | ilan edilen: ortanca [çeyrekler] | gereken: ortanca / p75 / p90 | boşluk (ilan−gereken) ortanca [çeyrekler] | ilan > 5× gereken | ilan > 10× gereken |
|---|---|---|---|---|---|---|
| tümü | 71873 | 10.4% [3.3%–23.4%] | 0.46% / 3.00% / 13.72% | 9.8% [1.5%–19.5%] | 56.0% | 42.4% |
| (a) açılış 2 dk | 23693 | 10.6% [0.0%–37.5%] | 0.00% / 7.28% / 21.28% | 0.6% [0.0%–29.8%] | 33.0% | 29.2% |
| (b) geçiş 5 dk | 61 | 99.7% [0.0%–100.0%] | 0.00% / 1.12% / 9.34% | 90.7% [13.6%–103.2%] | 60.7% | 55.7% |
| (c) sıradan ≥70 dk | 32231 | 10.3% [6.0%–22.0%] | 1.10% / 2.92% / 3.62% | 9.8% [4.8%–19.1%] | 74.5% | 49.5% |
| (d) üst-10 hacim | 624 | 10.8% [10.8%–10.9%] | 0.95% / 1.03% / 1.24% | 9.9% [9.9%–9.9%] | 96.3% | 82.9% |
| exact-in (min_out) | 34894 | 22.1% [16.6%–100.0%] | 0.98% / 3.10% / 12.20% | 19.4% [13.0%–87.9%] | 76.9% | 52.3% |

### Pencere bazında (k = 3, taban %0,5)
| pencere | n | ilan ortanca [çeyrekler] | gereken ortanca / p90 | boşluk ortanca | >5× | >10× |
|---|---|---|---|---|---|---|
| W1 | 21458 | 10.1% [2.4%–23.4%] | 0.32% / 6.71% | 9.8% | 56.8% | 43.5% |
| W2 | 22621 | 8.5% [0.0%–26.0%] | 0.36% / 14.82% | 4.9% | 44.3% | 38.7% |
| W3 | 27794 | 12.3% [5.4%–22.0%] | 0.53% / 4.67% | 9.9% | 66.9% | 47.3% |

### İlan edilen tolerans dağılımı (k = 3)

#### Fiyatı sabit kalan alımlar (|gereken| < %0,3: kotasyon tahmini en güvenilir), tüm pencereler
| grup | n | ±0,5pp @%1 | ±0,5pp @%2 | ±0,5pp @%3 | ±0,5pp @%5 | ±0,5pp @%10 | ±0,5pp @%15 | ±0,5pp @%20 | ±0,5pp @%25 | ±0,5pp @%30 | ±0,5pp @%40 | ±0,5pp @%50 | <%0,5 | herhangi bir yuvarlak değere ±0,5pp |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tümü | 19199 | 1.0% | 3.5% | 1.2% | 2.4% | 2.8% | 0.9% | 9.5% | 0.9% | 1.5% | 1.4% | 1.4% | 47.3% | 26.5% |
| yönlendirici/terminal | 9602 | 1.3% | 7.1% | 2.0% | 3.0% | 5.4% | 1.8% | 19.0% | 1.5% | 2.9% | 2.7% | 2.8% | 5.1% | 49.6% |
| yönlendiricisiz | 9597 | 0.7% | 0.0% | 0.3% | 1.8% | 0.2% | 0.1% | 0.0% | 0.2% | 0.1% | 0.0% | 0.0% | 89.6% | 3.4% |
| elle-benzeri | 2862 | 2.1% | 21.5% | 5.6% | 6.4% | 4.5% | 1.3% | 9.3% | 0.7% | 3.3% | 1.2% | 0.7% | 3.8% | 56.4% |
| bot-benzeri | 14600 | 0.5% | 0.2% | 0.2% | 1.7% | 2.3% | 0.8% | 8.0% | 0.9% | 0.8% | 1.4% | 1.5% | 60.7% | 18.3% |
| exact-in | 8537 | 1.1% | 7.7% | 2.2% | 1.5% | 4.1% | 1.5% | 21.0% | 1.8% | 3.4% | 3.1% | 3.0% | 0.4% | 50.5% |
| max_cost | 10662 | 0.9% | 0.2% | 0.3% | 3.1% | 1.7% | 0.5% | 0.3% | 0.1% | 0.0% | 0.0% | 0.1% | 84.8% | 7.3% |
| Lighthouse (Phantom) var | 72 | 2.8% | 1.4% | 0.0% | 5.6% | 0.0% | 4.2% | 0.0% | 56.9% | 1.4% | 0.0% | 0.0% | 1.4% | 72.2% |

#### Tüm alımlar (fiyat hareketi gürültüsüyle)
| grup | n | ±0,5pp @%1 | ±0,5pp @%2 | ±0,5pp @%3 | ±0,5pp @%5 | ±0,5pp @%10 | ±0,5pp @%15 | ±0,5pp @%20 | ±0,5pp @%25 | ±0,5pp @%30 | ±0,5pp @%40 | ±0,5pp @%50 | <%0,5 | herhangi bir yuvarlak değere ±0,5pp |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tümü | 71873 | 1.3% | 3.1% | 2.0% | 5.9% | 12.9% | 0.8% | 4.0% | 0.5% | 0.8% | 0.9% | 0.9% | 21.5% | 33.1% |
| yönlendirici/terminal | 25054 | 1.9% | 3.3% | 1.6% | 1.8% | 4.0% | 1.6% | 11.0% | 1.1% | 1.9% | 2.5% | 2.5% | 11.1% | 33.3% |
| elle-benzeri | 14660 | 0.7% | 9.8% | 4.8% | 6.9% | 7.9% | 0.6% | 2.4% | 0.3% | 1.2% | 0.4% | 0.3% | 1.2% | 35.1% |

#### W1 (sabit fiyatlılar)
| grup | n | ±0,5pp @%1 | ±0,5pp @%2 | ±0,5pp @%3 | ±0,5pp @%5 | ±0,5pp @%10 | ±0,5pp @%15 | ±0,5pp @%20 | ±0,5pp @%25 | ±0,5pp @%30 | ±0,5pp @%40 | ±0,5pp @%50 | <%0,5 | herhangi bir yuvarlak değere ±0,5pp |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tümü | 6962 | 0.6% | 9.5% | 2.4% | 4.2% | 2.2% | 1.2% | 8.9% | 0.9% | 1.2% | 1.1% | 0.9% | 40.0% | 33.2% |

#### W2 (sabit fiyatlılar)
| grup | n | ±0,5pp @%1 | ±0,5pp @%2 | ±0,5pp @%3 | ±0,5pp @%5 | ±0,5pp @%10 | ±0,5pp @%15 | ±0,5pp @%20 | ±0,5pp @%25 | ±0,5pp @%30 | ±0,5pp @%40 | ±0,5pp @%50 | <%0,5 | herhangi bir yuvarlak değere ±0,5pp |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tümü | 6056 | 1.1% | 0.2% | 0.3% | 0.8% | 1.6% | 0.5% | 7.8% | 0.7% | 1.8% | 1.8% | 2.0% | 58.8% | 18.7% |

#### W3 (sabit fiyatlılar)
| grup | n | ±0,5pp @%1 | ±0,5pp @%2 | ±0,5pp @%3 | ±0,5pp @%5 | ±0,5pp @%10 | ±0,5pp @%15 | ±0,5pp @%20 | ±0,5pp @%25 | ±0,5pp @%30 | ±0,5pp @%40 | ±0,5pp @%50 | <%0,5 | herhangi bir yuvarlak değere ±0,5pp |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tümü | 6181 | 1.3% | 0.1% | 0.6% | 1.9% | 4.6% | 1.1% | 11.9% | 1.0% | 1.6% | 1.2% | 1.4% | 44.2% | 26.8% |

#### En sık ilan değerleri (1pp yuvarlama, fiyatı sabit kalanlar, yönlendirici/terminal ayrı)
- tümü (n=19199): %0: 47.3%, %100: 18.0%, %20: 9.5%, %2: 3.5%, %10: 2.8%, %5: 2.4%, %23: 1.9%, %30: 1.5%, %50: 1.4%, %40: 1.4%
- yönlendirici/terminal (n=9602): %100: 30.1%, %20: 19.0%, %2: 7.1%, %10: 5.4%, %0: 5.1%, %23: 3.8%, %5: 3.0%, %30: 2.9%, %50: 2.8%, %40: 2.7%
- yönlendiricisiz (n=9597): %0: 89.6%, %100: 5.9%, %5: 1.8%, %1: 0.7%, %3: 0.3%, %8: 0.3%, %10: 0.2%, %25: 0.2%, %6: 0.1%, %22: 0.1%
- elle-benzeri (n=2862): %100: 26.8%, %2: 21.5%, %20: 9.3%, %5: 6.4%, %3: 5.6%, %10: 4.5%, %0: 3.8%, %30: 3.3%, %8: 2.7%, %4: 2.3%

### Geniş tolerans gerçekten daha pahalıya mı aldırıyor? (aynı mekân, aynı slot aralığında dar ≤%5 ve geniş ≥%20 ilan)
| ölçü | slot aralığı | süzgeç | eşleşen (mekân, aralık) | dar alım / geniş alım | fark (geniş − dar) ağırlıklı ort. | ortanca fark | %95 GA |
|---|---|---|---|---|---|---|---|
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 3 | tümü | 2129 | 2685 / 3299 | 5.26% | 0.99% | 4.41% … 6.10% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 3 | sandwichsiz | 2127 | 2657 / 3268 | 5.26% | 0.99% | 4.36% … 6.00% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 3 | elle-benzeri | 16 | yetersiz |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 3 | yalnız havuz (A) | 90 | 125 / 216 | 1.13% | -0.00% | -0.08% … 3.46% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 3 | yalnız eğri (C) | 2039 | 2560 / 3083 | 5.48% | 1.22% | 4.69% … 6.41% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 3 | (a) açılış 2 dk | 1487 | 1808 / 2296 | 4.89% | 1.13% | 4.00% … 6.04% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 3 | (c) sıradan havuz | 86 | 120 / 212 | 1.08% | -0.00% | -0.09% … 3.32% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 3 | elle+belirsiz (bot hariç) | 85 | 99 / 125 | 2.29% | 0.09% | 1.22% … 3.51% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 3 | k=1 ve k=3 aynı grup | 1642 | 2070 / 2594 | 0.67% | 0.28% | -0.04% … 1.37% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 3 | bot hariç ∩ k=1/k=3 aynı grup | 76 | 85 / 111 | 2.40% | 0.06% | 1.28% … 3.77% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 10 | tümü | 3596 | 6356 / 7356 | 7.95% | 2.27% | 7.15% … 8.69% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 10 | sandwichsiz | 3594 | 6328 / 7333 | 7.94% | 2.27% | 7.19% … 8.72% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 10 | elle-benzeri | 35 | 51 / 56 | 4.45% | 0.12% | 1.89% … 8.34% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 10 | yalnız havuz (A) | 143 | 228 / 401 | 0.86% | 0.00% | -0.05% … 2.28% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 10 | yalnız eğri (C) | 3453 | 6128 / 6955 | 8.27% | 3.07% | 7.39% … 9.08% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 10 | (a) açılış 2 dk | 2554 | 4452 / 5180 | 7.14% | 3.44% | 6.24% … 8.00% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 10 | (c) sıradan havuz | 135 | 218 / 392 | 0.68% | 0.00% | -0.13% … 1.85% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 10 | elle+belirsiz (bot hariç) | 146 | 210 / 359 | 3.39% | 0.16% | 2.02% … 4.77% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 10 | k=1 ve k=3 aynı grup | 2711 | 4693 / 5676 | -1.86% | -0.08% | -2.68% … -1.03% |
| gerçekleşen fazla ödeme o3 (k=3 kotasyona göre) | 10 | bot hariç ∩ k=1/k=3 aynı grup | 133 | 185 / 317 | 2.72% | 0.12% | 1.37% … 3.88% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 3 | tümü | 2129 | 2685 / 3299 | 1.64% | 0.54% | 1.00% … 2.24% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 3 | sandwichsiz | 2127 | 2657 / 3268 | 1.63% | 0.54% | 1.03% … 2.17% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 3 | elle-benzeri | 16 | yetersiz |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 3 | yalnız havuz (A) | 90 | 125 / 216 | 0.34% | -0.00% | -0.32% … 1.44% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 3 | yalnız eğri (C) | 2039 | 2560 / 3083 | 1.71% | 0.64% | 1.11% … 2.28% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 3 | (a) açılış 2 dk | 1487 | 1808 / 2296 | 0.94% | 0.59% | 0.21% … 1.74% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 3 | (c) sıradan havuz | 86 | 120 / 212 | 0.44% | -0.00% | -0.07% … 1.45% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 3 | elle+belirsiz (bot hariç) | 85 | 99 / 125 | 1.38% | 0.10% | 0.22% … 2.70% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 3 | k=1 ve k=3 aynı grup | 1642 | 2070 / 2594 | -0.91% | 0.11% | -1.54% … -0.27% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 3 | bot hariç ∩ k=1/k=3 aynı grup | 76 | 85 / 111 | 1.65% | 0.20% | 0.59% … 3.20% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 10 | tümü | 3596 | 6356 / 7356 | 2.09% | 0.41% | 1.51% … 2.72% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 10 | sandwichsiz | 3594 | 6328 / 7333 | 2.08% | 0.41% | 1.49% … 2.70% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 10 | elle-benzeri | 35 | 51 / 56 | 1.46% | 0.04% | -0.32% … 3.53% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 10 | yalnız havuz (A) | 143 | 228 / 401 | 0.22% | 0.00% | -0.50% … 1.10% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 10 | yalnız eğri (C) | 3453 | 6128 / 6955 | 2.17% | 0.68% | 1.59% … 2.85% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 10 | (a) açılış 2 dk | 2554 | 4452 / 5180 | 1.57% | 0.57% | 0.79% … 2.28% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 10 | (c) sıradan havuz | 135 | 218 / 392 | 0.43% | 0.00% | -0.19% … 1.28% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 10 | elle+belirsiz (bot hariç) | 146 | 210 / 359 | 0.88% | 0.15% | -1.03% … 2.29% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 10 | k=1 ve k=3 aynı grup | 2711 | 4693 / 5676 | -2.26% | -0.06% | -2.95% … -1.65% |
| ortak zeminde yürütme fiyatı (log, ≈ %) | 10 | bot hariç ∩ k=1/k=3 aynı grup | 133 | 185 / 317 | 0.88% | 0.10% | -0.88% … 2.24% |

Budama kontrolü: dar alımlar n=20891 (o3 ortalaması 3.27%, ortanca 0.13%); geniş alımlar n=27878 (ortalama 3.37%, ortanca 0.00%); geniş alımların o3 ≤ %5 olan kısmı (dar tavanın altında kalanlar) n=23728, ortalama -1.38%; geniş alımların %14.9'i %5'in üstünde fazla ödemeyle gerçekleşmiş (ortalama 30.5%, "razı olunan kuyruk").
Sandwich payı: dar ≤%5: 0.13%, geniş ≥%20: 0.12%.

### Sandwich kurbanlarının ilan ettiği tolerans (ayrılabilen = aynı slot, aynı imzacı al–sat; alt sınır)
Kurban (alım) sayısı tüm alımlarda: 294 / 234131 (0.126%); toleransı çıkarılabilen kurban: 66.
| ilan edilen tolerans dilimi (Bitquery dilimi) | alım (toleransı bilinen) | kurban | bu örneklemde /10.000 | Wilson %95 | Bitquery dilimi /10.000 (önceki rapordan) |
|---|---|---|---|---|---|
| ≤%3 | 19150 | 26 | 13.6 | 9.3–19.9 | 8 |
| %3–10 | 11291 | 5 | 4.4 | 1.9–10.4 | 44 |
| %10–20 | 13553 | 1 | 0.7 | 0.1–4.2 | 87 |
| >%20 | 27878 | 34 | 12.2 | 8.7–17.0 | 148 |
| >%20 ve ≤%50 | 15514 | 16 | 10.3 | 6.3–16.7 |  |
| >%50 | 12364 | 18 | 14.6 | 9.2–23.0 |  |
Kurbanların ilan edilen tolerans ortancası 22.3% [çeyrekler 0.0%–62.9%], sandwichsiz alımlarda ortanca 10.2%.

Sandwich oranı (alım başına, tüm alımlar): (a) açılış 2 dk 0.19% (n=27562); (b) geçiş 5 dk 0.22% (n=6315); (c) sıradan ≥70 dk 0.03% (n=52664); (d) üst-10 hacim 0.30% (n=47666)

## İş 4 · Kayma hatasıyla düşen alımın bedeli
Düşen alım içeren işlem: 527566; bunların kayma hatasıyla düşenleri (pump 6002/6042, PumpSwap 6004/6040): 135217 (25.6%).
Bunların doğrudan pump/PumpSwap talimatında düşenleri (hata kodu doğrudan o programdan): 74471; başka bir programın (yönlendirici/bot) içinden düşenleri: 60746 (kod aynı, ama 6xxx kodları programlar arası çakışabilir: üst sınır).
Düşme kodu dağılımı (en sık 8): o:3 → 79190, o:6040 → 56645, o:1 → 46357, P:6042 → 42166, o:6001 → 38764, o:26374 → 35614, o:6009 → 34576, o:301 → 33609

Pencere başına alım: başarılı alım / düşen alım (kayma) / düşen oranı
- W1: 59467 / 32146 / 35.1%
- W2: 105519 / 85898 / 44.9%
- W3: 69145 / 17173 / 19.9%

### Düşen (kayma) alımın ücreti, durum ve sınıfa göre (birleşik)
| grup | n | taban $ ort. | öncelik ücreti $ ortanca / p90 | toplam ücret $ ortanca / p90 / ort. | ilan Jito ipucu olan | öncelik ücreti > 0 olan | taban payı toplamda (ortanca) |
|---|---|---|---|---|---|---|---|
| tümü | 135217 | 0.00034 | 0.00007 / 0.00162 | 0.00041 / 0.00196 / 0.00346 | 11.4% | 87.0% | 82.7% |
| (a) açılış 2 dk | 24836 | 0.00034 | 0.00002 / 0.00162 | 0.00038 / 0.00198 / 0.00966 | 17.7% | 82.4% | 93.4% |
| (b) geçiş 5 dk | 9587 | 0.00034 | 0.00000 / 0.00046 | 0.00034 / 0.00081 / 0.00050 | 0.0% | 100.0% | 100.0% |
| (c) sıradan ≥70 dk | 2714 | 0.00035 | 0.00001 / 0.00176 | 0.00036 / 0.00211 / 0.00719 | 0.9% | 99.7% | 96.4% |
| (d) üst-10 hacim | 27239 | 0.00035 | 0.00002 / 0.00044 | 0.00037 / 0.00078 / 0.00174 | 0.0% | 95.9% | 95.5% |
| durumu belirsiz (başka mekân) | 77789 | 0.00034 | 0.00008 / 0.00223 | 0.00042 / 0.00257 / 0.00205 | 14.1% | 84.4% | 80.6% |
| elle-benzeri | 362 | 0.00035 | 0.01558 / 0.56264 | 0.01591 / 0.56299 / 0.35872 | 4.4% | 95.9% | 2.1% |
| belirsiz | 450 | 0.00035 | 0.00738 / 0.16128 | 0.00774 / 0.16162 / 0.08532 | 2.9% | 80.7% | 4.8% |
| bot-benzeri | 134405 | 0.00034 | 0.00007 / 0.00161 | 0.00041 / 0.00195 / 0.00223 | 11.5% | 87.0% | 82.8% |
| elle ∩ yönlendirici/terminal | 178 | 0.00035 | 0.00974 / 0.34100 | 0.01009 / 0.34134 / 0.19163 | 6.7% | 99.4% | 3.5% |
| elle ∩ yönlendiricisiz | 184 | 0.00034 | 0.05654 / 0.70330 | 0.05690 / 0.70365 / 0.52037 | 2.2% | 92.4% | 0.8% |
| pump eğrisi (P) | 51802 | 0.00034 | 0.00001 / 0.00080 | 0.00035 / 0.00115 / 0.00638 | 29.7% | 70.3% | 98.4% |
| PumpSwap (A) | 83415 | 0.00034 | 0.00014 / 0.00185 | 0.00049 / 0.00219 / 0.00165 | 0.1% | 97.3% | 71.0% |
| elle ∩ a açılış | 203 | 0.00034 | 0.04396 / 0.70330 | 0.04431 / 0.70365 / 0.47887 | 7.9% | 99.5% | 0.8% |
| elle ∩ b geçiş | 8 | yetersiz |
| elle ∩ c sıradan | 24 | 0.00035 | 0.00974 / 0.34100 | 0.01009 / 0.34134 / 0.13195 | 0.0% | 100.0% | 3.5% |
| elle ∩ d üst-10 | 28 | 0.00034 | 0.00132 / 0.14066 | 0.00167 / 0.14101 / 0.40761 | 0.0% | 89.3% | 21.1% |

### W1: düşen (kayma) alımın ücreti
| grup | n | taban $ ort. | öncelik ücreti $ ortanca / p90 | toplam ücret $ ortanca / p90 / ort. | ilan Jito ipucu olan | öncelik ücreti > 0 olan | taban payı toplamda (ortanca) |
|---|---|---|---|---|---|---|---|
| tümü | 32146 | 0.00035 | 0.00008 / 0.00059 | 0.00044 / 0.00094 / 0.00443 | 8.4% | 90.4% | 80.6% |
| elle-benzeri | 132 | 0.00035 | 0.01793 / 0.42198 | 0.01829 / 0.42233 / 0.30744 | 3.8% | 97.7% | 2.2% |

### W2: düşen (kayma) alımın ücreti
| grup | n | taban $ ort. | öncelik ücreti $ ortanca / p90 | toplam ücret $ ortanca / p90 / ort. | ilan Jito ipucu olan | öncelik ücreti > 0 olan | taban payı toplamda (ortanca) |
|---|---|---|---|---|---|---|---|
| tümü | 85898 | 0.00034 | 0.00008 / 0.00206 | 0.00042 / 0.00240 / 0.00253 | 13.7% | 84.6% | 80.8% |
| elle-benzeri | 116 | 0.00035 | 0.00853 / 0.68234 | 0.00887 / 0.68268 / 0.27080 | 3.4% | 92.2% | 4.0% |

### W3: düşen (kayma) alımın ücreti
| grup | n | taban $ ort. | öncelik ücreti $ ortanca / p90 | toplam ücret $ ortanca / p90 / ort. | ilan Jito ipucu olan | öncelik ücreti > 0 olan | taban payı toplamda (ortanca) |
|---|---|---|---|---|---|---|---|
| tümü | 17173 | 0.00034 | 0.00006 / 0.00100 | 0.00039 / 0.00134 / 0.00630 | 5.8% | 92.6% | 85.3% |
| elle-benzeri | 114 | 0.00034 | 0.04032 / 0.62496 | 0.04066 / 0.62530 / 0.50758 | 6.1% | 97.4% | 1.0% |

İşlemin başarılı alıma kıyasla kendi ücret yapısı (başarılı alımların toplam ücreti $, ortanca / p90): W1 0.00088 / 0.00844; W2 0.00102 / 0.00716; W3 0.00101 / 0.00706

Elle-benzeri sınıfın düşen alım payı (düşen / (düşen + başarılı), alım başına): man: 0.5% (362/75396); amb: 1.7% (450/25823); bot: 50.1% (134405/268129)

Elle-benzeri imzacı başına: ortalama düşen deneme sayısı (düşen alım içeren imzacılar): 282 imzacı, ortalama 1.28, ortanca 1, p90 2