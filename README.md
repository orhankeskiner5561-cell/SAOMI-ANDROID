# ŞAOMİ 9.13 – 9.10 tabanlı hızlı uyandırma ve arka plan komut sürümü

Bu sürüm doğrudan ŞAOMİ 9.10 kaynak paketinden türetilmiştir.

Düzeltmeler:
- Uyandırma servisi artık yalnız "Şaomi"yi tespit edip Activity açmaya güvenmiyor.
- "Şaomi WhatsApp'ı aç" gibi tek cümlede söylenen komutları foreground servis kendi içinde işler.
- "Şaomi" denip ardından komut söylenirse servis ikinci dinleme moduna geçer ve komutu işler.
- Ana ekran/arka plan durumunda Activity öne getirilemese bile CommandEngine çalıştırılır.
- Wake partial sonuçları kullanılmaya devam eder; komut final sonucu veya yeterince net partial sonuçla hızlandırılır.
- 9.10'daki rehber, fener, ses, Vosk modeli ve Telefon Kontrol servisi korunmuştur.

Test:
1. Pil ayarı: Kısıtlama yok.
2. ŞAOMİ Telefon Kontrolü: Açık.
3. Uygulamayı bir kez açın ve "ŞAOMİ UYANDIRMA: AKTİF" görün.
4. KONUŞ'a basmadan: "Şaomi WhatsApp'ı aç".
5. Ardından ana ekranda aynı komutu deneyin.
