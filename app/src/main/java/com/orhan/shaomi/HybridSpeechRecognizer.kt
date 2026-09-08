package com.orhan.shaomi

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import java.util.Locale

/**
 * ŞAOMİ 9.3: İnternet varsa Android/Google Türkçe konuşma tanımayı kullanır.
 * Ağ/tanıyıcı uygun değilse yerel Vosk'a otomatik düşer.
 */
class HybridSpeechRecognizer(
    private val context: Context,
    private val vosk: VoskOfflineRecognizer,
    private val onListening: (String) -> Unit,
    private val onText: (String) -> Unit,
    private val onError: (String) -> Unit
) {
    private var nativeRecognizer: SpeechRecognizer? = null
    private var finished = false
    private var fallbackStarted = false

    fun listenOnce() {
        stopNative()
        finished = false
        fallbackStarted = false

        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            startVoskFallback("Çevrimiçi tanıyıcı yok, çevrimdışı Vosk dinliyor")
            return
        }

        try {
            nativeRecognizer = SpeechRecognizer.createSpeechRecognizer(context).also { sr ->
                sr.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {
                        onListening("Dinliyorum Orhan Bey")
                    }
                    override fun onBeginningOfSpeech() = Unit
                    override fun onRmsChanged(rmsdB: Float) = Unit
                    override fun onBufferReceived(buffer: ByteArray?) = Unit
                    override fun onEndOfSpeech() = Unit

                    override fun onError(error: Int) {
                        if (finished || fallbackStarted) return
                        // No-match, network, server, recognizer busy vb. durumlarda Vosk'a geç.
                        startVoskFallback("Çevrimdışı dinliyorum Orhan Bey")
                    }

                    override fun onResults(results: Bundle?) {
                        if (finished) return
                        val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
                        val text = list.firstOrNull { it.isNotBlank() }?.trim().orEmpty()
                        if (text.isBlank()) {
                            startVoskFallback("Çevrimdışı dinliyorum Orhan Bey")
                        } else {
                            finished = true
                            stopNative()
                            onText(text)
                        }
                    }

                    override fun onPartialResults(partialResults: Bundle?) = Unit
                    override fun onEvent(eventType: Int, params: Bundle?) = Unit
                })
            }

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "tr-TR")
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "tr-TR")
                putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, true)
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false)
                // Xiaomi/Google tanıyıcılarda destekleniyorsa cevabı hızlandırır.
                putExtra("android.speech.extra.SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS", 650L)
                putExtra("android.speech.extra.SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS", 450L)
                putExtra("android.speech.extra.SPEECH_INPUT_MINIMUM_LENGTH_MILLIS", 300L)
            }
            onListening("Dinliyorum Orhan Bey")
            nativeRecognizer?.startListening(intent)
        } catch (_: Exception) {
            startVoskFallback("Çevrimdışı dinliyorum Orhan Bey")
        }
    }

    private fun startVoskFallback(status: String) {
        if (finished || fallbackStarted) return
        fallbackStarted = true
        stopNative()
        onListening(status)
        vosk.listenOnce(timeoutMs = 6_000)
    }

    fun stop() {
        finished = true
        stopNative()
        vosk.stop()
    }

    fun close() {
        stop()
    }

    private fun stopNative() {
        runCatching { nativeRecognizer?.cancel() }
        runCatching { nativeRecognizer?.destroy() }
        nativeRecognizer = null
    }
}
