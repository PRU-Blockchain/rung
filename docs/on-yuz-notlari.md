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
  - "Replay of a real mainnet order, Nov 24, 2026, sent with the command-line script (same program): the 1%, 2% and 3% rungs missed, the 5% rung bought."
  - "Replay of a real mainnet order, Nov 24, 2026, sent with the command-line script (same program): every rung missed and the SOL came back."
  - Senaryo düğmeleri sayaçtaki biçimi kullanıyor: "bought on rung 1 (1%)", "bought on rung 4 (5%)", "not bought". "How to try" listesinde "README: Mainnet runs" bağlantısı da var.
- **"Sadece o kalsın" sözünün yorumu:** Buğra'nın "sitede yalnız telefon kalsın" sözü demoda şöyle uygulandı: telefon açılışta; sitenin bugünkü bölümleri (sayaç, son alımlar, modlar, terimler, kaynaklar) telefonun altında duruyor, çünkü devir metni sitede bunları istiyor. Yalnız telefon istenirse kalanı çıkarılabilir.

## Demodaki veriler

- Üç senaryo da 24 Kasım'daki gerçek mainnet emirleri; imzalar README'deki "Mainnet runs" bölümünden:
  - uygulamadan CATE alımı, %1 basamağında aldı;
  - betikle gönderilen beş basamaklı tırmanış: %1, %2 ve %3 kaçtı, %5 basamağı görülenin %3.83 üstünden aldı;
  - betikle gönderilen ve alınamayan emir: cüzdandan 0.00003325 SOL ücret çıktı, kalan SOL geri döndü.
- Site demosundaki sayaç, `web/lib/counter.ts`'nin mainnet'e çevrilmiş bir kopyasıyla 25 Kasım 18:12 UTC'de okundu: 17 emir açıldı; 14'ü alındı, 2'si alınamadı, 1'i henüz sonuçlanmadı. Bu emirlerde ortalama %2.07'lik basamakta alındı.
- Uygulama ekranlarında, ekranda görünen yeni bir İngilizce kelime yok. Yalnız ekran okuyucu için "Clear" ve "Delete" etiketleri eklendi.
