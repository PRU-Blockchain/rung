# Uygulamayı sitedeki sade telefona çevirme önerisi

26 Kasım 2026 gecesi, Merve'nin ajanı hazırladı. **Durum: öneri, uygulanmadı.** Şart ya da iş listesi değil, not. Merve işin kalanını Buğra'ya bıraktı; aşağıdaki kararlar artık Buğra'nın.

Hedef: sitedeki telefon, `web/app/phone/phone.ts` (ekip demosunun 3. turuyla aynı kod).
Bugünkü hali: `app/src/screens/`. Bugünkü ekranların görüntüleri: `docs/shots/app-1-buy.png`, `app-3-ladder.png`, `app-4-receipt.png`, `app-5-not-bought.png`, `app-8-history-offline.png`.

## Kısaca

- Gerçek uygulama hâlâ ilk halinde: açık tema, adres kutusu, beş mod düğmesi, yazılan tutar, uzun düğme, her şey alt alta ve düğmeye inmek için kaydırmak gerekiyor.
- Bu yüzden iş yalnız 3. turdaki yazı azaltma değil. Telefonun bütün yeni düzeni (1., 2. ve 3. tur) uygulamaya geçer.
- Alım mantığı aynı kalır: `app/src/flow/` ve `client/` değişmez.
- Değişen dosyaların hepsi `app/src/screens/` içinde. Klasör dışında yalnız `App.tsx`'te 2 satır gerekiyor (koyu durum çubuğu ve koyu açılış).
- Yeni paket yok. Telefona APK'yı yeniden kurmak gerekmez. Simgeler basit şekillerle çizilir, yazı tipi telefonun kendi yazı tipi (Roboto).
- Depoda uygulamanın sözlerini denetleyen bir test yok. Buğra'ya sorulacak sözler aşağıda tek listede.

## Ekran ekran: önce → sonra

### Bütün ekranlar

| | Bugün | Sonra |
|---|---|---|
| Tema | Açık (beyaz) | Koyu, sitedeki renkler; tek vurgu sarı |
| Üst çubuk | "Rung", altında gri "mainnet" ya da "devnet" | Merdiven işareti, "Rung" ve yeşil noktalı "mainnet" rozeti (devnet'te gri) |
| Token satırı | Resim, ad, altında "Token Ai66...pump" | Resim, ad, altında yalnız "Ai66...pump" |
| Düğmeler | Siyah, sayfanın en altında, kaydırınca görünüyor | Sarı ana düğme, ekranın altına sabit |

### Alım ekranı

| Bugün | Sonra |
|---|---|
| "Token address" başlığı, yazı kutusu, yanında "Paste" | Token yokken kesikli kutu ("Token address", "pump.fun token address"), alttaki büyük düğme "Paste". Yapıştırınca kutu token kartına döner: resim, ad, adres ve silme işareti |
| Kartta havuz adı, "Price you saw", "0.01 SOL buys about 40.795274 tokens now" | Havuz adı ve "Price you saw" Details'e taşınır. Token sayısı tutarın altında: "≈ 40.8 CATE" |
| "Mode" başlığı ve beş büyük düğme | Tek çip: "Mode · Tight 1% → 2% → 3%". Dokununca alttan liste açılır: beş mod ve yanlarında ne için oldukları |
| "Amount (SOL)" başlığı ve yazı kutusu (telefonun klavyesi açılır) | Büyük tutar "0.01 SOL", altında "≈ $0.69" ve "≈ 40.8 CATE". Hazır tutarlar 0.01 · 0.05 · 0.1 · 0.5. Uygulamanın kendi tuş takımı; boşalan yer tuşlara gider |
| "If no rung fills, max fee: …", altında "+ approval fee…", "Details" açılır kutusu | Düğmenin üstünde tek satır: "Max fee 0.00002915 SOL" ve "Details". Details alttan bir sayfa açar |
| Düğme: "Buy once · one wallet approval covers every try" | Düğme: "Buy once". Cümlenin kalanı Details'te |
| Düğmenin altında tavan cümlesi ve düğmenin neden kapalı olduğu | Tavan cümlesi Details'in ilk satırı. Hata satırları ilgili yerin altında (aşağıda 1. madde) |
| En altta "Wallet BRoK...yaue · 0.035 SOL · Disconnect" | Üst çubukta küçük cüzdan çipi. Dokununca "Wallet BRoK...yaue · 0.035 SOL" ve "Disconnect" |
| Sağ üstte "History" yazısı | Saat simgesi |
| "Waiting for your wallet…" satırı | Alttan sayfa: dönen çember ve "Waiting for your wallet…" |

### Merdiven

| Bugün | Sonra |
|---|---|
| Token satırı ve "Price you saw: …" | Token satırı, altında "0.01 SOL · Tight 1% → 2% → 3%". "Price you saw" bu ekrandan kalkar (makbuzun Details'inde var) |
| Basamaklar düz liste | İki direkli, çizilmiş merdiven: denenen basamak sarı, alan yeşil, kaçan kırmızı |
| "price was above this rung" | "missed" |
| "bought, 2.28% above the price you saw" | "bought · +2.28%" (fark yoksa yalnız "bought") |
| "not tried, the order ran out of time" | "not tried" |
| İşlem bağlantıları | Aynı; kaçan denemenin yanında "missed" |

### Makbuz

| Bugün | Sonra |
|---|---|
| "Bought Ai66...pump" ve altı satırlık kutu | Yeşil tik, "Bought Catecoin · CATE", altında adres. Büyük yazıyla "Tokens bought 40.795274" |
| 20% / 1% cümlesi ve altındaki satır | Aynı iki cümle ve arasında bir çizgi: kırmızı taralı 20%, yeşil 1% |
| Fiyat kutusu ve beş satırlık ücret-depozito kutusu | Ekranda üç satır: "Rung that filled", "SOL spent on the buy", "Fees" (toplam). Fiyatlar, fark, ücret ve depozito satırları "Details"e dokununca açılır |
| New buy, History | Aynı, altta sabit |

### Alınamadı

| Bugün | Sonra |
|---|---|
| Tek kalın satır: "Price went above your cap. Not bought. Your SOL is back." | Geri dönüş simgesi. Küçük "Price went above your cap.", büyük "Not bought. Your SOL is back." (kelimeler aynı, yalnız ikiye bölünüyor) |
| — | Üç küçük kart: try 1% · try 2% · try 3%; kaçanlar kırmızı |
| "After the last try the price was … above the price you saw." | Details'e taşınır (önerim; demoda bu satır yok) |
| "Fees: …." ve parantez içinde döküm | "Fees: …." kalır. Döküm Details'e taşınır (önerim; demoda döküm tamamen kalkmıştı) |
| Retry, New buy, History alt alta | Sarı "Retry with Launch mode"; altında yan yana New buy · History |

### Geçmiş

| Bugün | Sonra |
|---|---|
| Her alım uzun bir kutu: tarih, yedi satır, bağlantılar | Her alım tek satır: renkli nokta, token adı, "Tight · 24.11.2026", sonuç ("try 1%" ya da "not bought"). Dokununca satırlar ve bağlantılar açılır |
| Üstte "Rung" ve "History" başlığı | Geri oku ve "History" |

## Demoda olmayan, gerçek uygulamada gereken durumlar (önerilerim)

Demo kayıtlı emirleri oynatıyor; gerçek uygulamada hata, bekleme ve yeni token gibi durumlar da var. Demoda karşılıkları olmadığı için şöyle öneriyorum:

1. **Hatalar yerinde.** Token hatası token kutusunun altında, özel mod hatası çipin altında, tutar hatası ve "Not enough SOL in the wallet for this buy." tutarın altında (kırmızı). Cüzdan ya da ağ hatası düğmenin üstünde (kırmızı). "Getting a quote…" "≈ … CATE" satırının yerinde görünür.
2. **"Paste a token address." satırı kalkar.** Token yokken düğme zaten "Paste" diyor. Adres elle de yazılabilir: kesikli kutuya dokununca klavye açılır.
3. **Yeni açılmış token (ilk iki dakika).** Bugün Launch düğmesinin altında "suggested for a token's first two minutes" çıkıyor. Yeni düzende listede Launch'ın altında aynı söz; ana ekranda da çipin altında tek satır: "Launch 10-20-30% · suggested for a token's first two minutes". Dokununca Launch seçilir. Yalnız o iki dakika görünür.
4. **Ağ yüzünden geçmeyen deneme.** Merdivende bugünkü kırmızı "did not go through (…)" kalır.
5. **Makbuzdaki çizgi.** Alan basamak %20 ya da üstündeyse (Launch) çizgi çizilmez, yalnız cümle kalır; çizgi yanlış bir şey göstermesin.
6. **Alınamadı'nın öbür iki hali.** "The order ran out of time before any rung was tried." ve "Not bought, and the refund was not seen yet. Open the links below to check." aynı düzende: sebep küçük, "Not bought…" büyük.
7. **Ağ rozeti.** Mainnet yeşil, devnet gri. Gerçek parayı deneme parasından ayıran işaret bu.
8. **Geçmişteki bağlantılar.** Kaybolmaz, satır açılınca görünür.

İstenirse bunlar önce bir demoda gösterilebilir.

## Sözler (Buğra'ya sorulacaklar)

### Aynı kalanlar

Mod adları, "Buy once", "Rung climbs for you, automatically", "Most buyers type: 20% · This buy needed: 1%", "The gap is what a sandwich bot can take from you.", "Price went above your cap. Not bought. Your SOL is back.", "Retry with Launch mode", "New buy", "History", "Back", "The button connects your wallet first.", "Waiting for your wallet…", bütün hata cümleleri ve Details'teki döküm satırları.

### Yeri değişenler (kelimeler aynı)

- **Details içine:** tavan cümlesi; "If no rung fills, max fee: X SOL" ile "+ approval fee set by your wallet" (tek satırda birleşir); "one wallet approval covers every try"; havuz adı ile "Price you saw" (tek satırda, "·" ile); makbuzun fiyat, fark, ücret ve depozito satırları; alınamadı'nın fiyat ve döküm satırları.
- **Mod listesinde README'nin mod tablosundaki sözler:** "established tokens", "established tokens, everyday buys", "most-traded, fast-moving pools", "a token's first two minutes", "you choose 1–5 rungs and the cap". Sitede de aynen var ve orada `// verbatim` işaretli.
- **Makbuz başlığı:** "Bought Ai66...pump" → "Bought Catecoin · CATE" (ad okunamadıysa yine adres).
- **Merdivende yeni alt satır:** "0.01 SOL · Tight 1% → 2% → 3%" (tutar ve mod adı; ikisi de var olan sözler).
- **Alınamadı başlığı:** aynı cümle, iki satıra bölünmüş ("Buy once" düğmesindeki bölünme gibi; Buğra o zaman "olur" demişti).

### Yeni ya da kısalan sözler

| Bugün | Sonra |
|---|---|
| If no rung fills, max fee: X SOL (düğmenin üstünde) | Max fee X SOL |
| 0.01 SOL buys about 40.795274 tokens now | ≈ 40.8 CATE (sembol yoksa "≈ 40.8 tokens") |
| price was above this rung (merdiven), price above this rung (bağlantılar) | missed |
| bought, 2.28% above the price you saw / bought, 6.14% below the price you saw | bought · +2.28% / bought · -6.14% |
| not tried, the order ran out of time | not tried |
| (makbuzda yok) | Fees (toplam ücret satırı) |

### Ekrandan kalkanlar

"Paste a token address.", "Amount (SOL)" başlığı (ekran okuyucu için etiket olarak kalır), "History" yazısı (simge oldu; ekran okuyucu için kalır), adreslerin önündeki "Token", merdivendeki "Price you saw", alım ekranındaki "Hide details". Ekran okuyucu için yeni etiketler: "Clear", "Delete", "Back" (sitede de var).

### Sitedeki telefonla küçük bir fark

Site Details'te "One wallet approval covers every try." yazıyor (büyük harf, nokta). Uygulamada devir metnindeki gibi "one wallet approval covers every try" kalmasını öneriyorum: Details'teki öbür satırlar da küçük harfle başlıyor ve söz değişmemiş olur.

## Dokunulacak dosyalar

| Dosya | Ne değişir |
|---|---|
| `app/src/screens/ui.tsx` | Koyu renkler, üst çubuk ve ağ rozeti, düğmeler, token kartı, alttan açılan sayfa, satırlar; bağlantı notunda "missed" |
| `app/src/screens/BuyScreen.tsx` | Yeni düzen baştan: kart, çip, tutar, tuş takımı, alt bölüm, Details ve mod sayfaları, cüzdan çipi |
| `app/src/screens/LadderScreen.tsx` | Çizilmiş merdiven, kısa durumlar, alt satır |
| `app/src/screens/ReceiptScreen.tsx` | Sonuç başta, büyük sayı, çizgi, üç satır ve Details |
| `app/src/screens/NotBoughtScreen.tsx` | Büyük başlık, üç kart, Details |
| `app/src/screens/HistoryScreen.tsx` | Açılır satırlar, geri oku |
| Aynı klasörde yeni | Gerekirse tuş takımı ve alttan sayfa için bir iki küçük dosya |
| `App.tsx` (klasör dışı) | 2 satır: durum çubuğu yazısı açık renk (`StatusBar style="light"`), açılıştaki beyaz zemin koyu |

**Dokunulmayanlar:** `app/src/flow/`, `client/`, `tokenLabel.ts`, `percent.ts`, `funds.ts`, `sendFailure.ts`, `network.ts`, `config.ts`. Ekranların `App.tsx`'e bağlandığı yerler aynı kalır; bu yüzden `App.tsx`'te mantık değişmez.

**İsteğe bağlı, Buğra'nın kararı:** `app.json`'daki `"userInterfaceStyle": "light"` ve açılış resminin beyaz zemini. Değişirse uygulama yeniden derlenmeli.

## Testler

- **Ekran sözleri için test yok.** Depodaki tek sabit metin denetimi `web/scripts/check-verbatim.mjs`; yalnız sitenin `web/lib/copy.ts` ve `web/lib/status.ts` dosyalarını devir metniyle karşılaştırıyor. `docs/arayuz-notlari.md` ekrandaki sözlerin "testle denetlendiğini" söylüyor; bu denetim depoda değil, büyük olasılıkla Buğra'nın tarafında devir dosyasıyla yapılıyor. O denetim uygulamaya da bakıyorsa yukarıdaki "Yeni ya da kısalan sözler" tablosundaki altı söz takılır. Birleşen satırlar, satırın tamamını karşılaştıran bir denetimde de takılabilir.
- **`client/` testleri etkilenmez.** Uygulamaya bakan `client/test/app-*.test.ts` dosyaları ekranları değil, `app/src/` içindeki yardımcı dosyaları (funds, network, percent, sendFailure, tokenLabel, uygulama kimliği) okuyor; bunlara dokunulmuyor.
- **Geçmesi gereken:** `app/` içinde `npx tsc --noEmit` (tür denetimi). Merve'nin bilgisayarında `app/` ve `client/` paketleri kurulu olmadığı için çalıştırılmadı.
- **Ekranda deneme:** Merve'nin bilgisayarında Android öykünücüsü yok. Devnet'te deneme cüzdanıyla, Buğra'nın bilgisayarında denenir; mainnet alımını Buğra yapar.

## Açık kararlar (Buğra'nın)

1. Bütün yeni düzen uygulamaya geçsin mi (yalnız 3. tur değil)?
2. Demoda olmayan 8 durum için yukarıdaki öneriler uygun mu, yoksa önce bir demoda mı gösterilsin?
3. `App.tsx`'teki 2 satır (koyu durum çubuğu ve açılış).
4. "Yeni ya da kısalan sözler" tablosundaki altı söz (devir metninde olmayanlar).
5. Yeni paket olmasın mı (simgeler basit şekil, yazı tipi telefonunki)? Sitedeki başlık yazı tipi (Archivo) istenirse sonra eklenebilir.

## Teknik notlar (uygulayacak kişi için)

- Ekran bileşenlerinin props'u aynı kalır (`BuyScreen`: user, busy, error, onBuy, onHistory, onDisconnect; öbürleri de aynı).
- Alttan sayfalar React Native'in kendi `Modal`'ıyla açılır; Android Geri tuşu `onRequestClose` ile kapatır. Mod sayfasındaki özel basamak kutusu klavyenin altında kalmasın diye `KeyboardAvoidingView`.
- Tutar uygulamanın tuş takımıyla girilir; tutar metni yine `parseSol` ile okunur. Ondalık tuşu ".".
- "≈ 40.8 CATE" için kısa sayı biçimi ekranlar klasöründe yeni, saf bir işlev olur (sitedeki `fmtTokShort` kuralı: 1000 ve üstü küsuratsız, 1 ve üstü en çok 2 basamak, altı 6 basamak). `client/test/` Buğra'nın klasörü olduğu için oraya test eklenmez; istenirse onun ajanı ekler.
- "bought · +2.28%" var olan `signedPctText` ile yazılır (sıfıra yuvarlanınca yalnız "bought").
- Alınamadı kartları `r.rungsBps` ve `r.transactions` içindeki "try X%" etiketlerinden çıkar: denenmiş ve kaçmış kırmızı, denenmemiş gri.
- Makbuzdaki "Fees" toplamı geçmiş ekranındaki gibi: `rungFees + (approvalFee ?? 0)`.
- Üst çubuktaki merdiven işareti sitedekiyle aynı; Rung simgesi seçilince ikisi birlikte değişir.
- Uygulamada `react-native-svg` yok; eklenirse geliştirme APK'sı yeniden derlenmeli. Bu yüzden simgeler `View` ile çizilir.
