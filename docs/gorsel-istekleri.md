# Görsel istekleri: giriş videosu (Seeker) ve simge

**Kime:** Merve ve ajanı. **Kimden:** Buğra (isteği) ve ajanı (yöntemi yazdı), 26 Kasım 2026.
**Neden bu dosya:** üretim Merve'nin bilgisayarında, Merve'nin Google hesabıyla yapılacak. Burada iki iş var: girişteki Seeker için bir Flow videosu ve Rung simgesi. Yöntem, Buğra'nın Canton hackathon sitesinde 25 Kasım'da denenmiş olan yöntemdir; orada tutan ve tutmayan şeyler aşağıya yazıldı.

Bu dosya aynı zamanda kayıt defteridir: her üretimden sonra en alttaki "Üretim kaydı"na kullanılan prompt aynen, deneme sayısı, harcanan kredi ve çıkan dosyalar yazılır.

## 1. Giriş videosu: düşerek gelen Seeker

### Bugün sitede ne var

"Sade Rung sitesi" taslağında (2. tur) girişin sağ sütununda üç katman duruyor:

- `.sol-field`: eğik, mor-yeşil Solana çizgileri, yavaşça süzülüyor.
- `img.seeker-back` (`img/seeker-kesik.png`, Solana Mobile basın kitinden): canlı telefonun arkasında, %42 opaklıkta. `seeker-in` animasyonuyla soldan iki tur dönerek geliyor (`translateX(-110vw) rotate(-720deg)`, 3,4 sn).
- `.device.seeker#phone`: kodla çizilmiş telefon; ekranında gerçek bir mainnet emrinin tekrarı oynuyor.

Sorun ikinci katmanda: düz bir resmin kodla döndürülmesi yapay duruyor.

### İstenen (Buğra'nın tarifi)

Mutfak reklamı videolarındaki his: ekmek kesilir, limon havadan düşer, parçacıklar saçılır; hepsi ağır çekimde. Aynısının Seeker'la yapılmışı: telefon dönerek düşer, yerine oturur, çevresine parçacık saçılır. Sitedeki bugünkü halini andırmalı, yani yine canlı telefonun **arkasındaki** katman olacak.

### Üç karar (öneri; görünümün sahibi Merve)

1. **Video yalnız arka katmanı değiştirir.** `img.seeker-back` yerine `<video class="seeker-back">` gelir. Öndeki canlı telefon (`#phone`) kodda kalır.
2. **Videoda ekran, arayüz, sayı ya da yazı olmaz.** Veo yazıyı bozar; ayrıca projenin kuralı sahte gösterim olmamasıdır. Gerçek veri öndeki telefonda zaten oynuyor.
3. **Zemin saf siyah üretilir, sitede `mix-blend-mode: screen` ile bindirilir.** Sayfa zemini `#0B0D10` olduğu için siyah yok olur, parlayan kenarlar ve parçacıklar kalır. Maske çıkarmak, kare kare ayıklamak gerekmez.

### Adım 1 — Durağan görsel (Gemini, "Görüntü oluştur")

Sitenin kullandığı basın kiti görselini (`seeker-kesik.png`'nin kaynağı) başvuru olarak ekle. Oran 9:16 (yoksa 16:9; o zaman telefon ortadaki üçte birde dursun).

> Use the attached product photo as the exact reference for the phone: same shape, same proportions, same camera module, same colour, seen from the same side. Create a studio product photograph of this one smartphone floating upright in mid-air, tilted about 10 degrees clockwise, the whole phone fully visible inside the frame with generous empty margin on every side; the phone takes about 60% of the frame height and sits in the centre. Pure black seamless background (#000000) filling the whole frame. A thin cool-white rim light runs along both long edges so the dark body separates clearly from the black background; one soft key light from the upper left; crisp specular highlights on the metal frame and the camera lenses; tack-sharp focus everywhere. If any part of the screen is visible it is switched off and plain black. No cast shadow, no reflections on the background, no table, no hands, no particles, no added text, no added logos, no watermark, nothing else in the frame. Aspect ratio 9:16, high resolution.

Kabul ölçütü: telefon tek parça ve kadrajın içinde; zemin gerçekten siyah; gövdenin iki uzun kenarı ışıkla çizilmiş (yoksa `screen` bindirmesinde telefon görünmez); üzerinde uydurma yazı ya da logo yok. Tutmazsa aynı sohbette tek bir düzeltme isteği yaz (Canton'da bu çalıştı), baştan üretme.

Çıktı: `kaynak/seeker/seeker-source.jpg` (özgün dosya, dokunulmadan saklanır).

### Adım 2 — Video (Flow, Veo 3.1 Fast)

Ayar: "Kareler" (başlangıç karesi olarak adım 1'in görseli), 9:16, 8 sn, 720p, 1 çıkış. Ses yok sayılır.

**Video A — "kalkış" (tersine oynatılacak; önce bu denenir).** Fikir: Veo ilk kareyi aynen korur, sonraki kareleri uydurur. Telefonu yerinden kaldırıp kadrajdan çıkarırsak ve dosyayı tersine çevirirsek, telefon dönerek gelir ve **tam olarak adım 1'deki keskin görselde durur**. Son kare bozulmaz; poster de aynı görsel olur.

> Starting from the provided image. Locked-off camera; the background stays pure black the whole time. For the first second the phone hangs perfectly still. Then, in smooth slow motion like a high-speed product commercial, it lifts and flies up and out through the top of the frame while tumbling end over end, one slow full flip. As it starts to move, a burst of small glowing particles is thrown off around it: thin slanted shards of light in violet and mint green, with a few amber sparks, drifting outward and fading to black before the end. The phone stays one rigid object with exactly the same design the whole time: same shape, same camera module, same proportions; nothing bends, melts, splits or changes, and no second phone appears. Its other side is plain black glass, switched off, with no interface and no text. In the last second the frame is completely black and empty. Constant rim light, one continuous motion, no cuts, no zoom, no camera shake, no new objects, no smoke, no text, no logos.

**Video B — "düşüş" (düz oynatılır; A tutmazsa).** Başlangıç ve bitiş karesi birlikte verilir. Bitiş karesi adım 1'in görseli. Başlangıç karesi için Gemini'de aynı sohbette düzenleme iste: "Edit your last image. Keep the black background and lighting identical. The same phone is now at the very top of the frame, upside down and mostly out of frame, small because it is further away. Nothing else changes."

> The first frame and the last frame are provided. Locked-off camera; the background stays pure black the whole time. In smooth slow motion like a high-speed product commercial, the phone falls into the frame from the top, tumbling end over end, one slow full flip, and comes to rest exactly in the pose of the last frame. At the moment it stops, a burst of small glowing particles springs outward from around it: thin slanted shards of light in violet and mint green, with a few amber sparks, which drift and fade to black. The phone then hangs perfectly still for the last second. It stays one rigid object with exactly the same design the whole time; nothing bends, melts, splits or changes, and no second phone appears. Its other side is plain black glass, switched off, with no interface and no text. One continuous motion, no cuts, no zoom, no camera shake, no new objects, no smoke, no text, no logos.

Parçacıkların rengi sitenin dilinden geliyor: `.sol-field` çizgilerinin mor-yeşili ve tek vurgu olarak sitenin sarısı (`#FFC233`). Başka renk ekleme.

### Adım 3 — İnandırıcılık denetimi (her video için)

Videodan eşit aralıklı 10 kare çıkar ve tek tek bak. Biri bile kalırsa video kullanılmaz.

| Ölçüt | Nasıl bakılır |
|---|---|
| Hep tek ve aynı telefon | kamera modülü, köşeler, oran her karede aynı; ikinci telefon ya da fazladan parça yok |
| Uydurma yazı, logo, arayüz yok | dönerken görünen öbür yüz düz siyah cam |
| Zemin siyah | köşelerdeki pikseller 0'a yakın; gri sis, zemin çizgisi, gölge yok |
| Kamera sabit | telefonun durduğu karelerde kenarlar kaymıyor |
| Telefon dururken keskin | A'da ilk kare, B'de son kare adım 1'in görseliyle aynı |
| Yeni nesne yok | el, masa, duman, ışık kaynağı belirmiyor |

### Adım 4 — Dosyaya çevirme

```
# Video A: tersine çevir, sondaki boş siyah saniye başa geleceği için onu at
ffmpeg -i seeker-a.mp4 -vf "reverse,trim=start=1,setpts=PTS-STARTPTS" -an -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart seeker-in.mp4
# Poster: telefonun durduğu keskin kare (A'da özgün videonun ilk karesi)
ffmpeg -i seeker-a.mp4 -frames:v 1 -q:v 80 seeker-poster.webp
```

Video B için `reverse,trim` kısmı çıkar; poster son kareden alınır (`-sseof -0.1`). Hedef: video 1,5 MB'ın altında.

### Adım 5 — Siteye koyma

```html
<video class="seeker-back" muted playsinline preload="auto" poster="img/seeker-poster.webp" aria-hidden="true">
  <source src="img/seeker-in.mp4" type="video/mp4">
</video>
```

- `.seeker-back` üzerindeki `seeker-in` animasyonundan dönüş ve kayma kalkar (hareketi artık video taşıyor); yalnız opaklık geçişi kalır. `mix-blend-mode: screen` eklenir. Opaklık yeniden ayarlanır; siyah zemin yok olduğu için %42'den yükseğe çıkabilir.
- Video bir kez oynar ve son karede kalır (`loop` yok). Giriş ekranda göründüğünde başlatılır.
- "Hareketi azalt" açıksa video oynatılmaz, poster kalır. Sayfada bu ayrım zaten var (`prefers-reduced-motion`).
- Dar ekranda bugün `.seeker-back` bazı genişliklerde gizli; aynı kural korunur ya da yalnız poster gösterilir.
- Alt bilgideki "Solana Mobile press kit" atfı kalır.

### Canton'da öğrenilenler (25 Kasım 2026, aynı araçlar)

- **Dönen nesne biçim değiştirir.** Pirinç pergel bir çeyrek tur dönerken menteşesi başka bir tasarıma dönüştü ve son karelerde üçüncü bir bacak belirdi; o video atıldı. Bu yüzden yukarıdaki prompt'lar "one rigid object", "no second phone", "other side is plain black glass" diye ısrar ediyor ve tek takla istiyor.
- **Savrulan parça bulanıklaşır.** Ağır çekim istemek bunu azaltır; yine de durduğu kare keskin olmalı. Video A'nın nedeni bu.
- **Başlangıç ve bitiş karesi her zaman kurtarmaz.** İki hizalı kare arasındaki "yalnız cam netleşsin" isteğinde Veo panelleri kapı gibi kaydırdı; iki deneme de reddedildi. Büyük bir hareket (düşüş) bu kip için daha uygun bir iştir, ama garanti değildir.
- **İstenmeyeni adıyla say.** "No particles" yazılmayan videoda parçacık, "no new objects" yazılmayan videoda kablo ve tabure çıktı. Burada parçacık isteniyor; rengi, biçimi ve "fade to black" bu yüzden tek tek yazılı.
- **Siyah zemin tutuyor.** Saf siyah isteyip sabit kamera yazınca zemin dört videonun dördünde de siyah kaldı.
- **Maliyet (Flow'un istem kutusunda görülen, 8 sn, 1 çıkış):** Veo 3.1 Lite 10 kredi, Veo 3.1 Fast 20 kredi, Veo 3.1 Quality 100 kredi. Ücretsiz planda günde 50 kredi vardı. Fiyatlar değişmiş olabilir; üretmeden önce kutuya bak.

### Ajanın uyacağı kurallar

- Üretmeden önce Merve'ye ne üretileceğini ve kaç kredi gideceğini söyle. Bakiyeyi önce ve sonra yaz.
- Sormadan en çok iki video (A, sonra gerekirse B). Üçüncüsü için Merve'ye sor.
- Flow görsel yüklerken "Bu resmin kullanım hakları" penceresi açabilir. Onu ajan onaylamaz; Merve kendisi basar.
- İkisi de tutmazsa kredi yakmaya devam etme. Yedek: adım 1'in görseli tek başına bugünkü `seeker-kesik.png`'den daha iyi bir arka katmandır; durağan kalabilir, parçacıkları kod çizer.

## 2. Simge: cüzdanlarda Rung görünmüyor

### Sorun

Site hâlâ Next.js'in varsayılan simgesini taşıyor (`web/app/favicon.ico`, "N" harfi). Cüzdanlar uygulamanın simgesini siteden aldığı için:

- **Phantom** bağlantı ve onay pencerelerinde "N" gösteriyor: [ekran](shots/wallet-phantom-confirm-rungbot-new-domain.png).
- **Solflare** simgeyi hiç gösteremiyor, yerine boş bir küre koyuyor: [ekran](shots/wallet-solflare-approval-rungbot.png).

Uygulamanın kendi simgesi de (`app/assets/`) Expo'nun varsayılanı.

### İstenen

Tek bir Rung işareti, her yerde aynı.

- Kare; 48 pikselde okunur (cüzdan pencerelerindeki boyut). İnce çizgi ve küçük yazı yok.
- Sitenin renklerinden: zemin `#0B0D10`, açık `#ECEFF2`, tek vurgu `#FFC233`.
- Kodla, SVG olarak çizilir (işaret soyut bir biçim; üretilmiş görsel gerekmez). Ne anlatacağı Merve'nin kararı; adın anlamı merdiven basamağı.

### Bırakılacak dosyalar

| Dosya | Boyut | Nerede kullanılır |
|---|---|---|
| `web/app/favicon.ico` | 16, 32, 48 (tek dosyada) | tarayıcı sekmesi; Phantom bugün bunu okuyor |
| `web/app/icon.png` | 512×512 | sitenin simgesi |
| `web/app/apple-icon.png` | 180×180 | iOS ana ekran |
| `web/public/rung-icon.png` | 256×256 | cüzdanlar için sabit adres: `https://rungbot.xyz/rung-icon.png` |
| `app/assets/icon.png` | 1024×1024 | Android uygulama simgesi |
| `app/assets/adaptive-icon.png` | 1024×1024, işaret ortadaki %66'da | Android uyarlanır simge (ön katman) |
| `app/assets/favicon.png` | 48×48 | uygulamanın web önizlemesi |

SVG kaynağı da depoya girsin (`web/public/rung-icon.svg`).

### Sonrası Buğra'nın ajanında

Dosyalar gelince: `app/src/config.ts` içindeki `APP_IDENTITY.icon` satırı PNG'ye çevrilir (Solflare `.ico` dosyasını gösteremiyor olabilir), `app/app.json` içindeki beyaz zemin renkleri koyuya alınır, sonra Phantom ve Solflare'de öykünücüde bakılır. Bu adımlar cüzdan ve öykünücü istediği için Merve tarafında yapılmaz; dosyaları bırakıp haber vermek yeter.

## Üretim kaydı

(Her üretimden sonra buraya: tarih, araç ve ayar, deneme sayısı, kullanılan prompt aynen, kredi önce ve sonra, çıkan dosyalar, denetim sonucu.)
