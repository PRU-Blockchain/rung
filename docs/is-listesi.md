# Rung · İş listesi

Bu liste kodla birlikte güncel tutulur: bir işin durumu değiştiğinde aynı commit'te burası da değişir. Kaynak: devir paketindeki temel iş listesi (`rung-is-listesi.md`) ve geliştirici devir prompt'u.

## Nasıl okunur

- **Kimlik:** `O-` ortak işler, `Z-` zincir kolu, `Y-` yüz kolu. Kimlikler değişmez; iş düşerse satırı silinmez, "düştü" diye işaretlenir.
- **KT:** işin ait olduğu kilometre taşı (KT0…KT7). Bir taş, testleri yeşil olunca, sonuç özetlenince ve README ile bu liste güncellenince biter.
- **Durum:** `[ ]` yapılmadı · `[~]` sürüyor · `[x]` bitti.
- **Bekler:** bu iş başlamadan ya da bitmeden önce bitmesi gereken işlerin kimlikleri.
- **Yan yana:** bu işle aynı anda yürüyebilecek işlerin kimlikleri.
- Kimin hangi kolu ya da işi alacağına ve takvime takım karar verir; bu listede yazmaz.

## Ortak · İlk kurulum (KT0)

| kimlik | KT | ne yapılır | bitti ölçütü | bekler | yan yana | durum |
|---|---|---|---|---|---|---|
| O-1 | KT0 | "Rung" ad kontrolü: alan adı, X hesabı, marka kaydı, pump.fun'da aynı adlı token. Kayıt ya da ödeme yok. | Bulunanlar kaynağıyla raporlandı. Not: X hesapları, resmî marka veritabanları ve pump.fun araması betikle okunamadı; Buğra elle bakacak. | — | O-2…O-10 | [x] |
| O-2 | KT0 | GitHub organizasyonunda baştan herkese açık repo (PRU-Blockchain/rung), MIT lisansı. | Repo adresi açılıyor. | — | O-1, O-7 | [x] |
| O-3 | KT0 | `.gitignore` (anahtar dosyaları, `.env*`, `target/`, ölçüm ham verisi) ve boş README; ilk commit. | İlk commit ana dalda; `git diff --staged` denetiminde anahtar ya da `.env` yok. | O-2 | O-7, O-8 | [x] |
| O-4 | KT0 | Organizasyonda `gh` ve Vercel için sahip onayı (Buğra verir). | Ajan repoya yazabiliyor; Vercel repoyu görüyor. Not: Buğra organizasyonda yönetici; Merve'ye repoda yazma yetkisi verildi. Vercel GitHub uygulaması organizasyona yalnız `rung` reposu için kuruldu; Vercel projesi repoya bağlı (Root Directory `web`). | O-2 | O-3, O-7 | [x] |
| O-5 | KT0 | Vercel denemesi: (1) Buğra'nın ana dala commit'iyle yayın; (2) Merve'nin kendi hesabından bir dala push'u ve ana dala birleştirmesiyle yayın (Merve yapar, sonucu bildirir); (3) tutmazsa elle yayın yolu yalnız takım notuna (`docs/takim-notu.md`) yazılır, README'ye değil. | İki durumda da yayın çıktı ya da elle yayın yolu takım notunda. Not: ikisi de tuttu. (1) Buğra'nın ana dala commit'inden, (2) Merve'nin `deneme/merve` dalından açıp birleştirdiği PR #1'den yayın çıktı; elle yayın yoluna gerek kalmadı. | O-3, O-4 | O-6, O-7 | [x] |
| O-6 | KT0 | Commit e-postaları: Buğra'nın `git config user.email` değeri bu makinede denetlenir; Merve'ninkini Merve kendisi denetleyip bildirir. | İkisinin commit'leri GitHub profilinde görünüyor. Not: ikisi de doğrulandı; GitHub commit'leri `mryavascann` ve `mrvipek259-ui` hesaplarına bağladı (Merve'nin klonu GitHub `noreply` adresini kullanıyor). | O-2 | O-5, O-7 | [x] |
| O-7 | KT0 | WSL'de araç kurulumu: Rust, Agave CLI, Anchor 1.x, Node, Surfpool; `anchor init` ile iskelet. Sürümler README "Setup"a. | Boş projede `anchor test` yeşil; sürümler README'de. Not: program testleri LiteSVM (Rust) ile; mainnet kopyalı testler Surfpool ile. | — | O-1…O-6, O-8 | [x] |
| O-8 | KT0 | Windows'ta Android Studio ve öykünücü (Play Store'lu sistem görüntüsü dahil); Expo'nun hangi tarafta çalışacağı (`adb` köprüsü) kararı README'ye. | Öykünücü açılıyor; karar README'de. Not: Android Studio kurulmadı, gerek kalmadı (SDK, `avdmanager` ve öykünücü yeterli). `rung-play35` öykünücüsü Android 15 ve Play Store ile açıldı. Karar: Expo ve Gradle Windows'ta, ASCII yoldaki ikinci bir klondan çalışacak; uygulama yazılınca doğrulanacak (Y-1). | — | O-7 | [x] |
| O-9 | KT0 | RPC sağlayıcı hesabı: Buğra açar, anahtarı kendisi `.env.local`'a ve Vercel paneline koyar. | `RPC_URL` yerelde okunuyor; anahtar depoda yok. Not: yerelde tamam (`scripts/set-rpc-url.sh` ile `.env.local`); Vercel paneline web sayacı yazılırken konacak (Y-7). | — | O-7, O-8 | [x] |
| O-10 | KT0 | Etkinlik işleri (takımın işi, ajan yapmaz): başvuru ve takım kaydı, Beykent kaydı, organizatöre sorular (APK canlı bağlantı sayılır mı; özel program zorunlu mu; mobil ödül için APK yeter mi; Beykent gösteriminin koşulları; gerçek parayla alım göstermek kurala takılır mı). | Kayıt onayı geldi; sorular gönderildi. | — | hepsi | [ ] |
| O-11 | KT0 | Bu iş listesinin depoda ayrıntılandırılması ve kodla güncel tutulması. | `docs/is-listesi.md` ana dalda. | O-3 | O-7, O-8 | [x] |

## Zincir kolu (program, gönderici, ölçüm)

| kimlik | KT | ne yapılır | bitti ölçütü | bekler | yan yana | durum |
|---|---|---|---|---|---|---|
| Z-1 | KT1 | Sahte alım programı (fiyatı test belirler; en az token tutmazsa düşer) ve aşağıdaki KT1 senaryo testleri, koddan önce yazılır. | Testler derleniyor ve kod yokken kırmızı. | O-7 | Y-1 | [x] |
| Z-2 | KT1 | Emir programı (çekirdek 1): `emir_ac`, `dene(kademe)`, `iade`, `iptal`; kasa PDA'sı (sistem sahipli, veri tutmayan); olaylar; hata kodları; emir başına üst tutar; girdi sınırları ve `checked_*`; erişim kontrolü; aynı kullanıcının iki açık emrinde paranın karışmaması kararı. | Z-1'deki on test ve erişim kontrolü ile girdi sınırı testleri yeşil; kasa kararı test edildi ve bildirildi. | Z-1 | Y-1, Y-2 | [x] |
| Z-3 | KT1 | pump eğrisinden alım CPI ile (çekirdek 2), mainnet'ten kopyalanmış programla yerelde: güncel IDL, alım talimatı sürümünün seçimi ve nedeni, kasa alıcı, pump'ın kira istediği hesaplar, Token-2022 ve SPL Token. | Eğriden alım testleri (Token-2022 tokenı dahil) yerel kopyada yeşil. Not: gerçek pump programıyla (LiteSVM) kasa alıcı olarak kabul edildi; gerçek programla yalnız Token-2022 tokenı denendi, SPL Token yalnız taklit programla. Seçilen talimat `buy_exact_quote_in_v3`. | Z-2 | Z-4, Y-2 | [x] |
| Z-4 | KT1 | PumpSwap'tan alım CPI ile (çekirdek 3), aynı yerel kopya düzeniyle. Tutmazsa yalnız eğriyle devam, README'de açıkça yazılır, KT4'te yeniden değerlendirilir. | Havuzdan alım testi yerel kopyada yeşil ya da düşme kararı bildirildi. | Z-2 | Z-3, Y-2 | [ ] |
| Z-5 | KT1 | Mainnet dağıtımından önce bağımsız güvenlik incelemesi: kodu yalnız okuyabilen ayrı bir alt ajan (erişim kontrolü, PDA ve hesap sahipliği, taşma, kasadan çıkış yolları). | Bulgular özetlenip iletildi; düzeltmeler testli. Not: kritik ya da yüksek bulgu yok. Düzeltilenler (testi önce yazılarak): alımın kasadan çekebileceği SOL için üst sınır, istemcinin verdiği iki kotasyon için tutarlılık bandı, ücret payı için kira eşiği, en yüksek tavanın %30a inmesi. Bilerek ertelenenler: pump hacim hesabının kirasını geri alma, dolamayacak eğri türlerini (SOL dışı çift, cashback) emir açarken reddetme, pump hesaplarının kalanını programda sabitleme. README güvenlik bölümüne yazılacak: çalınan anahtar alımı tavana kadar kötü fiyattan tetikleyebilir. | Z-3, Z-4 | Y-2, Y-3 | [x] |
| Z-6 | KT1 | Mainnet dağıtımı (çekirdek 11'in ilk parçası): `anchor build`, kira `solana rent` ile ölçülür, tutar Buğra'ya yazılır; dağıtım anahtarı depo dışında; program anahtarı Buğra tarafından depo dışında yedeklenir. **Onay gerekir.** | Program mainnet adresi gezginde açılıyor; README "Architecture and program addresses" güncel. Not: Buğra'nın kararıyla önce devnet: program devnet'te aynı adreste yayında (depozito test SOL'üyle). Mainnet dağıtımı ertelendi; depozito 1,40 SOL ölçüldü. | Z-5, O-9 | Y-2, Y-3 | [ ] |
| Z-7 | KT1 | Mainnet'te çok küçük gerçek alımlar merdivenle: biri oturmuş havuzda, biri yeni açılmış eğride. **Onay gerekir.** | İlk gerçek makbuz kayıtlı: tutan basamak, görülen ve ödenen fiyat, imzalar, her denemenin `meta.fee`'si. | Z-6 | Y-2, Y-3 | [ ] |
| Z-8 | KT2 | Ücret ve gönderim ölçümü: öncelik ücreti iki-üç düzeyde, sıkı CU sınırıyla; tutmayan denemenin `meta.fee`'si ve gönderim ile giriş arasındaki slot farkı; iki-üç uçla küçük `dene` benzeri işlemler. Toplam tutar önce Buğra'ya. **Onay gerekir.** | Öncelik düzeyi, basamak aralığı (4 ya da 8 slot), gönderim ucu seçildi; X formülü sabit; "en çok şu kadar ücret" sayısı belli. | Z-7 | Y-1…Y-4 | [ ] |
| Z-9 | KT4 | Tek kullanımlık anahtar ve deneme gönderici (çekirdek 4): ölçülü öncelik ücreti, sıkı CU sınırı (ölçülen `dene` kullanımının biraz üstü), taze blok karması, ön denetim kapalı gönderim, doldu görünce durma, kalan ücret payını kullanıcıya geri gönderme, anahtarı silme. Anahtar günlüğe yazılmaz. | Öykünücüden bağımsız betikle uçtan uca alım. Not: `client/` ve `scripts/devnet-ladder.ts` ile devnet'te uçtan uca üç koşu yapıldı (ilk basamakta doldu; 1. düştü 2. tuttu; üçü de düştü ve iade). Mainnet'te henüz yok; öncelik ücreti düzeyi ve CU sınırı geçici (Z-8). | Z-8 | Y-2…Y-4 | [~] |
| Z-10 | KT4 | Kotasyon ve iki referanslı fiyat (çekirdek 6): IDL'deki formülle kotasyon; en az token iki referansın sıkı olanından programda hesaplanır. Yetişmezse tek referans (kullanıcının gördüğü fiyat) ve geçiş bildirilir. | Görülen fiyat ile programın okuduğu fiyat testte tutarlı. | Z-7 | Z-9, Y-2…Y-4 | [ ] |
| Z-11 | KT5 | Herkese açık sayaç verisi: program olaylarından alım, alınamayan, basamak dağılımı, ortalama kullanılan pay, toplam deneme ücreti, çift alım; `getSignaturesForAddress` + günlük çözme, sunucuda önbellek. | Sayaç gerçek alımları doğru sayıyor. | Z-7 | Z-9, Z-10, Y-7 | [ ] |
| Z-12 | KT6 | Ölçüm betiklerinin depoya temizlenip konması: ortak kodu birleştir, klasör adları ve slot aralıkları parametre, ham veri `.gitignore`'da, çalıştırma yolu README "Tests"te. Paketteki pump IDL kopyası depoya konmaz. | Betik çalışınca README'deki sayılar çıkıyor. Not: `measure/` altında temizlendi ve parametreli; küçük bir dilimde asıl betiklerle aynı çıktıyı verdiği gösterildi, uçtan uca yeniden çalıştırılmadı. İlk pencerenin mod ölçümü (`onayar*`) ve raporu, kullanılmayacak sayıları (sandviç modeli, dolar toplamları) bastığı için depoya konmadı. | O-3 | hepsi | [~] |
| Z-13 | KT6 | README "Numbers" bölümü: kendi ölçümümüz ile başkalarınınki ayrı tablolarda; "sayılar nereden" metni kelimesi kelimesine; son satır yalnız gerçek alımlardan. | Bölüm README'de; her sayı Z-12 betiğine ya da kaynağa bağlı. | Z-12 | hepsi | [ ] |

**B planı notu (KT1 tutmazsa, sırayla):**
- **B1** (alıcı = tek kullanımlık anahtar): Z-3 ya da Z-4'te kasanın alıcı olduğu CPI tutmazsa. Anlatım değişmez; bildir, devam et.
- **B2** (program kuralları ve tek alımı denetler, pump alımı programın dışında aynı işlemde): B1 de tutmazsa. Anlatım değişmez; bildir, devam et.
- **B3** (programsız geçici cüzdan): B2 de tutmazsa. **Dur, Buğra'ya sor**; "the cap is enforced by our on-chain program" anlatımı değişir.
- Düşük öncelik ücreti denemeleri geç sokarsa (Z-8): öncelik bir düzey artar ve X ekranda büyür, ya da basamak aralığı 8 slota çıkar, ya da basamak sayısı azalır.

**KT1 senaryo testleri (Z-1'de yazılır, Z-2 ile yeşile döner):**
- [x] (a) 1. basamak düşer, 2. basamak tutar, token kullanıcıya geçer.
- [x] (b) Dolduktan sonraki deneme "emir dolu" ile düşer.
- [x] (c) Tavanın üstündeki basamak reddedilir.
- [x] (d) Zamanı gelmemiş üst basamak reddedilir.
- [x] (e) Başka anahtarın denemesi reddedilir.
- [x] (f) Süre dolunca üçüncü bir adresin çağırdığı `iade` parayı kullanıcıya verir.
- [x] (g) `iptal` yalnız kullanıcıyla.
- [x] (h) Emir başına üst sınır aşılamaz.
- [x] (i) Anahtarın ücret payı X'i aşan harcamaya yetmez.
- [x] (ek) Önceden fonlanmış emir adresi: emir hesabı `init` ile açılır ve önceden fonlanmış adreste kilitlenmez.

## Yüz kolu (uygulama, web, vitrin)

| kimlik | KT | ne yapılır | bitti ölçütü | bekler | yan yana | durum |
|---|---|---|---|---|---|---|
| Y-1 | KT4 | Android iskeleti: Solana Mobile Expo şablonu, Expo özel geliştirme derlemesi, MWA, web3.js v1, `expo-secure-store`, rastgele sayı ve `Buffer` polyfill'leri; Anchor TS paketiyle uyum denemesi. | Öykünücüde açılıyor; `mock-mwa-wallet` ile bağlanıyor. Not: Expo SDK 52, React Native 0.76, web3.js 1.99; uygulama Windows klonunda (`C:devung`) derleniyor, JDK 17 gerekiyor. Test cüzdanı ekran kilidi istediği için `docs/mock-mwa-wallet-no-lock.patch` ile derlendi. `client/` Metro'dan çözülüyor. | O-8 | Z-1…Z-5 | [x] |
| Y-2 | KT4 | Alım ekranı (çekirdek 5, 7): token yapıştırma, beş mod (düğme metinleri kelimesi kelimesine), basit mod önerisi kuralı, Custom'da ilk basamak geniş uyarısı, tutar, ücret satırı ("If no rung fills, max fee: X SOL" ve "+ approval fee set by your wallet"), tek onay düğmesi. | Ekran sahte veriyle baştan sona geziliyor. | Y-1 | Z-2…Z-8 | [x] |
| Y-3 | KT4 | Merdiven zaman çizgisi ve makbuz (çekirdek 7, 8); alınamayan alım ekranı ("Price went above your cap. Not bought. Your SOL is back."); "Retry with Launch mode" ile yeni emir ve yeni onay (çekirdek 9). | Sahte veriyle üç durum görünüyor: ilk basamakta tuttu, üst basamakta tuttu, alınamadı. | Y-2 | Z-3…Z-10 | [x] |
| Y-4 | KT4 | Geçmiş ekranı: önceki makbuzlar ve gezgin bağlantıları; ağsız açılır. | Öykünücüde ağ kapalıyken önceki makbuzlar açılıyor. | Y-3 | Z-8…Z-10 | [x] |
| Y-5 | KT3 | Tek onay denemesi: onay işlemi `sign_and_send_transactions` ile `mock-mwa-wallet`, Phantom Android ve Solflare Android'de (cüzdanları Buğra kurar ve fonlar). Bozulursa onay iki işleme bölünür: **Buğra'ya sor.** Öykünücüden mainnet'e imza atılamazsa: **Buğra'ya sor.** | Not edildi: kaç onay ekranı çıktığı, cüzdanın işleme ne eklediği, işlemin zincire girip girmediği, öykünücüden mainnet'e imza. Not (yalnız mock-mwa-wallet, devnet): bağlanmada 1 onay ekranı; `signAndSendTransactions` ile tek işlemde 1 onay ekranı, yeniden yetki istenmedi; cüzdan işleme talimat eklemedi. Cüzdan fonsuz olduğu için işlem zincire girmedi ve cüzdan bunu yanıltıcı bir hata koduyla (-2) döndürdü. Phantom ve Solflare denenmedi. | Y-1, Z-6 | Z-7, Z-8, Y-2 | [~] |
| Y-6 | KT4 | Uygulamanın programa ve göndericiye bağlanması; mobil RPC yolu (anahtarsız açık uç, web'de vekil işlev ya da kısıtlı ayrı anahtar) KT2 ölçümüne göre seçilir ve bildirilir. **Gerçek alım onay gerektirir.** | Öykünücüden mainnet'te gerçek alım; makbuz gerçek veriyle. Not: devnet'te tamam (öykünücü, yamalı test cüzdanı): tutan alım, tırmanma, alınamayan alım ve Launch ile yeniden deneme gerçek işlemlerle görüldü; ekran görüntüleri `docs/shots/app-*.png`. Mainnet, Phantom/Solflare, Custom modu ve Paste düğmesi denenmedi. Herkese açık devnet RPC'si hız sınırına takılıyor; mobil RPC kararı açık. | Z-9, Z-10, Y-3, Y-5 | Z-11, Y-7 | [~] |
| Y-7 | KT5 | Web sayfası (çekirdek 10): Next.js ya da Vite + React (seçim bildirilir); tanıtım, APK indirme, sayaç, son alımların gezgin bağlantıları; RPC yalnız sunucu tarafı ortam değişkeni. Organizasyon reposundan Vercel'de. | Canlı adres açılıyor; sayaç gerçek alımları gösteriyor. | O-5; sayaç için Z-11 | Y-1…Y-6 | [ ] |
| Y-8 | KT7 | İmzalı APK: keystore depo dışında (Buğra yedekler); depo sürümlerinde ve web sayfasında. | APK web sayfasından indirilip öykünücüye kuruluyor. | Y-6, Y-7 | O-14, O-15 | [ ] |

## Ortak · Gerçek veri, vitrin ve prova

| kimlik | KT | ne yapılır | bitti ölçütü | bekler | yan yana | durum |
|---|---|---|---|---|---|---|
| O-12 | KT1 | README ilk ekranı (başlık, alt satır, üç sayı) kelimesi kelimesine depoya; görsel gerçek ekrandan sonra eklenir. | Metin devir prompt'undakiyle kelimesi kelimesine aynı. | Z-7 | Z-8, Y-1 | [ ] |
| O-13 | KT6 | Ekibin kendi küçük alımları (her biri Buğra'nın onayıyla ve kendi cüzdanıyla) ve geçmiş tablosu: imza, mod, tutan basamak, görülen ve ödenen fiyat, ücret. **Onay gerekir.** | Tabloda gerçek alımlar ve en az bir alınamayan alım var; README "Numbers" son satırı bundan dolu. | Y-6, Z-9 | Z-12, Y-7 | [ ] |
| O-14 | KT7 | README'nin tamamı: ikinci ekran (terim açıklaması, dört artı, mod tablosu, sayılar nereden; kelimesi kelimesine), "How to try", kalan başlıklar sırasıyla; "söylenir / söylenmez" tablosuna uyum. Why Solana ve iş modeli paragrafları sadık çevrilip Buğra'ya gösterilir. | Bütün başlıklar var; çalışmayan her şey "not yet"; söylenmez cümlelerden hiçbiri yok. | O-12, O-13 | O-15, Y-8 | [ ] |
| O-15 | KT7 | "Why we built this" paragrafı: metin Buğra'dan istenir, ajan yazmaz. | Paragraf README'de. | — | O-14 | [ ] |
| O-16 | KT7 | Sekiz ekran görüntüsü, gerçek üründen ve gerçek verilerle (mod seçimi, onay öncesi, cüzdan onayı, merdiven + makbuz, alınamayan gerçek alım, gezgin olayları, web sayacı, üç sayı ve mod tablosu kartı). | Sekizi de depoda; hiçbiri elle düzenlenmemiş. | O-13, Y-7 | O-17 | [ ] |
| O-17 | KT7 | Video için ekranların çekime hazırlanması (on bir sahne, gerçek üründen; verilen metinler altyazı ya da kart olarak kelimesi kelimesine). Çekim, seslendirme ve yükleme takımın işi. Alınamayan alım gerçek kayıttan. | Her sahnenin ekranı gerçek üründen çekilebiliyor; video 3 dakikanın altında yüklendi. | O-13 | O-16 | [ ] |
| O-18 | KT7 | `etkinlik-oncesi` etiketi ve README "Before / during the event" bölümü; etiketin zamanı Buğra'ya sorulur. | Etiket ana dalda; README bölümü etikete başvuruyor. | O-3 | hepsi | [ ] |
| O-19 | KT7 | Prova: 20 alım üst üste; ağsız yedeklerin denenmesi (geçmiş ekranı; dizüstünde pump kopyalı yerel doğrulayıcıda aynı akış, "yerel kopya" diye açıkça); ikisinin de programı anlatabilmesi. | 20 alım çökmeden tamamlandı; yedeklerin hepsi denendi. | O-14, O-16, Y-8 | O-17 | [ ] |
| O-20 | KT7 | Teslim listesinin son kontrolü ve teslim formu (repo, canlı bağlantı, program adresi, video, ad ve açıklama, görseller, etkinlik öncesi / sırası ayrımı). | Teslim listesinin bütün satırları işaretli. | O-17, O-18, O-19 | — | [ ] |

## Buluşma noktaları (kollar arası)

- **Y-5 (tek onay denemesi)** mainnet'teki programı, yani **Z-6**'yı bekler.
- **Y-2 ücret satırındaki X**, **Z-8** sabitlenene kadar geçici değerle durur.
- **Y-6 (uygulamanın programa bağlanması)** zincir kolunun **Z-9** (gönderici) ve **Z-10** (kotasyon, iki referans) işlerini bekler.
- **Y-6 mobil RPC seçimi** **Z-8**'deki gecikme ölçümünü bekler.
- **Y-7 sayacı** **Z-11**'i, Z-11 de **Z-7**'deki ilk gerçek alımları bekler.
- **O-13 geçmiş tablosu** iki kolun birleşmesini (**Y-6** ve **Z-9**) bekler; **O-16** ve **O-17** de O-13'ü.
- **O-12 README görseli** gerçek ekranı (**Y-3**, gerçek makbuz için **Y-6**) bekler.

## Çekirdek ve kilometre taşı karşılıkları

- Çekirdek 1 → Z-1, Z-2 · 2 → Z-3 · 3 → Z-4 · 4 → Z-9 · 5 → Y-2 (+ Z-8) · 6 → Z-10 · 7 → Y-1, Y-2, Y-3 · 8 → Y-3 · 9 → Y-3 · 10 → Y-7 (+ Z-11) · 11 → Z-6, O-13, Z-12, Z-13.
- KT0 → O-1…O-11 · KT1 → Z-1…Z-7, O-12 · KT2 → Z-8 · KT3 → Y-5 · KT4 → Z-9, Z-10, Y-1…Y-4, Y-6 · KT5 → Y-7, Z-11 · KT6 → O-13, Z-12, Z-13 · KT7 → O-14…O-20, Y-8.

## Buğra'nın onayını bekleyen adımlar

Para harcayan, geri alınamayan ya da anlatımı değiştiren adımlar. Her birinden önce tutar (SOL ve yaklaşık dolar), ne yapılacağı ve geri alınıp alınamayacağı yazılır; açık "evet" beklenir.

| adım | iş |
|---|---|
| Mainnet program dağıtımı (kira ve işlem ücretleri); dağıtım bütçesi yetmezse yalnız yerel kopya ve devnet kararı | Z-6 |
| Program kapatma, yükseltme yetkisini değiştirme | Z-6 |
| KT1'in çok küçük gerçek alımları | Z-7 |
| KT2 gönderim ölçümü (toplam tutar önce yazılır) | Z-8 |
| B3'e geçiş (tavan anlatımı değişir) | Z-3, Z-4 |
| Emir başına üst tutarı artırma | Z-2 |
| Onayın iki işleme bölünmesi ("tek onay" anlatımı değişir) | Y-5 |
| Öykünücü mainnet'e imzalamazsa: Android telefon bulmak ya da web'den alımı öne alıp videoyu tarayıcı cüzdanıyla çekmek | Y-5 |
| Öykünücüden gerçek alım | Y-6 |
| Ekibin her küçük alımı | O-13 |
| "Söylenir" tablosunda olmayan yeni bir iddia; Why Solana ve iş modeli çevirisinin onayı | O-14 |
| Gerçek parayla alım gösterimi kurala takılırsa gösterimin yerel kopyada yapılması | O-10, O-19 |
| `etkinlik-oncesi` etiketinin zamanı | O-18 |

Buğra'nın kendisinin yapacakları: organizasyon onayı (O-4), RPC hesabı ve anahtarı (O-9), dağıtım anahtarının üretilmesi ve fonlanması ile program anahtarının yedeği (Z-6), öykünücüdeki test cüzdanlarının kurulması ve fonlanması (Y-5), APK keystore yedeği (Y-8), "Why we built this" metni (O-15), ad kontrolünde betiğin okuyamadığı yerler (O-1). Merve'den beklenenler: Vercel dal denemesi (O-5) ve commit e-postası kontrolü (O-6).

## Çekirdek bitince (olsa iyi olur)

1. Web'den alım (tarayıcı cüzdanıyla, aynı program).
2. Programa pay alanı.
3. Öncelik payının bir kısmını yalnız tutan denemede ödenen Jito ipucuna kaydırma.
4. Alım öncesi uyarı (son bir dakikadaki alımların gördükleri fiyatın ne kadar üstünden gerçekleştiği).
5. Oynaklığa göre mod önerisi.
6. Satışta ters merdiven.
7. Kara listeli doğrulayıcıları atlayan gönderim.
8. Jupiter rotası (pump dışı tokenlar).
9. Başka uygulamaların kullanacağı TypeScript paketi.

## Kapsam dışı

Grafik, token keşfi, terminal özellikleri ve çoklu cüzdan yapılmaz; Blink (tek işlemdir, merdiven çalışmaz), Seeker'a özgü şeyler (cihaz jetonu, dApp Store yayını; kural şart koşarsa Buğra açar), iOS (MWA iOS'ta yok), fiyat tetiklemeli emir, sandviç tespiti ve "sandviçten tamamen korur" iddiası da kapsam dışıdır. Mergen oturumunda kalan işler (sunum koçluğu, vitrin denetimi, sonuç ve tecrübe kartları) geliştirici ajan yapmaz.
