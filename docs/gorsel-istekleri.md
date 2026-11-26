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

### 26 Kasım 2026 · Adım 1, durağan görsel (Gemini)

- **Araç ve ayar:** Gemini web, Merve'nin Pro hesabı, "Görüntü oluştur", en-boy oranı 9:16. Başvuru görseli `rung-demo/img/seeker-press-9.jpg` (basın kitinden, 800×799) panodan yapıştırılarak eklendi.
- **Deneme:** 1. Düzeltme isteği gerekmedi.
- **Prompt:** yukarıdaki Adım 1 prompt'u, kelimesi kelimesine aynı.
- **Kredi:** Gemini'de kredi sayacı görünmedi. Flow kredisi harcanmadı.
- **Çıktı:** `kaynak/seeker/seeker-source.jpg` (1536×2752, 1,2 MB). Gemini'nin indirdiği ad: `Gemini_Generated_Image_qvwhgiqvwhgiqvwh.jpeg`.
- **Denetim:** kabul.
  - Tek telefon, tamamı kadrajda. Yüksekliğin %71'ini kaplıyor (istenen yaklaşık %60).
  - Zemin siyah: köşelerde ve kenar bantlarında en yüksek değer 7/255.
  - Kamera modülü, "SEED VAULT" paneli ve alttaki logo başvuru görseliyle aynı; uydurma yazı yok.
  - Sol uzun kenardaki ışık zayıf, ama gövde açık camgöbeği olduğu için siyahtan ayrılıyor.

### 26 Kasım 2026 · Adım 2–5, Video A (Flow)

- **Araç ve ayar:** Flow web, Merve'nin Pro hesabı. Yeni proje; alt kutuda Flow Agent kapalı. Ayarlar: Video › Kareler, 9:16, Veo 3.1 - Fast, x1 (720p, 8 sn).
- **Başlangıç karesi:** `kaynak/seeker/seeker-source.jpg`, panodan yapıştırıldı.
- **Onaylar:**
  - "Bu resmin kullanım hakları" penceresini Merve onayladı.
  - Flow'un ilk açılışındaki gizlilik politikası adımını da Merve geçti.
  - İlk açılış tanıtımında pazarlama e-postası ve kullanıcı araştırması kutuları boş bırakıldı.
- **Deneme:** 1. Video B gerekmedi.
- **Prompt:** yukarıdaki Video A prompt'u, kelimesi kelimesine aynı.
- **Kredi:** önce 1.050, sonra 1.030 (20 kredi).
  - Model listesinde Veo 3.1 Fast ve Quality için "5 Ara tarihinde kaldırılacak" yazıyor.
  - Varsayılan model artık Omni 1.2 Flash; aynı ayarla 24 kredi.
- **Çıktılar:**
  - `kaynak/seeker/seeker-a.mp4`: Flow'un 720p özgün indirmesi; 720×1280, 24 fps, 7,9 sn, 2,1 MB. Flow'un verdiği ad: `Phone_lifting_and_tumbling_78a265a1.mp4`.
  - Sade site demosunda `img/seeker-in.mp4`: tersine çevrildi, ilk saniye atıldı, sessiz; 6,9 sn, 1,47 MB.
  - Sade site demosunda `img/seeker-poster.webp`: 17 KB.
  - Dönüştürme: bu Mac'te Homebrew yok. Youtube_edit klasöründeki imageio-ffmpeg'in ffmpeg 9.0'ı kullanıldı; komutlar yukarıdakiyle aynı.
- **Denetim:** kabul. Bakılanlar: eşit aralıklı 10 kare, ayrıca 0,25 sn arayla 32 kare.
  - Hep tek ve aynı telefon; kamera modülü, "SEED VAULT" paneli ve logo havadayken de tutarlı.
  - Dönerken görünen ön yüz düz siyah cam; arayüz ya da yazı yok.
  - Zemin siyah: köşelerin ortancası her karede 0–1.
  - Kamera sabit: ilk saniye telefon kıpırdamıyor, ilk kare adım 1'in görseli.
  - Yeni nesne yok.
  - Parçacıklar istenen ince ışık kıymıklarından çok maytap kıvılcımına benziyor (mor, beyaz, mint, birkaç sarı).
  - Telefonun yolu: önce yukarı kalkıp tepede yatay dönüyor, ortaya inip takla atıyor, sonra yukarıdan çıkıyor. Tersine oynayınca yukarıdan gelir, ortada döner, bir an yükselip yerine iner; parçacıklar telefona doğru toplanır.
- **Sitede (adım 5):**
  - `img.seeker-back` yerine `<video class="seeker-back">` geldi; `mix-blend-mode: screen`.
  - Opaklık 0,62 (tablette 0,5, telefonda 0,6). Dönme ve kayma animasyonu kalktı; yalnız 0,6 sn'lik opaklık geçişi var.
  - Video giriş göründüğünde bir kez oynar ve son karede kalır. "Hareketi azalt" açıksa ya da video oynamazsa poster gösterilir.
  - Poster baştan verilmedi; verilseydi oynatma başlarken duran telefon kaybolup yukarıdan gelirdi.
  - Siyahın gerçekten kaybolması için telefon kolonundaki `z-index` ve `isolation` kaldırıldı. Arka katmanlar eksi z-index yerine sayfadaki sırayla dizildi; eksi değer onları gövdenin zemininin arkasına atıyordu.
  - Masaüstü, tablet ve telefonda denendi; dikdörtgen kenarı görünmüyor.

### 26 Kasım 2026 · Video C (Flow), reddedildi

- **Neden üretildi:** Merve Video A'yı beğenmedi.
  - Parçacıklar maytap gibi; tek noktada toplanıp telefona doğru gidiyor, renkleri ucuz duruyor.
  - Arkadaki Seeker öndeki telefonun arkasında kayboluyor, kamerası görünmüyor.
  - İstediği: daha yumuşak bir iniş, kareye yayılmış parçacıklar, başka renkler.
- **Ayar:** Video A ile aynı (Kareler, Veo 3.1 - Fast, 9:16, x1). Başlangıç karesi de aynı; projedeki görselden seçildi, yeniden yüklenmedi.
- **Deneme:** 1.
- **Prompt (aynen):** "Starting from the provided image. Locked-off camera; the background stays pure black the whole time. For the first second the phone hangs perfectly still and nothing else is in the frame. Then it starts to move very gently, slowly accelerating, and glides smoothly up and out through the top of the frame in one graceful, continuous motion, turning slowly by about 30 degrees in the image plane. Its back with the camera module faces the camera the whole time: no flip, no tumbling, the front glass is never visible. While it rises, a wide, sparse field of tiny soft particles fades in across the whole frame: fine pale silver-white and soft teal dust motes at different depths, a few gently out of focus, evenly spread from edge to edge. They float slowly and calmly; they do not come from the phone, do not burst, do not streak and never gather in one place; they fade away before the end. The phone stays one rigid object with exactly the same design the whole time: same shape, same camera module, same proportions; nothing bends, melts, splits or changes, and no second phone appears. In the last second the frame is completely black and empty. Constant rim light, one continuous motion, no cuts, no zoom, no camera shake, no new objects, no smoke, no sparks, no fireworks, no text, no logos."
- **Kredi:** önce 1.030, sonra 1.010 (20 kredi). Onaylanan 40 kredilik sınır doldu.
- **Çıktı:** `kaynak/seeker/seeker-c.mp4`: 720×1280, 8 sn, 6,5 MB. Flow'un verdiği ad: `Phone_moving_against_black_backg…_770490db.mp4`.
- **Denetim:** reddedildi.
  - Telefon istenmediği halde dik ekseninde dönüp yan döndü.
  - Döndükten sonra tasarım değişti: dört lensli kamera şeridi, parmak izi okuyucusu, sağa geçmiş ve yazısı ters dönmüş panel, arkada uydurma bir logo yazısı.
  - Son saniye tam boş değil.
  - Parçacıklar istenen gibiydi: gümüş beyazı ve camgöbeği, kareye yayılmış ince toz.
- **Ders:** Telefonun görünmeyen yüzünü gösterecek bir dönüşe yer bırakınca Veo tasarımı uyduruyor; "no flip" yazmak yetmedi. Bir sonraki denemede telefon hiç dönmemeli, yalnız kaymalı.

### 26 Kasım 2026 · Video D (Flow), kullanıldı

- **Onay:** Merve 40 krediden sonra bir video daha onayladı.
- **Ayar:** Video A ve C ile aynı. Başlangıç karesi projedeki görselden seçildi.
- **Deneme:** 1.
- **Prompt (aynen):** "Starting from the provided image. Locked-off camera; the background stays pure black the whole time. For the first second the phone hangs perfectly still and nothing else is in the frame. Then it starts to move very gently, slowly accelerating, and glides straight up and out through the top of the frame in one smooth, continuous motion. The phone does not rotate at all: it keeps exactly the same angle and the same side facing the camera the whole time, like a product slowly lifted on an invisible wire; only its position changes. While it rises, a wide, sparse field of tiny soft particles fades in across the whole frame: fine pale silver-white and soft teal dust motes at different depths, a few gently out of focus, evenly spread from edge to edge. They float slowly and calmly; they do not come from the phone, do not burst, do not streak and never gather in one place; they fade away before the end. The phone stays one rigid object with exactly the same design the whole time: same shape, same camera module, same proportions, same markings; nothing bends, melts, splits or changes, and no second phone appears. By the last second the phone has completely left the frame and the frame is black and empty. Constant rim light, one continuous motion, no cuts, no zoom, no camera shake, no new objects, no smoke, no sparks, no fireworks, no added text, no added logos."
- **Kredi:** önce 1.010, sonra 990 (20 kredi). Toplam 60 kredi: A, C ve D.
- **Çıktı:** `kaynak/seeker/seeker-d.mp4`: 720×1280, 7,9 sn, 3,8 MB. Flow'un verdiği ad: `Phone_rising_past_particles_c0cf721a.mp4`.
- **Denetim:** kabul, iki notla.
  - Telefon dönmüyor; tasarımı her karede aynı (kamera modülü, "SEED VAULT" paneli, logo). Uydurma yazı yok.
  - Zemin siyah, kamera sabit, yeni nesne yok.
  - Toz istenen gibi: gümüş beyazı ve camgöbeği, kareye yayılmış.
  - Not 1: 1.–2,6. saniyede toz telefonun ortasından yatay bir bant halinde çıkıyor; tersine oynatınca telefona doğru toplanırdı.
  - Not 2: son karelerde telefonun alt ucu hâlâ kadrajın tepesinde.
- **Kurgu:**
  - Özgün videonun 2,6. saniyeden sonrası tersine çevrildi; toplanma görünen bölüm hiç kullanılmadı.
  - Sona, videonun ilk karesine 1,2 saniyelik bir geçiş eklendi: toz söner, telefon keskin karede durur.
  - İlk 2,6 saniyede telefon en çok yüzde 2 kaydığı için geçişte sıçrama görünmüyor.
  - Sonuç: 5,7 sn, 720×1280, crf 26, 1,29 MB.
- **Sitede:**
  - `img/seeker-in.mp4` ve `img/seeker-poster.webp` yenilendi.
  - Video öğesi 28° çevrildi: telefon basın fotoğrafındaki gibi çapraz durur, kameralı üst ucu öndeki telefonun sağ üstünde açıkta kalır.
  - Opaklık 0,9. Tablette masaüstü yerleşimi; telefonda 400 px genişlik ve kameralı uç uygulamanın sağ üstünde.
  - Masaüstü (1440×900, 1280×620), tablet (768×1024) ve telefon (375×812) boyutlarında denendi.

### 26 Kasım 2026 gecesi · Merve'nin kararı: ışıltı yok, Seeker soldan dönerek gelsin, video yine Flow'da

- **Merve'nin notu:**
  - Video A ve D'deki parçacık ve ışıltılara gerek yok.
  - Seeker, eski introdaki gibi ekranın solundan döne döne gelsin.
  - Video yine Flow'da üretilsin; eski koddaki resim introsuna dönülmesin.
- **Başlangıç karesi (yeni):** `kaynak/seeker/seeker-source-16x9.png`, 1920×1080.
  - Adım 1'in görseli ffmpeg ile 28° saat yönünde çevrildi ve 16:9 siyah karenin sağına (yatayda %73) kondu.
  - Telefon basın fotoğrafındaki gibi çapraz; kameralı ucu sağ üstte.
  - Panodan Flow'a yüklendi; kullanım hakları penceresi bu kez çıkmadı.

### 26 Kasım 2026 · Video E (Flow), reddedildi

- **Ayar:** Kareler, 16:9, Veo 3.1 - Fast, x1. Başlangıç karesi yukarıdaki 16:9 görsel.
- **Prompt (aynen):** "Starting from the provided image. Locked-off camera; the background stays pure black the whole time. For the first second the phone hangs perfectly still. Then, in smooth slow motion like a high-end product commercial, it starts to spin in the image plane like a wheel, turning around the axis that points straight at the camera, so its back with the camera module always faces the camera and it never turns over; while spinning it travels smoothly to the left and leaves the frame through the left edge. About two full turns, one continuous motion, gently accelerating. The phone stays one rigid object with exactly the same design the whole time: same shape, same camera module, same proportions, same markings; nothing bends, melts, splits or changes, and no second phone appears. By the last second the phone has completely left the frame and the frame is black and empty. No particles, no sparkles, no dust, no light flares, no glow, no motion trails, no smoke, no new objects, no cuts, no zoom, no camera shake, no added text, no added logos."
- **Kredi:** önce 990, sonra 970.
- **Çıktı:** `kaynak/seeker/seeker-e.mp4`.
- **Denetim:** reddedildi.
  - Telefon kendi düzleminde dönmedi; yan dönüp takla attı.
  - Arkası başka bir telefona dönüştü: kare kamera modülü çıktı, "SEED VAULT" paneli kayboldu.
  - Video C'deki hatanın aynısı: Veo dönen telefonu tutarlı çizemiyor.

### 26 Kasım 2026 · Video F (Flow), kullanıldı

- **Onay:** Merve'nin seçimi "Flow + sayfada dönüş": Flow telefonu dönmeden soldan kaydırır, dönüşü sayfa ekler.
- **Ayar:** E ile aynı; başlangıç karesi projedeki 16:9 görsel.
- **Prompt (aynen):** "Starting from the provided image. Locked-off camera; the background stays pure black the whole time. For the first second the phone hangs perfectly still. Then it starts to move very gently, slowly accelerating, and glides straight to the left and out through the left edge of the frame in one smooth, continuous motion. The phone does not rotate at all: it keeps exactly the same angle and the same side facing the camera the whole time, like a product slowly pulled on an invisible wire; only its position changes. The phone stays one rigid object with exactly the same design the whole time: same shape, same camera module, same proportions, same markings; nothing bends, melts, splits or changes, and no second phone appears. By the last second the phone has completely left the frame and the frame is black and empty. No particles, no sparkles, no dust, no light flares, no glow, no motion trails, no smoke, no new objects, no cuts, no zoom, no camera shake, no added text, no added logos."
- **Kredi:** önce 970, sonra 950. Gün toplamı 100 kredi (A, C, D, E, F).
- **Çıktı:** `kaynak/seeker/seeker-f.mp4`: 1280×720, 7,9 sn, 0,8 MB.
- **Denetim:** kabul.
  - Telefon dönmüyor; tasarımı her karede aynı. Parçacık yok, zemin siyah.
  - Telefon sonda kadrajdan tamamen çıkıyor.
- **Kurgu:**
  - Tersine çevrildi; telefonun görünmediği ilk 4 kare atıldı.
  - Sonuç `img/seeker-in.mp4`: 7,75 sn, 242 KB. Poster son kareden (`img/seeker-poster.webp`).
- **Sitede:**
  - Video sade sitenin girişinde, 16:9 ve geniş.
    - Masaüstünde 1088 px genişlikte; sol kenarı yazı sütununun arkasında, telefon ekranın sol tarafından girer.
    - "screen" bindirmesi, opaklık 0,7 (tablette 0,6, telefonda 0,75).
  - **Dönüş:**
    - Telefonun her karedeki merkezi videodan ölçüldü.
    - 32 adımlık bir CSS animasyonu, öğeyi o merkez etrafında `transform-origin` ile iki tur döndürüyor.
    - Dönüş, telefonun yolundaki ilerlemeyle -720°'den 0°'ye iner; telefon durduğu anda biter.
    - Dönüş, video oynamaya başladığı anda başlar.
  - **Arka plan:** Solana çizgileri, Seeker geçerken soldan sırayla ve yavaşça belirir (1,4–5,4 sn arası, her biri 2,2 sn'de), sonra eskisi gibi süzülür.
  - "Hareketi azalt" açıksa video oynamaz ve dönmez; poster ve çizgiler durağan görünür.
  - Masaüstü (1440×900), tablet (768×1024) ve telefon (375×812) boyutlarında denendi.

### 26 Kasım 2026 · Video G (Flow, Omni 1.2 Flash), kullanıldı

- **Merve'nin notu:**
  - Kan portakalı reklamlarındaki çekicilik istendi: tepeden düşer, ağır çekim, çok iştah açıcı. Ama portakal ya da su olmayacak; telefona özgü bir özellik öne çıkacak.
  - Kurguyu ajana bıraktı. Modeli değiştirmeye izin verdi; Omni 1.2 Flash'ı onayladı.
- **Kurgu:**
  - Lüks araba reklamlarındaki gibi karanlıktan çıkış: telefon tepeden, dönmeden, ağır çekimde iner ve yerine oturur.
  - Sonra ince bir ışık bandı arkasından çapraz geçer: metal çerçeve parlar, lensler sırayla ışıldar, "Seed Vault" paneli yansıma alır (yerleşik güvenli cüzdan).
- **Ayar:** Video › Kareler, 16:9, Omni 1.2 Flash, 720p, 8 sn, x1 = 24 kredi.
  - Son kare: `kaynak/seeker/seeker-source-16x9.png`.
  - Başlangıç karesi: `kaynak/seeker/seeker-start-16x9.png`, aynı görsel 860 px yukarı kaydırılmış; telefonun yalnız alt ucu tepede görünüyor.
  - Kareler kipinde yalnız son kareyle başlatmak mümkün değil; başlangıç karesi zorunlu.
- **Deneme:** 1. İlk istem kan portakalı suyuyla yazılmıştı; Merve'nin notuyla üretmeden önce değiştirildi.
- **Prompt (aynen):** "Cinematic slow-motion product reveal, like a luxury car emerging from the dark in a premium commercial. Locked-off camera; pure black background the whole time; no environment. The first frame shows the bottom of the phone at the top edge; the phone descends straight down from above in smooth slow motion, without rotating: its back with the camera module faces the camera the whole time and it keeps exactly the same angle as in the last frame. As it comes down it slows gently and settles exactly into the pose of the last frame. At the moment it settles, a single crisp band of white light sweeps diagonally across its back from the lower left to the upper right: the polished metal frame flashes along its edges, the camera lenses glint one after another like headlights switching on, and the dark Seed Vault panel catches a clean reflection. Then the light calms and for the last second the phone hangs perfectly still, exactly as in the last frame. The phone stays one rigid object with exactly the same design the whole time: same shape, same camera module, same proportions, same markings; nothing bends, melts, splits or changes, and no second phone appears. No particles, no sparkles, no dust, no liquid, no smoke, no lens flares on the background, no new objects, no added text, no added logos, no cuts, no zoom, no camera shake."
- **Kredi:** önce 950, sonra 926.
- **Çıktı:** `kaynak/seeker/seeker-g.mp4`: 1280×720, 8 sn. Flow'un verdiği ad: `Phone_descending_with_light_sweep_b85f27df.mp4`.
- **Denetim:** kabul.
  - Tasarım her karede aynı; zemin siyah (köşelerin ortancası 0–1).
  - Telefon 3,5. saniyede tam son karenin yerinde duruyor (sınır kutusu son kareyle aynı).
  - Işık bandı 4,7–5,7. saniyelerde geçiyor; bir an gövdeyi beyaza boğacak kadar güçlü.
- **Sitede:**
  - `img/seeker-in.mp4` ilk 6,5 saniyeye kırpıldı (337 KB); poster son kareden.
  - Sayfadaki dönüş animasyonu kaldırıldı: bu kurguda dönüş yok.
  - Yerleşim ve opaklık Video F'deki gibi (son duruş aynı). Çizgilerin soldan belirmesi duruyor.

### 26 Kasım 2026 · Simge taslakları (Flow, Nano Banana 2.1)

- **Merve'nin notu:** Kodla çizilen dört seçenek "çok AI gibi, gerçekçi değil".
- **Üretim:** Nano Banana 2.1, 1:1, x4, düşünme düzeyi yüksek, 0 kredi. Üç istemle 12 taslak:
  - fırçalanmış titanyum ve altın "R"
  - içi altın ışıklı buzlu cam basamaklar
  - camgöbeği üstünde parlak altın basamak çubuğu
- **Paylaşılan:** Flow ekranından alınmış iki toplu görüntü: `rung-demo/simge-taslak/`. Görseller indirilmedi.
- **Durum:** Kullanılmadı; Merve eski işarette karar kıldı (aşağıda, "Simge: eski işaret").

### 26 Kasım 2026 · Video F'e dönüş ve yeni yer (kredi yok)

- **Merve'nin notu** (telefonla çektiği 70 saniyelik video):
  - Tepeden inen giriş olmasın; telefon soldan, başlığın olduğu yerden döne döne gelsin.
  - Arkadaki telefon çok dışarıda: üstü menüye ve sayfanın dışına taşıyor. Biraz daha aşağıda, yanda ve içeride dursun.
- **Yapılan:**
  - Video F tersine çevrildi; telefonun kareden taştığı ilk 2 saniye atıldı (123 kare, 5,1 sn).
  - Her kare, telefon karenin aynı noktasında (%73,5, %50) duracak şekilde kaydırıldı. Yolu ve dönüşü sayfa veriyor; video ile sayfa arasında zamanlama sorunu yok.
  - Giriş: telefon başlığın sol kenarında belirir, iki tur dönerek gelir, öndeki telefonun arkasından geçer, sağda yavaşlayarak oturur (4,8 sn).
  - Yer: genişlik 1088 px'ten 780 px'e indi. Merkezi öndeki telefonun sağ kenarında, ortanın biraz üstünde. Kamerası telefonun sağında görünür, üstü menüye taşmaz.
  - Telefon ve tablet yerleşimi değişmedi. Işık bandı yok.
- **Kredi:** harcanmadı (926).
- **Çıktı:** `rung-demo/img/seeker-in.mp4` (288 KB), poster son kareden. Sitede `web/public/site/seeker-in.mp4`; aynı dosyayı `kaynak/seeker/stabilize.py` üretir (komut betiğin başında, kare kare aynı çıktığı denendi).
- **Denetim:** 1470×800 ve 1512×760'ta kamera görünüyor, ekran kenarından kesilmiyor. 1280 genişlikte sağ köşesi biraz kesiliyor.

### 26 Kasım 2026 · Seeker büyüdü ve dikleşti (kredi yok)

- **Merve'nin notu:** Yeri olmuş. Ama arkadaki telefon çok küçük ve çok eğik duruyor; biraz büyüsün, biraz dikleşsin. Ekranın sol tarafından, boş yerden döne döne gelsin.
- **Yapılan:**
  - Genişlik 780 px'ten 1000 px'e çıktı.
  - Videodaki duruşundan 17° dikleştirildi (sayfada `rotate`; video değişmedi).
  - Giriş ekranın sol kenarının dışından başlıyor; iki tur, 5,6 sn.
  - Telefon ve tablet yerleşimi değişmedi.
- **Kredi:** harcanmadı (926).
- **Denetim:** 1512×741'de (Merve'nin ekranı) kamera öndeki telefonun sağında görünüyor, ekrandan taşmıyor. 1440 genişlikte sağ kenarı biraz kesiliyor.

### 26 Kasım 2026 · Seeker öndeki telefonun arkasına alındı, giriş yumuşadı (kredi yok)

- **Merve'nin notu:** Telefon öndekinin çok dışına çıkıyor; arkasında, hafif çapraz dursun, kamerası hafifçe görünsün. Ekranın solundan orta hızda ve yumuşak gelsin; ne çok hızlı ne çok yavaş dönsün.
- **Yapılan:**
  - Telefon öndekinin arkasına kaydırıldı; dışarıda yalnız kameranın üst merceği, flaşı ve kenarı görünüyor. Duruşu videodakinden 11° dik (yaklaşık 25° çapraz). Genişlik 1000 px kaldı.
  - Hız profili baştan kuruldu: ilk %22'de yumuşakça hızlanır, ortada sabit hızla gider, son %35'te yumuşakça yavaşlar (CSS `linear()` eğrisi; tanımayan tarayıcıda ease-in-out). Süre 6 sn, iki tur.
  - En yüksek hız 540'tan 342 px/sn'ye, en hızlı dönüş saniyede 265°'den 168°'ye indi (1512×741'de ölçüldü).
- **Kredi:** harcanmadı (926).
- **Denetim:** 1512×741, 1440×900 ve 1920×1080'de telefon ekrandan taşmıyor, kamera görünüyor. Merve'nin Chrome'unda canlı sürüm baştan sona izlendi.

### 26 Kasım 2026 · Seeker öndeki telefona yakın boyda (kredi yok)

- **Merve'nin notu:** Telefon ekranın sol kenarından sıfırdan çıkıp dönerek gelsin ve öndeki telefonun arkasında dursun. Boyu öndeki telefona yakın, biraz küçük olsun; eğimi biraz daha azalsın.
- **Yapılan:**
  - Genişlik 1000 px'ten 1500 px'e çıktı; telefonun boyu öndeki telefonun yaklaşık %85'i.
  - Duruş videodakinden 19° dik (yaklaşık 17° çapraz).
  - Öndeki telefonun arkasında duruyor; dışarıda sağ üst köşesi ve kenarı görünüyor (en çok ~110 px). Bu boyda kamera öndeki telefonun arkasında kalıyor.
  - Giriş 0,8 sn gecikmeyle ve ekranın tamamen dışından başlıyor; telefon ilk 1,1 sn hiç görünmüyor, sonra soldan çıkıyor. Hız profili aynı (6 sn, iki tur).
- **Kredi:** harcanmadı (926).
- **Denetim:** 1512×741, 1440×900, 1920×1080 ve 1280×720'de ekrandan taşmıyor. Merve'nin Chrome'unda canlı sürüm izlendi.

### 26 Kasım 2026 · Siteye geçti

- Merve son hali (sade site taslağının 11. sürümü) onayladı ("onaylıyoruz"); tasarım `web/` içine taşındı. Video `web/public/site/seeker-in.mp4`, posteri `web/public/site/seeker-poster.webp`; yerleşim ve giriş `web/app/globals.css` (`.seeker-back`) ve `web/app/phone-stage.tsx` içinde.
- **Depoda olan kaynaklar** (`kaynak/seeker/`): Gemini görseli `seeker-source.jpg`, 16:9 kareler `seeker-source-16x9.png` ve `seeker-start-16x9.png`, kullanılan video `seeker-f.mp4` ve onu siteye çeviren `stabilize.py`.
- Denenip kullanılmayan videolar (A, C, D, E, G; toplam 15 MB) depoya girmedi; Merve'nin bilgisayarında `kaynak/seeker/` altında duruyor.

### 26 Kasım 2026 · Simge: eski işaret

- **Merve'nin kararı:** "Simge eski hali olsun." Yeni taslaklar (kodla çizilen A–D, Nano Banana) kullanılmadı.
- **İşaret:** Sitenin üst çubuğundaki ve uygulamadaki Rung işaretinin aynısı. `#0B0D10` zeminde iki açık ray (`#ECEFF2`), iki açık basamak ve en altta sarı basamak (`#FFC233`). Küçük boyda okunsun diye çizgiler kalın.
- **Üretim:** Kodla çizildi, `kaynak/icon/render.py` (numpy; üretilmiş görsel yok). Kredi harcanmadı. Komut: depo kökünden `python3 kaynak/icon/render.py`.
- **Dosyalar:**

| Dosya | Boyut |
|---|---|
| `web/app/favicon.ico` | 16, 32, 48 (tek dosyada) |
| `web/app/icon.png` | 512×512 |
| `web/app/apple-icon.png` | 180×180 |
| `web/public/rung-icon.png` | 256×256 |
| `web/public/rung-icon.svg` | SVG kaynağı |
| `app/assets/icon.png` | 1024×1024 |
| `app/assets/adaptive-icon.png` | 1024×1024, saydam zemin; işaret yatayda %31–68, dikeyde %24–76 arasında (güvenli alan %17–83) |
| `app/assets/favicon.png` | 48×48 |

- **Denetim:** Boyutlar doğru. Site derlendi; sayfanın başlığında favicon, 512 px simge ve Apple simgesi bağlantıları var. `/favicon.ico`, `/icon.png`, `/apple-icon.png`, `/rung-icon.png` ve `/rung-icon.svg` yerel sunucudan 200 döndü.
- **Sonrası Buğra'nın ajanında** (belgedeki gibi): `app/src/config.ts` içindeki `APP_IDENTITY.icon` PNG'ye (`https://rungbot.xyz/rung-icon.png`), `app/app.json` içindeki beyaz zemin renkleri (`#ffffff`) koyuya; sonra Phantom ve Solflare'de öykünücüde bakılır.

### 27 Kasım 2026 · Başlığın arkasındaki merdiven görseli (kayıt, Buğra'nın ajanı)

- `web/public/site/hero-ladder.jpg` bu kayıtta yoktu; kaynağı dosyanın kendi üstverisinden okundu.
- **Araç:** MFLUX 0.24.0 (Merve'nin Mac'inde yerel üretim). Dosyada "AI Generated Content" ve "Generated by MFLUX" yazıyor; fotoğraf değil, atıf gerektiren bir kaynak yok.
- **Prompt (dosyadaki, aynen):** "Low-angle close-up photograph of a dark brushed-steel ladder whose evenly spaced rungs rise diagonally from the lower left into deep darkness at the upper right, cinematic low-key lighting, a faint violet glow from the left and a faint mint-green glow from the right catching the metal edges, shallow depth of field, mostly black frame with large calm empty areas, minimal, photographic, high detail. No text, no letters, no signature, no watermark."
- **Sitede:** başlığın arkasında %16 opaklıkta, kenarları maskeyle yumuşatılmış (`web/app/globals.css`, `.hero-copy::before`). 1400×933, 73 KB.
- Hangi FLUX modeliyle üretildiği dosyada yazmıyor; Merve biliyorsa buraya eklesin.
