# Arayüz notları: alım uygulamalarından çıkan dersler

**Bu dosya nedir:** Rung'ın arayüzünü yeniden ele alacak kişi ve ajanı için gözlem ve fikirler. **Kural değil, şart değil.** Buradaki her madde "başkaları böyle yapmış, bizde şu işe yarayabilir" düzeyindedir; tasarım kararı arayüzü yapanındır. Yalnız en sondaki "Projeden gelen sabitler" bölümü bu notlardan bağımsız olarak geçerlidir.

**Nasıl hazırlandı (25 Kas 2026):** Ağırlık mobil ekranlarda. Altı mobil uygulamanın alım ekranı mağazadaki ekran görüntüleri büyütülerek tek tek okundu (Phantom, pump.fun, Fomo, Moonshot, Jupiter Mobile, Cash App); Uniswap Wallet, Robinhood ve Solflare'ın mağaza ekranlarına küçük boyda bakıldı; test öykünücümüzde Phantom ile Solflare gerçekten kullanıldı. Bunlara ek olarak dört canlı web ekranı (jup.ag, pump.fun, gmgn.ai, raydium.io) ve Fomo'nun web arayüzü incelendi. Hiçbir yerde hesap açılmadı, cüzdan bağlanmadı, koşul kabul edilmedi; yalnız görünen ekran okundu. Yazılı kaynaklardan çıkanlar ayrı bölümdedir ve her birinin yanında bağlantısı vardır.

## Rung'ın tek işi

Kullanıcı token adresini yapıştırır, modu seçer, tutarı yazar, cüzdanında bir kez onaylar, merdiveni izler, makbuzu ya da "alınmadı, SOL'ün geri geldi" ekranını görür. Beş ekran: alım, merdiven, makbuz, alınamadı, geçmiş (`app/src/screens/`). Uygulama başka bir şey yapmıyor; iyi olan da bu.

## Mobil alım ekranı: altı uygulamada aynı iskelet

En önemli bulgu bu. Phantom, pump.fun, Fomo, Moonshot, Jupiter Mobile ve Cash App'in tutar ekranları yukarıdan aşağı neredeyse aynı sırayı izliyor:

| sıra | öğe | uygulamalarda nasıl |
|---|---|---|
| 1 | **Başlık satırı: ne alınıyor** | Token resmi, adı ve fiyatı tek satırda (Fomo: "MOODENG · MC $160.6M", sağda fiyat ve değişim; Moonshot: "Buy DOGE $0.08"; Phantom: "Buy SOL · Price $85.45"). Geri ya da kapat köşede. Ayar için tek küçük ikon ya da durum çipi: pump.fun'da başlıkta "Auto" yazan bir çip slippage'ın otomatik olduğunu söylüyor. |
| 2 | **Dev tutar** | Ekranın en büyük öğesi, ortada, yanıp sönen imleçle ("$100", "$500", "$1,000"). Hemen altında küçük bir çeviri satırı: Fomo "625 MOODENG ⇅" (dokununca birim değişiyor), Jupiter "≈ 500.10 USDC", pump.fun "Acquiring Jimothy". |
| 3 | **Kaynak seçici** | Küçük bir çip: "Cash Balance · $1,234.56 ▾" (Phantom), ödeme yöntemi (Moonshot, pump.fun, Jupiter). |
| 4 | **Dört hızlı çip** | Ya bakiyenin yüzdesi (Fomo ve Moonshot: 25% / 50% / 75% / 100% ya da MAX) ya da hazır tutar (pump.fun: $50 / $100 / $250 / $500; Jupiter: $50 / $100 / $200 / $1,000). Hep tek sıra, dört tane. |
| 5 | **Uygulamanın kendi tuş takımı** | Sistem klavyesi değil; ekrana gömülü 3×4 rakam takımı, "." ve silme tuşuyla. Klavye açılıp kapanmadığı için düğme hiç yer değiştirmiyor. |
| 6 | **Düğmenin hemen üstünde tek bilgi satırı** | Fomo: solda "$33.2K available", sağda "$0.50 fee". pump.fun: solda kapalı duran "Order details ⌄", sağda "Fee on us!". |
| 7 | **Altta tek geniş düğme** | "Review" (Phantom), "Slide to buy" (Fomo; kaydırarak onay), "Pay" (Cash App). Ekranda başka birincil düğme yok. |

Birkaç ek gözlem:

- **Ekran bir sekme değil, token sayfasının üstüne açılan tam boy bir sayfa.** Fomo ve pump.fun'da üstte tutma çubuğu var; aşağı çekince kapanıyor.
- **Ekranda açıklama paragrafı yok.** Altı uygulamanın hiçbirinde tutar ekranında iki satırdan uzun metin görmedim.
- **Renk az.** Zemin tek renk, vurgu rengi yalnız ana düğmede; yeşil ve kırmızı yalnız fiyat değişimi için.
- **Cash App en uç örnek:** tek renk zemin, "$20", tuş takımı, tek siyah ana düğme ("Pay") ve üstünde iki soluk ikincil düğme.

Rung'ın bugünkü alım ekranıyla yan yana: bizde adres kutusu, token bilgi kutusu, beş mod düğmesi, tutar için metin kutusu (sistem klavyesi açılıyor), ücret satırı, "Details", ana düğme, güvenlik cümlesi, durum satırı ve cüzdan satırı alt alta duruyor ve ana düğmeye inmek için kaydırmak gerekiyor. Yukarıdaki iskelet bu ekrana uyarlanırsa akla gelen eşleşme: başlıkta token ve seçili mod (pump.fun'daki "Auto" çipi gibi), ortada dev SOL tutarı ve altında dolar karşılığı, bir sıra hazır tutar, tuş takımı, düğmenin üstünde "If no rung fills, max fee" satırı, altta tek düğme. Bu bir eşleştirme önerisi; karar arayüzü yapanın.

## Ekran ekran ne gördüm

| ürün, nerede baktım | ekranda ne var | Rung için ders |
|---|---|---|
| **Phantom**, alım ekranı (mağaza) ve satış akışı (öykünücüde canlı) | Üstte "Buy SOL · Price $85.45". Ortada tek dev sayı ("$500"). Altında kaynak seçici, tek düğme ("Review"), sayı tuş takımı. Ayarlar sağ üstte tek ikon. Satışta 25% / 50% / 100% çipleri; 100%'e basınca doğrudan "Review": satılan, alınacak, ücret ("$0.00561 + 0.85% fee") ve tek "Confirm". Sonra tam ekran "You're selling $0.68" ve "Close". | Bir ekranda bir karar. Tutar ekranın en büyük öğesi. Ücret onaydan hemen önce, onay düğmesinin üstünde. İşlem sürerken ayrı, sakin bir durum ekranı. |
| **Phantom**, uygulamamızın onay penceresi (öykünücüde canlı) | Alttan açılan sayfa: sitenin simgesi ve adı, tahmini bakiye değişimi kırmızı ("-0.017042 SOL"), "Network Fee", kapalı duran "Advanced ›", iki düğme "Close" / "Confirm". Yeni alan adında sarı bant: "This domain is new…". | Kullanıcı burada **bizim site adımızı ve simgemizi** görüyor. Şu an simge Next.js'in varsayılan "N" simgesi (`web/app/favicon.ico`); Rung'ın kendi simgesi konursa onay penceresi tanıdık görünür. Uygulamadaki "cüzdandan şu kadar çıkacak" satırı bu pencerede yazanla aynı sayıyı göstermeli; iki sayı tutmazsa güven kaybolur. |
| **Solflare**, uygulamamızı engellediği pencere (öykünücüde canlı) | Kırmızı bant "Scam site detected", tek cümle açıklama ("Your funds are safe."), tek düğme "Close". | Kötü haber: kısa, ne olduğu ve paranın durumu tek cümlede, tek çıkış. Bizim "alınmadı" ekranımız için iyi bir ölçü. |
| **Jupiter** (jup.ag, canlı) | "Market / Limit / DCA" sekmeleri. İki alan (Sell, Buy). Alıcı tarafında "Paste CA" çipi. Tek geniş yeşil düğme; cüzdan yokken üstünde "Connect" yazıyor. Ayarlar: yalnız iki seçenek, "Ultra V3" ve "Manual". Ultra'da tek cümle ("…No settings to manage.") ve üç maddelik "What You Get". Manual'e geçince sarı uyarı ve "Switch back to Ultra V3 →"; sonra "Max Slippage" 0.5% / 1% / özel, öncelik ücreti SOL ve ≈$ olarak, her etiketin yanında (i). | Varsayılan yol ayarsız; uzman yolu tek dokunuş uzakta ve geri dönüşü belli. Adres yapıştırma tek dokunuş. Ana düğme o an yapılacak şeyi söylüyor. SOL tutarlarının yanında dolar karşılığı. |
| **Jupiter Mobile** (mağaza) | Ana ekran: büyük bakiye, altında yuvarlak eylem düğmeleri, sonra liste. Alım ekranı: başlık "Buy USDC", birim çipi "USD ⌄", dev "$500", altında "≈ 500.10 USDC", çipler $50 / $100 / $200 / $1,000, ödeme yöntemi satırı, geniş yeşil düğme, tuş takımı. Başka bir ekranda "0.1 SOL" altında "~$8.96". | Kripto tutarının altında her zaman dolar karşılığı var. Rung'da bakiye ve liste yok; ana ekrandaki yoğunluğa gerek olmadığının örneği. |
| **Fomo**, mobil alım ekranı (mağaza) | Token satırı (resim, ad, piyasa değeri; sağda fiyat ve değişim). Dev "$100", altında "625 MOODENG ⇅". 25% / 50% / 75% / 100%. Tuş takımı. Düğmenin üstünde "$33.2K available" ve "$0.50 fee". Düğme: "Slide to buy". | Kaydırarak onay, yanlış dokunmayı önleyen ama ek ekran istemeyen bir yol. Rung'da bu işi cüzdan onayı yapıyor. |
| **pump.fun**, coin sayfası (canlı web) | Sağda alım paneli: "Buy / Sell" sekmeleri ve dişli. Tutar alanı "$ 0", yanında birim değiştirici ("USD ⇅"). 25% / 50% / 100%. Ana düğme "Connect wallet to trade". Altında hızlı alım düğmeleri "$25 / $100 / $250" ve düzenleme kalemi. | Hazır tutarlar, kullanıcının kendi değiştirebildiği birkaç düğme. Birim (SOL ya da dolar) tek dokunuşla değişiyor. |
| **pump.fun**, mobil uygulama (mağaza) | "Buy and sell in one tap": token satırı ve sağında "Auto" çipi. Dev "$1,000", altında "Acquiring Jimothy". Ödeme çipi. $50 / $100 / $250 / $500. Tuş takımı. Düğmenin üstünde kapalı "Order details ⌄" ve "Fee on us!". Tek geniş beyaz düğme. Altta yüzen, beş ikonlu gezinme çubuğu. | Phantom ile aynı iskelet. Geçerli ayar (Auto) başlıkta tek kelimelik bir çip; ayrıntı isteyene "Order details". Tutarın altındaki kısa cümle ne olacağını sözle söylüyor. |
| **Moonshot** (mağaza) | Başlık "Buy DOGE $0.08". Ödeme kaynağı çipi. Dev "$100". 25% / 50% / 75% / MAX. Tuş takımı. Ayar ikonu ve kapatma köşelerde. Sloganı "Trading made simple". | Aynı iskelet. Token adı ve fiyatı tek satırda başlıkta; ayrı bir bilgi kutusu yok. |
| **Fomo**, web arayüzü (tanıtım sayfasındaki ekran) | "Buy / Sell". "$0 Enter amount". "$25 / $50 / $100 / $250" ve dişli. Düğmenin hemen üstünde "$4.32K available" ve "$2.32 fee". Düğme: "Buy HOUSTON". | Düğmede token adı var; ne alındığı son anda bir kez daha okunuyor. Kullanılabilir bakiye ve ücret düğmeyle aynı göz hizasında. |
| **GMGN** (canlı web terminali) | P1 / P2 / P3 ön ayarları. "Buy / Sell / Auto". Hazır tutarlar 0.01 / 0.1 / 0.5 / 1 SOL ve kalem. "1 SOL ≈ 4.02K CATE". Düğmenin altında etkin ayarların tek satırlık özeti. Çevresinde grafik, akış, onlarca sayı. | Profesyoneller için yoğun terminal; Rung'ın olmak istemediği şey. İki iyi fikir yine de alınabilir: SOL cinsinden hazır tutarlar ve "şu an geçerli ayar" özeti tek satırda. |
| **Raydium** (canlı web) | Takas kartının üstünde slippage çipi ("0.5%"). "Max" / "50%". Girişte uzun bir "Disclaimer" ve "Agree to terms". | Slippage tek bir küçük çipte duruyor. Uzun metinle karşılama, ilk ekranı işten uzaklaştırıyor. |
| **Uniswap Wallet** (mağaza) | İki alanlı takas ve tuş takımı; alımda "$300" dev sayı. | Aynı iskelet. |
| **Cash App** ve **Robinhood** (mağaza) | Tek renk zemin, dev "$20", tuş takımı; Robinhood'da büyük rakam, tek grafik, az öğe. | Kripto dışındaki en sade örnekler: ekranda bir sayı ve bir eylem. |

## Üç ya da daha çok üründe gördüğüm kalıplar

1. **Dev sayı, çipler, tuş takımı, tek düğme.** Phantom, Moonshot, pump.fun mobil, Uniswap, Cash App aynı iskeleti kullanıyor. Tutar, ekrandaki en büyük şey.
2. **Hazır tutar çipleri.** pump.fun, Fomo, GMGN sabit tutarlar; Phantom ve Moonshot bakiye yüzdeleri. Çoğunda kullanıcı çipleri değiştirebiliyor.
3. **Ayarlar tek ikonun arkasında, varsayılan "otomatik".** Jupiter (Ultra), Phantom, Moonshot, pump.fun. Slippage ana ekranda en fazla küçük bir çip.
4. **Ana düğme o anki işi söylüyor.** Cüzdan yokken "Connect", sonra "Buy <token>" ya da "Review". Ayrı bir "bağlan" ekranı yok.
5. **Ücret ve alınacak miktar onaydan hemen önce.** Fomo'da düğmenin üstünde, Phantom'da "Review" ekranında, GMGN'de kur satırında.
6. **İki adım: tutar, sonra gözden geçir ve onayla.** Geri alınamayan işte tek dokunuşla bitirmiyorlar; ama üçüncü bir adım da yok.
7. **Uyarılar renkli bant, kısa cümle, tek eylem.** Sarı dikkat, kırmızı engel (Phantom, Solflare, Jupiter Manual).
8. **Koyu tema.** Baktığım bütün kripto uygulamaları koyu; Cash App ve Robinhood'un mağaza ekranları da koyu ya da tek renk. Rung şu an açık tema.

## Yazılı kaynaklardan çıkanlar

Bu bölüm ekranlara bakarak değil, uygulamaların kendi yardım sayfaları, belgeleri ve tasarım kaynakları okunarak hazırlandı. Bağlantılar yanlarında; sayfaları tek tek ben açıp doğrulamadım, bir araştırma ajanı derledi. Ekranda kendi gördüğümle çakışanları "(ekranda da gördüm)" diye işaretledim.

**Uygulamaların kendi anlattıkları**

- **Phantom.** Slippage varsayılan olarak otomatik; elle ayar bir bilgi ikonunun arkasında. Fiyat etkisi slippage'dan ayrı gösteriliyor ve etki yüksekse önerilen şey slippage'ı artırmak değil, tutarı küçültmek. Ücret (%0,85, ekranda da gördüm) onaydan önce "Details" içinde. Başarısız görünen işlemde önce geçmişe ya da gezgine bakılması isteniyor, çünkü işlem aslında geçmiş olabilir. Pump.fun token'ları Phantom'da çoğu zaman "Unverified" etiketiyle görünür; yeni alınmış bir token cüzdanda gizlenmiş de olabilir. ([takas](https://help.phantom.com/hc/en-us/articles/5985106844435-Swap-crypto-on-the-same-network-in-Phantom), [takas ayarları](https://help.phantom.com/hc/en-us/articles/27085326202515-Swap-settings-in-Phantom), [doğrulanmamış token](https://help.phantom.com/hc/en-us/articles/38425812822419-Verified-and-unverified-tokens-in-Phantom), [gizlenen token](https://help.phantom.com/hc/en-us/articles/51665009279251-Token-flagged-as-spam-in-Phantom))
- **Solflare.** Slippage dişlinin arkasında, varsayılan %0,5; onay "slide to approve" hareketiyle. Yardım sayfası ücretler için bir miktar SOL ayırmayı söylüyor. ([mobil takas](https://help.solflare.com/en/articles/5758552-how-to-swap-tokens-using-solflare-mobile))
- **Jupiter.** Varsayılan "Ultra": kullanıcı slippage seçmiyor. "Manual" dişlinin arkasında, uyarıyla; varsayılanı %0,5, öncelik ücreti 0,001 SOL açık, Jito tip kapalı (ekranda da gördüm). Mobilde tuş takımı ve MAX / 50% / 25% çipleri. Hata sözleri arasında "Transaction expired" var: onay yavaş kalınca oluyor, çözüm hemen yeniden deneyip onaylamak. "Internal error" durumunda işlem geçmiş olabilir; önce bakiye kontrolü isteniyor. ([Ultra](https://docs.jup.ag/user-docs/trade/spot/ultra-mode), [Manual](https://docs.jup.ag/user-docs/trade/spot/manual-mode), [SSS](https://docs.jup.ag/user-docs/trade/spot/faq), [mobil](https://docs.jup.ag/user-docs/global/mobile/swaps-and-orders))
- **Raydium.** İşlemden sonra tahmini değil, gerçekten alınan miktar gösteriliyor ve gezgin bağlantısı veriliyor. Arayüz yapanlara önerileri: fiyat etkisini ve slippage'ı ayrı göster, "en az alınacak" miktarı yaz, fiyat etkisi slippage payını aşıyorsa işlem büyük olasılıkla geri döneceği için imzadan **önce** güçlü uyar. ([takas akışı](https://docs.raydium.io/user-flows/swap), [slippage ve fiyat etkisi](https://docs.raydium.io/algorithms/slippage-and-price-impact))
- **Trojan (Telegram botu).** Alım ön ayarları SOL cinsinden, satış ön ayarları elde tutulanın yüzdesi. Token hesabı için bir kez alınan yaklaşık 0,002 SOL'ün ne olduğu ayrıca açıklanıyor, çünkü kullanıcılar eksik SOL'ü fark edip soruyor. ([ayarlar](https://docs.trojan.com/trading-on-trojan/profiles-settings))
- **Robinhood, Coinbase, Revolut, Cash App.** Robinhood'da piyasa alımı aslında %1'e kadar tamponlu bir limit emri ve dolmayan emir iptal olabiliyor; "emrim neden dolmadı" diye ayrı bir destek sayfaları var. Coinbase "Preview order" ekranında ücret dahil toplamı gösterip ayrıntıyı ipucuna koyuyor. Revolut, tamamlanan alımın geri alınamayacağını açıkça yazıyor. Cash App: hazır tutar ya da özel tutar, tek doğrulama adımı. ([Robinhood](https://robinhood.com/support/articles/crypto-buying-and-selling/), [Coinbase](https://help.coinbase.com/en/coinbase/getting-started/getting-started-with-coinbase/pricing-and-fees), [Revolut](https://www.revolut.com/crypto/buy-crypto/), [Cash App](https://cash.app/help/3101-buying-bitcoin))
- **Uniswap.** Etiket olarak "slippage" yerine "Max slippage" kullanıyor; kendi yazılarında gerekçeleri kullanıcıya sormak yerine başarısızlığı otomatik önlemek. ([blog](https://blog.uniswap.org/uniswap-swap-ux-improvements))

**Kullanıcıların kafasını karıştıran şeyler**

- **"Başarısız", "hâlâ bekliyor" ve "geçti ama ekran hata dedi" ayrımı.** Phantom ve Jupiter bunun için ayrı açıklama yazmış. Rung'da merdiven ekranı bu üç durumu ayırabiliyor; ayrımın gözle de belli olması önemli.
- **Süresi dolan onay.** Cüzdana geçiş zaman alıyor; Jupiter'de de en sık sorulanlardan.
- **Slippage ile fiyat etkisinin karışması.** Phantom ve Raydium ayrı ayrı anlatmak zorunda kalmış.
- **Beklenenden az token gelmesi** ve **küçük alımlarda sabit ücretlerin payı.** Token hesabı depozitosu ilk alımda kullanıcıyı şaşırtıyor (Trojan'ın açıklaması bunun için).
- **Alınan token'ın cüzdanda görünmemesi.** Makbuzda token adresi ve gezgin bağlantısı bunun cevabı.
- **Tek dokunuşla alımda yanlış basma.** Fomo incelemelerinde geçiyor ([blocmates](https://www.blocmates.com/articles/fomo-a-mobile-first-social-trading-experience)). Rung'da cüzdan onayı doğal bir fren; onu kaldırmaya gerek yok.
- **Yeni token'larda işlemin tutmaması.** pump.fun mobil uygulaması çıktığında en çok eleştirilen şey buydu ([Blockworks](https://blockworks.co/news/pumpdotfun-releases-mobile-app)). Rung'ın merdiveni tam bu soruna cevap; ekranın bunu göstermesi ürünün kendini anlatması demek.

**Tasarım kaynaklarından ilkeler**

| ilke | kaynak | tek ekranlık alımda karşılığı |
|---|---|---|
| Sık gerekenler ilk ekranda, nadir ve ileri düzey olanlar bir dokunuş ötede; en çok iki düzey | [NN/g, progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Ana ekranda token, mod, tutar, düğme. Merdivenin ayrıntısı ve ücret dökümü "Details" arkasında; üçüncü bir katman yok. |
| Onay yalnız ciddi ve geri alınamaz işlerde; düğme sonucu söylesin, "Evet/Hayır" demesin | [NN/g, confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/) | Cüzdan onayı zaten bir onay; uygulama içinde ikinci bir "emin misin" eklemek alışkanlıkla geçilen bir ekran olur. |
| Hata mesajı sorunun yanında, sade dille, ne olduğunu ve ne yapılacağını söyler; kullanıcının girdisi korunur | [NN/g, error messages](https://www.nngroup.com/articles/error-message-guidelines/) | Alınamadıysa tutar ve mod dolu kalsın, yeniden deneme tek dokunuş olsun; hata kodu "Details" arkasında. |
| Alttan açılan sayfa kısa işler içindir; Geri tuşu kapatmalı, üst üste açılmamalı | [NN/g, bottom sheets](https://www.nngroup.com/articles/bottom-sheet/) | Mod açıklaması ya da ücret dökümü için uygun; ana alım için değil. |
| Dokunma hedefi en az 48×48dp, aralarında 8dp; küçük yazıda kontrast en az 4,5:1 | [Android erişilebilirlik](https://developer.android.com/guide/topics/ui/accessibility/apps), [Google](https://support.google.com/accessibility/android/answer/7101858) | Mod ve tutar çipleri ince görünse de 48dp yüksekliğinde dokunma alanı. Yalnız ikon olan düğmelere (yapıştır gibi) etiket. |
| Sayı girişinde sayısal klavye; ondalık ayırıcıya dikkat | [Baymard](https://baymard.com/blog/mobile-touch-keyboards) | Tutar alanı ondalıklı tuş takımı açmalı; Türkçe telefonda "," ile "." ikisi de çalışmalı. |
| Başparmağın rahat ettiği alan ekranın orta ve alt kısmı | [Smashing Magazine](https://smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users) | Tutar, çipler ve ana düğme orta-alt bölgede; üst köşelerde kritik bir şey olmasın. |

**Bulunamayanlar.** Axiom, Photon, BullX ve BONKbot'un varsayılan ayarları için resmi kaynak bulunamadı; internetteki "en iyi ayar" yazıları birbiriyle çelişiyor, sayıları oradan almamak gerekir. pump.fun mobil uygulamasının bugünkü varsayılan slippage'ı ve Solflare'ın "scam site" uyarısının resmi açıklaması da bulunamadı.

## Rung'a özgü düşünceler (öneri; karar arayüzü yapanın)

- **İmzadan önce uyarı.** Raydium'un önerisindeki gibi: görülen fiyatla şu anki fiyat arasındaki fark seçilen merdivenin tavanını zaten aşıyorsa bunu onaydan önce söylemek, kullanıcıyı boşuna cüzdana göndermemek demek.
- **Depozitoları bir kez anlatmak.** Makbuzdaki token hesabı ve emir kaydı satırları doğru ama kalabalık; "geri gelen" ile "gelmeyen" ayrımı tek bakışta okunursa en sık sorulacak sorunun cevabı ekranda olur.
- **Ondalık ayırıcı.** Tutar alanında virgülle yazılan sayı şu an kabul edilmiyor olabilir; Türkçe klavyede denenmeli.

- **Mod, Rung'da ayar değil, ürünün kendisi.** Diğerleri slippage'ı gizliyor; biz gizleyemeyiz, çünkü kullanıcıya sattığımız şey o merdiven. Ama beş düğmelik ızgara yerine daha hafif bir seçim düşünülebilir: seçili mod tek satırda ("Tight 1% → 2% → 3%"), diğerleri tek dokunuşla. Genç tokenda Launch önerisi zaten var; öneri seçili gelirse kullanıcı hiç düşünmeden doğru modda başlar.
- **Tutar.** Şu an düz bir metin kutusu. Hazır SOL tutarları (örneğin 0.01 / 0.05 / 0.1) ve yanında dolar karşılığı, yazmayı çoğu zaman gereksiz kılar.
- **Adres.** "Paste" düğmesi zaten var; adres yapıştırılınca kutu yerine token adı ve fiyatı tek satırlık bir başlığa dönüşebilir (Moonshot, Phantom).
- **Ana düğme.** Şu an hep aynı cümleyi taşıyor ve neden pasif olduğunu altındaki satır söylüyor. Düğmenin kendisi durumu söylerse ("Connect wallet", sonra alım cümlesi) alttaki satıra gerek azalır. Düğmedeki İngilizce cümle sabit metinlerden biri; değişecekse önce Buğra'ya sorulmalı (aşağıya bakın).
- **Onaydan önceki sayı.** "If no rung fills, max fee" satırı Rung'ın en güçlü güven cümlelerinden biri; düğmenin hemen üstünde, düğmeyle aynı göz hizasında durması Fomo'daki ücret satırı gibi çalışır.
- **Cüzdana gidiş ve dönüş.** Kullanıcı uygulamadan çıkıp cüzdana gidiyor; dönüşte ekranın "bekliyorum", "gönderildi", "süre doldu" durumlarından hangisinde olduğu hemen okunmalı. Onay bir dakikadan uzun sürerse işlem geçmiyor; bu sınır kullanıcıya önceden söylenmiyor.
- **Merdiven ekranı.** Rung'ın kimliği burada. Başka hiçbir uygulamada karşılığı yok; kopyalanacak örnek de yok. Basamakların sırayla denenmesi, dolan basamağın belirginleşmesi ve "bir kez alır" duygusu bu ekranın işi.
- **Makbuz.** "Most buyers type: 20% · This buy needed: 1%" satırı paylaşılmaya en uygun cümle. Diğer uygulamalarda paylaşım kartı yaygın; bizde bu satır o kartın çekirdeği olabilir. Ücret kalemleri uzun bir liste; ilk bakışta toplam, isteyene ayrıntı düşünülebilir.
- **Alınamadı ekranı.** Solflare'ın engel penceresi iyi bir ölçü: ne oldu, para nerede, tek düğme. Bizde "Your SOL comes back" cümlesi en üstte olmalı; yeniden deneme tek dokunuş.
- **Ağ rozeti.** "mainnet" / "devnet" rozeti şu an küçük ve gri. Gerçek para ile deneme parasını ayıran tek işaret bu; renk ya da konumla ayrışması yanlış ağda alımı önler.
- **Başparmak.** Ana düğme ekranın alt yarısında kalmalı; klavye açıkken de görünmeli. Şu an uzun ekranda düğmeye inmek için kaydırmak gerekiyor.
- **Koyu ya da açık.** Kalıp koyu tema; ama açık ve sade bir ekran Rung'ı kalabalık terminallerden ayırıyor da. İkisi de savunulabilir.

## Yapmamayı düşündüklerimiz ve nedeni

- **Grafik, akış, liderlik tablosu, bildirim.** GMGN, pump.fun ve Jupiter'de var; Rung'ın işi değil. Kullanıcı token'ı başka yerde bulup adresiyle geliyor.
- **Girişte uzun koşul metni.** Raydium ve pump.fun'da ilk ekranı kapatıyor.
- **Ön ayar katmanları (P1 / P2 / P3), öncelik ücreti ve tip alanları.** Rung bunları kullanıcı adına seçiyor; göstermek "tahmin etme" vaadiyle çelişir.
- **Aynı ekranda alım ve satım sekmeleri.** Rung şu an yalnız alıyor.

## Web sitesi: jüri uygulamayı indirmeyecek

Bu bölüm diğerlerinden farklı: bir tasarım fikri değil, yarışmayı bilen birinin uyarısı. 25 Kasım 2026'daki Superteam Türkiye toplantısında Buğra'ya söylenen: **küresel jüri bütün mobil uygulamaları indirip denemez; APK koymak yetmez, depoya ve APK'ya bakmak uzun sürer ve büyük olasılıkla bakmazlar.** Önerilen: ana sitede uygulamanın kullanım videosu ve insanların tarayıcıda deneyebileceği, öykünücü gibi bir şey.

Bunun anlamı: jüri için ürün, **site**. Uygulamanın ne yaptığı, sitenin ilk ekranında, hiçbir şey indirmeden anlaşılmalı.

Sitede olması gerekenler:

1. **Kullanım videosu, sayfanın en üstünde.** Gerçek uygulama, gerçek bir mainnet alımı, baştan sona: adresi yapıştır, modu seç, cüzdanda bir kez onayla, merdiven, makbuz. Kısa olmalı; sesi kapalı izlenince de anlaşılmalı (çekim ve seslendirme takımın işi).
2. **Tarayıcıda denenebilen bir gösterim.** Seçenekler aşağıda.
3. **Kanıt şeridi.** Mainnet alımları ve gezgin bağlantıları; sayfa şu an devnet sayacını gösteriyor, mainnet'e çevrilecek.

"Öykünücü gibi bir şey" için üç yol ve bedelleri:

| yol | ne olur | bedeli |
|---|---|---|
| **Gerçek bir alımın yeniden oynatılması** | Sayfada telefon çerçevesi içinde uygulamanın ekranları; ziyaretçi dokunarak ilerler. Gösterilen her sayı kaydedilmiş gerçek bir mainnet alımından gelir (fiyat, basamak, işlem imzaları, gezgin bağlantıları) ve ekranda "24 Kasım'daki gerçek bir alımın yeniden oynatılması" diye yazar. Cüzdan gerekmez. | En hızlısı. Canlı değil; bunun açıkça yazılması şart. |
| **Web'den gerçek alım** | Tarayıcı cüzdanıyla (Phantom eklentisi) sitede gerçekten alım yapılır. | Gerçek ürün, ama en büyük iş: uygulamanın alım akışının web'e taşınması gerekir. Cüzdan uyarıları ("This domain is new") web'de de çıkar. Jürinin cüzdanında SOL olması gerekir. |
| **Tarayıcıda çalışan Android öykünücüsü** | Gerçek APK bir hizmet üzerinden tarayıcıda açılır. | İçinde cüzdan uygulaması olmadığı için onay adımına kadar gidilebilir; alım tamamlanmaz. Bu hizmetlerin ücretini ve sınırlarını doğrulamadım. |

Geliştirici ajanın önerisi ilki, videoyla birlikte: hızlı, dürüst ve jüri bir dakikada ürünü görmüş olur. Karar Buğra ve Merve'nin.

Aynı toplantıda bir uyarı daha geldi: jüri "neden yalnız mobil, neden web'den alım yok?" diye sorabilir. Bu, tablodaki ikinci yolu (web'den gerçek alım) hackathon sonrası için de değerli kılıyor; şimdilik yeniden oynatma bu soruya "web'de görebilir ve deneyebilirsiniz" cevabını verir.

Projenin bu konudaki sabiti: **sahte gösterim ve uydurma veri yok.** Yeniden oynatma yalnız gerçek, zincirde duran alımların verisini kullanır ve yeniden oynatma olduğunu söyler.

### Buğra'nın kararları (25 Kasım akşamı; Merve'nin `merve/frontend` dalındaki `docs/on-yuz-notlari.md` notuna cevap)

- **Gösterimin altındaki üç İngilizce cümle onaylandı.** "Replay of a real mainnet buy from the Android app, Nov 24, 2026: …" ile başlayan üç cümle ve senaryo düğmelerinin yazıları, notta yazıldıkları gibi kalır. İçerikleri README'deki emirlerle karşılaştırıldı, doğru.
- **Site düzeni:** telefon en üstte; sayaç, son alımlar, modlar, terimler ve kaynaklar altında kalır. Yalnız telefon bırakılmayacak.
- **Sayaç notundaki cümle:** "They include test runs where we moved the price on purpose." site mainnet'e çevrilirken çıkarılacak; bunu Buğra'nın ajanı yapar.
- **Demodaki sayaç sayıları elle yazılmasın.** Demo "14 alındı, 1 henüz sonuçlanmadı, ortalama %2,07" diyordu; o okuma bir işlemi kaçırmış. Zincirde 25 Kasım akşamı: 17 emir, 15 alım, 2 alınamayan, açık emir yok, ortalama basamak %2,00. Sayılar sayfada canlı okunmalı.

## Projeden gelen sabitler (bu notlardan bağımsız)

- **Ekrandaki İngilizce cümleler** devir metninden kelimesi kelimesine gelir ve testle denetlenir. Görünümleri, yerleri, boyutları değişebilir; sözleri değişecekse önce Buğra'ya sorulur.
- **Mantık ve görünüm ayrı klasörlerde.** Görünüm `app/src/screens/` içinde (`ui.tsx` renkleri ve ölçüleri tutar). Alım akışı, cüzdan, merdiven ve hesaplar `app/src/flow/` ile `client/` içindedir; bunlara dokunmak gerekirse Buğra'nın geliştirici ajanına haber verilir.
- **Token adı, resmi ve dolar karşılığı hazır (25 Kasım).** Ekranda kullanmak için `app/src/screens/ui.tsx` içinde iki parça var: `<TokenLine mint={...} />` (resim, ad, sembol ve kısa adres; alım ekranında `fromNetwork` ile zincirden okur, öbür ekranlarda daha önce okunanı gösterir) ve geçmiş listesi için `<TokenRow mint={...} />`. Kendi görünümünü kurmak istersen veri `app/src/flow/tokenInfo.ts` içinde: `useTokenInfo(mint, fromNetwork)` → `{ name, symbol, imageUrls }` ya da `null`; `useSolUsd()` → SOL'un dolar fiyatı ya da `null`. Yazıya çevirmek için `tokenTitle`, `tokenInitials` (`app/src/tokenLabel.ts`), `usdText(lamportsToUsd(lamport, fiyat))` (`client/`). Üç kural: `imageUrls` sırayla denenecek adreslerdir (ilki açılmazsa sonraki; hiçbiri açılmazsa adın ilk iki harfi); ad ve resim token'ı çıkaranın yazdığıdır, o yüzden adres ekranda kalır; dolar karşılığı yalnız mainnet'te vardır, `null` gelince satır hiç gösterilmez (devnet SOL'ünün fiyatı yok).
- **Denetim:** `client/` içinde `npm test` (177 test) ve `app/` içinde `npx tsc --noEmit` geçmelidir.
- **Deneme:** öykünücüde devnet'te deneme cüzdanıyla; mainnet alımını Buğra kendisi onaylar. Geliştirme sunucusu `CI=1` olmadan başlatılmalı, yoksa uygulama eski paketi çalıştırır.
- **Cüzdan onay penceresindeki ad ve simge** `app/src/config.ts` içindeki `APP_IDENTITY`'den ve sitenin `favicon.ico`'sundan gelir. **Simge Merve'de (Buğra'nın kararı, 26 Kasım):** şu an Next.js'in varsayılan "N" simgesi duruyor ve Phantom'un bağlantı ve onay pencerelerinde o görünüyor ([ekran](shots/wallet-phantom-confirm-rungbot-new-domain.png)); Solflare simgeyi hiç gösteremiyor, yerine boş bir küre koyuyor ([ekran](shots/wallet-solflare-approval-rungbot.png)). Rung simgesi hazır olunca `web/app/favicon.ico` yerine konur; kare, küçük boyutta okunur olmalı (cüzdanlar yaklaşık 48–64 piksel gösteriyor). Solflare `.ico` dosyasını göstermiyorsa PNG de gerekir; onu `APP_IDENTITY.icon` satırına bağlamak Buğra'nın ajanının işi, görseli bırakman yeter. Hangi dosyaların hangi boyutta bırakılacağı ve girişteki Seeker videosunun nasıl üretileceği: [görsel istekleri](gorsel-istekleri.md).
