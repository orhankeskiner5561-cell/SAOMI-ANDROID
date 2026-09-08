package com.orhan.shaomi

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import org.vosk.android.StorageService
import java.util.Locale

class VoskOfflineRecognizer(
    private val context: Context,
    private val onReady: () -> Unit,
    private val onText: (String) -> Unit,
    private val onError: (String) -> Unit
) : RecognitionListener {

    private var model: Model? = null
    private var recognizer: Recognizer? = null
    private var speechService: SpeechService? = null
    private var delivered = false
    private var bestResult = ""

    fun prepare() {
        if (model != null) {
            onReady()
            return
        }
        StorageService.unpack(
            context,
            "model-tr",
            "model-tr",
            { loaded ->
                model = loaded
                onReady()
            },
            { error -> onError("Türkçe Vosk modeli açılamadı: ${error.message ?: "bilinmeyen hata"}") }
        )
    }

    fun listenOnce(timeoutMs: Int = 10_000) {
        val loadedModel = model ?: run {
            onError("Türkçe model henüz hazır değil.")
            return
        }
        stop()
        delivered = false
        bestResult = ""
        try {
            // ŞAOMİ 9.2: Serbest sözlük yerine telefonun gerçek komutları, uygulamaları
            // ve (izin varsa) rehber isimleriyle sınırlı bir Vosk grameri kullanılır.
            // Bu, özellikle "aç / ağaç" gibi yanlışları ciddi biçimde azaltır.
            val grammar = buildGrammar()
            recognizer = Recognizer(loadedModel, 16_000f, grammar)
            speechService = SpeechService(recognizer, 16_000f).also { service ->
                service.startListening(this, timeoutMs)
            }
        } catch (e: Exception) {
            // Bazı cihaz/model kombinasyonlarında dinamik gramer açılamazsa
            // serbest tanımaya güvenli şekilde geri dön.
            try {
                recognizer = Recognizer(loadedModel, 16_000f)
                speechService = SpeechService(recognizer, 16_000f).also { service ->
                    service.startListening(this, timeoutMs)
                }
            } catch (fallback: Exception) {
                onError("Mikrofon başlatılamadı: ${fallback.message ?: e.message ?: "bilinmeyen hata"}")
            }
        }
    }

    fun stop() {
        runCatching { speechService?.stop() }
        runCatching { speechService?.shutdown() }
        speechService = null
        runCatching { recognizer?.close() }
        recognizer = null
    }

    fun close() {
        stop()
        runCatching { model?.close() }
        model = null
    }

    override fun onPartialResult(hypothesis: String) = Unit

    // onResult bazen cümlenin yalnız ilk parçasını döndürür. 9.1'de bu sonuç
    // hemen çalıştırıldığı için "Murat'ı ara" -> "araç" gibi yarım/yanlış komutlar
    // oluşabiliyordu. Artık sonucu saklayıp final sonucu bekliyoruz.
    override fun onResult(hypothesis: String) {
        val text = textFrom(hypothesis)
        if (text.length > bestResult.length) bestResult = text
    }

    override fun onFinalResult(hypothesis: String) {
        val finalText = textFrom(hypothesis)
        val chosen = if (finalText.isNotBlank()) finalText else bestResult
        deliverText(chosen)
    }

    override fun onError(exception: Exception) {
        onError("Ses tanıma hatası: ${exception.message ?: "bilinmeyen hata"}")
    }

    override fun onTimeout() {
        if (delivered) return
        if (bestResult.isNotBlank()) deliverText(bestResult)
        else onError("Komutu duyamadım Orhan Bey.")
    }

    private fun textFrom(json: String): String = runCatching {
        JSONObject(json).optString("text").trim()
    }.getOrDefault("")

    private fun deliverText(text: String) {
        if (delivered || text.isBlank()) return
        delivered = true
        stop()
        onText(text)
    }

    private fun buildGrammar(): String {
        val phrases = linkedSetOf(
            "feneri aç", "feneri kapat", "feneri söndür", "fener aç", "fener kapat",
            "ışığı aç", "ışığı kapat", "el fenerini aç", "el fenerini kapat",
            "rehberi aç", "kişileri aç", "telefon rehberini aç",
            "whatsapp aç", "whatsapp'ı aç", "vatsap aç", "vatsap'ı aç",
            "youtube aç", "youtube'u aç", "chatgpt aç", "chatgpt'yi aç",
            "tradingview aç", "tradingview'i aç",
            "ana ekrana dön", "uygulamadan çık", "uygulamayı kapat",
            "geri dön", "geri git",
            "sesi aç", "sesi yükselt", "sesi artır", "sesi kıs", "sesi azalt", "sesi kapat",
            "mesajı oku", "mesajları oku", "bildirimleri oku", "whatsapp mesajını oku",
            "ekranı oku", "burayı oku", "sayfayı oku",
            "kamerayı aç", "kamera aç", "fotoğraf aç", "video aç"
        )

        // Telefonda kurulu uygulamaları da "X aç" biçiminde gramera ekle.
        @Suppress("DEPRECATION")
        context.packageManager.getInstalledApplications(0)
            .asSequence()
            .mapNotNull { app -> runCatching { context.packageManager.getApplicationLabel(app).toString() }.getOrNull() }
            .map { it.trim().lowercase(Locale("tr", "TR")) }
            .filter { it.length in 2..32 && it.none { ch -> ch == '\n' || ch == '[' || ch == ']' } }
            .distinct()
            .take(100)
            .forEach { label -> phrases += "$label aç" }

        // Rehber izni verilmişse kişileri de doğrudan gramera ekle.
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) {
            runCatching {
                context.contentResolver.query(
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME),
                    null, null, null
                )?.use { c ->
                    val seen = linkedSetOf<String>()
                    while (c.moveToNext() && seen.size < 250) {
                        val name = c.getString(0)?.trim()?.lowercase(Locale("tr", "TR")) ?: continue
                        if (name.length !in 2..40 || name.any { it == '\n' || it == '[' || it == ']' }) continue
                        if (seen.add(name)) {
                            phrases += "ara $name"
                            phrases += "$name ara"
                        }
                    }
                }
            }
        }

        // [unk] sayesinde gramer dışında kalan kısa parçalar tamamen kilitlenmez.
        phrases += "[unk]"
        return JSONArray(phrases.toList()).toString()
    }
}
