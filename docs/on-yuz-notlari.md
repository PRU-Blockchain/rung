# Ön yüz notları: demodan çıkanlar

**Bu dosya nedir:** Merve'nin ön yüz demosu sırasında çıkan notlar. Şart ya da iş listesi değil, yalnız bilgi. Kimin ne dediği yanında yazılı.

## Demoda sorulanlar ve Buğra'nın cevapları (25 Kasım 2026 akşamı)

- **Tema:** Koyu. Buğra: "Kesinlikle koyu kalsın."
- **Ana düğme:** "Buy once" büyük, "one wallet approval covers every try" altında küçük yazılıyor. Kelimeler aynı; yalnız aradaki "·" yerine satır kırıldı. Buğra: olur; sabit metin denetimi bozulursa kendi ajanı düzeltir.
- **Token adı ve resmi:** Botların hepsi gösteriyor; Rung şu an okumuyor. Bu alım mantığı tarafında, Buğra'nın ajanının işi; Buğra yapacak. Demoda kartta ad ("CATE") ve resmin yerinde adın ilk iki harfi duruyor.
- **Dolar karşılığı:** DEX'lerin hepsinde var; göstermek için bir fiyat kaynağı lazım. Buğra yapacak. Demoda büyük tutarın hemen altında "≈ $0.69" duruyor: 24 Kasım 17:50 UTC'deki CATE alımı, o dakikanın SOL fiyatı $69.38 (Coinbase).

## Site için notlar

- **Sayaç notundaki bir cümle:** `web/lib/copy.ts` içindeki `counterNote` "They include test runs where we moved the price on purpose." diye bitiyor. Bu devnet için doğru; README'ye göre mainnet'te fiyatı kimse kendisi oynatmadı ("Nobody on our side moved the price"). Sayaç mainnet'e çevrilince bu cümle doğru olmuyor. Site demosunda bu cümle yok.
- **Yeni İngilizce satırlar:** Site demosunda telefonun altında, gösterimin gerçek bir emrin tekrarı olduğunu söyleyen satırlar var. Devir metninde yoklar; `copy.ts`'deki işaretsiz bağlayıcı metinler gibi yazıldılar:
  - "Replay of a real mainnet buy from the Android app, Nov 24, 2026: CATE, Tight, 0.01 SOL. Tap Buy once; every step links to its transaction."
  - "Replay of a real mainnet order, Nov 24, 2026, sent with the command-line script (same program): the 1% rung missed, the 2% rung bought."
  - "Replay of a real mainnet order, Nov 24, 2026, sent with the command-line script (same program): every rung missed and the SOL came back."
  - Senaryo düğmeleri sayaçtaki biçimi kullanıyor: "bought on rung 1 (1%)", "bought on rung 2 (2%)", "not bought". "How to try" listesinde "README: Mainnet runs" bağlantısı da var.
- **"Sadece o kalsın" sözünün yorumu:** Buğra'nın "sitede yalnız telefon kalsın" sözü demoda şöyle uygulandı: telefon açılışta; sitenin bugünkü bölümleri (sayaç, son alımlar, modlar, terimler, kaynaklar) telefonun altında duruyor, çünkü devir metni sitede bunları istiyor. Yalnız telefon istenirse kalanı çıkarılabilir.

## Demodaki veriler

- Üç senaryo da 24 Kasım'daki gerçek mainnet emirleri; imzalar README'deki "Mainnet runs" bölümünden:
  - uygulamadan CATE alımı, %1 basamağında aldı;
  - betikle gönderilen beş basamaklı tırmanış (HKuZ…pump): %1 kaçtı, %2 basamağı görülenin %2.28 üstünden aldı;
  - betikle gönderilen ve alınamayan emir: cüzdandan 0.00003325 SOL ücret çıktı, kalan SOL geri döndü.
- Site demosundaki sayaç, `web/lib/counter.ts`'nin mainnet'e çevrilmiş bir kopyasıyla 25 Kasım 18:12 UTC'de okundu: 17 emir açıldı; 14'ü alındı, 2'si alınamadı, 1'i henüz sonuçlanmadı. Bu emirlerde ortalama %2.07'lik basamakta alındı.
- Uygulama ekranlarında, ekranda görünen yeni bir İngilizce kelime yok. Yalnız ekran okuyucu için "Clear" ve "Delete" etiketleri eklendi.

## Site taslağı siteye geçti (26 Kasım gecesi)

- Merve sade site taslağının son halini onayladı; `web/` artık o düzende: ilk ekranda başlık, tek cümle, düğmeler ve telefon (gerçek mainnet emirlerinin tekrarı), arkasında Seeker videosu; altında üç sayı bandı, sayaç, "How it works" ve "How to try". Telefon `web/app/phone/`, ölçek ve Seeker girişi `web/app/phone-stage.tsx` içinde.
- **Ağ:** Sitedeki ağ etiketleri `STATUS.network`'ten geliyor; bugün `devnet`, README de öyle diyor. Taslak mainnet gösteriyordu. Bu yüzden şu an sitenin üstünde "devnet", telefonun içinde "mainnet" yazıyor (telefon mainnet emirlerini oynatıyor). Mainnet'e geçiş `web/lib/status.ts`'de `network` ve `publicRpc` satırları ile README'deki "the web page runs on devnet" cümleleri; karar Buğra'nın.
- **Video düğmesi:** "Watch the video" ve video bölümü `STATUS.videoUrl` dolunca görünüyor. Bugün `null` (README: "Demo video: not yet"); şimdilik ilk ekranda yalnız "Repository" düğmesi var.
- **Yazı tipleri:** Archivo, Roboto ve IBM Plex Mono `next/font` ile derlemede indirilip siteden sunuluyor; ziyaretçinin tarayıcısı Google'a istek atmıyor. `web/app/layout.tsx`'teki not buna göre değişti.
- **Sözler:** Devir metninden gelen satırlar `copy.ts`'de `// verbatim` işaretli. İlk ekran ve üç sayı bandı için cümleler parçalara ayrıldı; her parça kendi satırında ve devir metninin birebir parçası. 35 işaretli satırın hepsi eski, denetlenmiş satırların içinde geçiyor; devir dosyası Merve'nin bilgisayarında olmadığı için `check-verbatim.mjs` çalıştırılmadı.
- **Yeni, işaretsiz sözler:** "Watch the video", "How it works", "Fees, rungs and failed tries", "All transactions on Solana Explorer", kaynakların kısa adları (Bitquery, CryptoSlate …), "README: Mainnet runs", "Seeker image: Solana Mobile press kit", tekrar notları ve düğmeleri, "on established tokens" (devir metnindeki "On established tokens" küçük harfle).
- **Sayaç notu:** "They include test runs where we moved the price on purpose." yalnız ağ devnet iken görünüyor.
- **Kaldırılanlar:** Eski sitedeki ekran görüntüleri bölümü (yerini telefon aldı; dosyalar `web/public/shots/` içinde duruyor) ve ilk ekrandaki `networkLine` cümlesi. "Recent buys" ilk 5 satırı gösteriyor; tamamı Solana Explorer bağlantısında.

## Açık işler (26 Kasım gecesi, Merve işin kalanını Buğra'ya bıraktı)

Not, şart değil; sırası Buğra'nın.

- **Ana dala birleştirme:** `merve/frontend` → `main`. `main` dalın içinde; birleştirme ileri sarma olur.
- **Ağ:** Site bugün devnet okuyor ve öyle yazıyor. Mainnet'e geçmek: `web/lib/status.ts`'de `network` ve `publicRpc`, README'deki "the web page runs on devnet" cümleleri.
- **Video:** Demo videosu çıkınca `web/lib/status.ts`'de `videoUrl`; "Watch the video" düğmesi ve bölüm kendiliğinden görünür.
- **Simge, uygulama tarafı:** `app/src/config.ts`'de `APP_IDENTITY.icon` → `https://rungbot.xyz/rung-icon.png`; `app/app.json`'daki beyaz zeminler koyuya; sonra Phantom ve Solflare'de bakılır (`docs/gorsel-istekleri.md`, bölüm 2).
- **Uygulamanın yeni düzeni:** Gerçek uygulama hâlâ ilk halinde; sitedeki telefonun düzenine çevirme önerisi `docs/uygulama-sade-onerisi.md` içinde (uygulanmadı; altı yeni ya da kısalan söz ve beş açık karar orada).
- **Söz denetimi:** `web/scripts/check-verbatim.mjs` devir dosyasıyla bir kez çalıştırılmalı; Merve'nin bilgisayarında devir dosyası yok.
