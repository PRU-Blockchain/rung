# Telefonda deneme senaryoları (imzalı sürüm, mainnet)

Her alım gerçek SOL harcar; hepsini 0,01 SOL ile yap. Her senaryoda "ne yaptın" ve "ne olmalı" yazıyor. Olmayan bir şey görürsen ekran görüntüsünü at.

## A. Sorunsuz yol

1. **İlk açılış.** Uygulamayı aç. Üstte `mainnet`, altta sarı `Paste` olmalı; cüzdan adresi görünmemeli.
2. **Bağlantıdan yapıştırma.** pump.fun'da bir token sayfasının bağlantısını kopyala, token kutusuna dokun. Token adı ve resmi kendiliğinden gelmeli.
3. **Cüzdanın rakamı.** Düğmenin üstündeki `Wallet shows … SOL` satırını oku, `Buy once`a bas, cüzdandaki rakamla karşılaştır. İkisi aynı olmalı (Solflare iki haneye yuvarlar: 0.0142 → 0.01, 0.0157 → 0.02).
4. **Alım.** Onayla. Merdiven, sonra makbuz gelmeli; elinde bir tık ve iki vuruş hissetmelisin. `Go to home` ana ekrana dönmeli.
5. **Hatırlama.** Uygulamayı kapatıp aç. Son kullandığın tutar ve mod gelmeli.

## B. Kullanıcının yapabileceği hatalar

6. **Yanlış adres.** Kendi cüzdan adresini, sonra rastgele bir yazıyı yapıştır. `This token is not a pump.fun token.` ya da `This is not a token address.` yazmalı, düğme basılamaz olmalı.
7. **Yanlış tutar.** Tutarı sil; sonra 5 yaz; sonra 0.0001 yaz. Her birinde kırmızı bir açıklama çıkmalı.
8. **Bakiyeden fazla.** `0.5`e bas (cüzdanda o kadar yoksa). `Not enough SOL in the wallet for this buy.` yazmalı.
9. **Cüzdanda vazgeçme.** `Buy once`a bas, cüzdanda çarpıya bas. Uygulama `Nothing was sent` demeli; cüzdan bakiyen değişmemeli.
10. **Geç onay.** `Buy once`a bas, cüzdan ekranında iki dakika bekle, sonra onayla. `Approval took too long. Nothing was sent. Try again.` demeli; para gitmemeli.

## C. Zor anlar

11. **Alınmayan emir.** pump.fun ana sayfasından yeni çıkmış, hızlı hareket eden bir token seç. Modu `Custom` yap, ilk kutuya 0.01 yaz, diğerlerini boş bırak. Al. Büyük olasılıkla `Not bought. Your SOL is back.` gelir: tavan çizgisi, geri dönen tutar ve ücret görünmeli. Cüzdanda bakiyene bak: yalnız birkaç on binde bir SOL eksilmiş olmalı.
12. **Retry.** O ekranda `Retry`a bas, `Launch`ı seç. Doğrudan cüzdan onayı gelmeli, aynı tutarla.
13. **Uygulama kapanırsa.** Bir alımda onayı verir vermez uygulamayı son uygulamalardan kaydırıp kapat. On saniye sonra yeniden aç. Uygulama yarım kalan emri kendisi bulup sonucu göstermeli.
14. **İnternet yokken.** Uçak modunu aç, `Buy once`a bas. `No network connection. Check it and try again.` demeli. Uçak modunu kapat.

## D. Cüzdan

15. **Bağlantıyı kes.** Üstteki adresine bas, `Disconnect`. Adres anında kaybolmalı, cüzdan uygulaması açılmamalı.
16. **Başka cüzdan.** (İki cüzdanın varsa.) `Buy once`a bas, öbür cüzdanı seç. Adres değişmeli.
17. **Yanlış cüzdanla onay.** Bir cüzdanla bağlıyken alımı öbür cüzdanla onaylamayı dene. `That wallet holds a different account…` demeli; para gitmemeli.

## E. Satış

18. **Token listesi.** Ana ekranın üstündeki `Sell` sekmesine bas. Cüzdanındaki pump.fun token'ları adı, resmi ve miktarıyla listelenmeli (örneğin aldığın CATE). Cüzdan bağlı değilse `Connect wallet` çıkmalı.
19. **Satış fiyatı.** Bir token'ın `Sell` düğmesine bas. Açılan sayfada dört mod (Tight, Normal, Fast, Launch), sattığın miktar, satışın yaklaşık ödeyeceği SOL, en az alacağın SOL (tavanın) ve geri dönecek hesap depozitosu yazmalı. Henüz hiçbir şey gönderilmemiş olmalı.
20. **Sat.** `Sell all`a bas. **Cüzdan ekranına dikkatle bak:** tek onayda üç işlem imzalatıyoruz (%1, %2, %3); cüzdanın bunu nasıl gösterdiğini, kaç SOL ve token yazdığını not et ya da ekran görüntüsü al. Onayla. Üç basamak kartı görünmeli; büyük olasılıkla `try 1%: sold`, diğerleri `not needed`. `Sold` ve cüzdanına dönen SOL yazmalı; `Done` deyince token listeden çıkmalı.
21. **Makbuzdan satış.** Bir alım yap; makbuzdaki `Sell` düğmesi doğrudan o token'ın satış sayfasını açmalı.
22. **Satışta vazgeçme.** `Sell all`a bas, cüzdanda çarpıya bas. `Nothing was sent` demeli; token yerinde durmalı.

## F. Site (telefonun tarayıcısında rungbot.xyz)

23. **İlk ekran.** Başlık, `DEMO` etiketli telefon ve `Buy once` düğmesi tek ekrana sığmalı; tuş takımı kesilmemeli.
24. **Tekrar.** Sitedeki `Buy once`a bas; merdiven ve makbuz oynamalı. Altındaki `not bought` çipine bas, sonra `Buy once`: alınmayan emir oynamalı, `Retry` mod listesini açmalı.
25. **Aşağısı.** `Try real app`, `Build Rung into your app` ve tıklayınca açılan `Technical details` görünmeli.

## Bana yazarken

Hangi numarada ne gördüğünü yazman yeter: "11'de tavan çizgisi çıkmadı" gibi.
