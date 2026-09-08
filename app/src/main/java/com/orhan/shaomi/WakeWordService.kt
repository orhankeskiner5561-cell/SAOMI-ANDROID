package com.orhan.shaomi

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import org.vosk.android.StorageService
import java.util.Locale

class WakeWordService : Service(), RecognitionListener {
    private var model: Model? = null
    private var recognizer: Recognizer? = null
    private var speech: SpeechService? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var commands: CommandEngine

    @Volatile private var prepared = false
    @Volatile private var active = false
    @Volatile private var commandMode = false
    @Volatile private var commandHandled = false

    private val commandTimeout = Runnable {
        if (commandMode && !commandHandled) {
            commandMode = false
            commandHandled = false
            sendState("ACTIVE")
            startWakeListening()
        }
    }

    override fun onCreate() {
        super.onCreate()
        commands = CommandEngine(this)
        createChannel()
        val openApp = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        startForeground(
            NOTIFICATION_ID,
            NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("ŞAOMİ dinlemede")
                .setContentText("'Şaomi' deyin, ardından komutunuzu söyleyin")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(openApp)
                .build()
        )
        val pm = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "shaomi:WakeWordLock").apply {
            setReferenceCounted(false)
            acquire()
        }
        sendState("PREPARING")
        prepareModel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PAUSE -> pauseWake()
            ACTION_RESUME -> resumeWake()
            ACTION_STOP -> stopSelf()
            else -> if (prepared && !active) resumeWake()
        }
        return START_STICKY
    }

    private fun prepareModel() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            sendState("NO_MIC_PERMISSION")
            stopSelf()
            return
        }
        StorageService.unpack(
            this,
            "model-tr",
            "wake-model-tr-v913",
            { loaded -> model = loaded; prepared = true; resumeWake() },
            { error -> sendState("ERROR:${error.message ?: "model"}"); stopSelf() }
        )
    }

    private fun resumeWake() {
        if (!prepared || model == null) return
        handler.removeCallbacks(commandTimeout)
        active = true
        commandMode = false
        commandHandled = false
        startWakeListening()
    }

    private fun pauseWake() {
        active = false
        commandMode = false
        commandHandled = false
        handler.removeCallbacks(commandTimeout)
        stopRecognition()
        sendState("PAUSED")
    }

    private fun newRecognizer() {
        stopRecognition()
        val m = model ?: return
        recognizer = Recognizer(m, 16000f)
        speech = SpeechService(recognizer, 16000f).also { it.startListening(this) }
    }

    private fun startWakeListening() {
        if (!active) return
        try {
            commandMode = false
            commandHandled = false
            newRecognizer()
            sendState("ACTIVE")
        } catch (e: Exception) {
            sendState("ERROR:${e.message ?: "recognizer"}")
        }
    }

    private fun startCommandListening(initialCommand: String = "") {
        if (!active) return
        commandMode = true
        commandHandled = false
        sendState("TRIGGERED")
        if (initialCommand.isNotBlank()) {
            executeCommand(initialCommand)
            return
        }
        try {
            newRecognizer()
            handler.removeCallbacks(commandTimeout)
            handler.postDelayed(commandTimeout, 5500L)
            sendState("COMMAND_LISTENING")
        } catch (e: Exception) {
            startWakeListening()
        }
    }

    private fun normalize(value: String): String = value
        .lowercase(Locale("tr", "TR"))
        .replace('î', 'i')
        .replace(Regex("[^a-zçğıöşü0-9'’ ]"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()

    private fun extract(json: String): String = runCatching {
        val obj = JSONObject(json)
        val raw = when {
            obj.has("partial") -> obj.optString("partial")
            obj.has("text") -> obj.optString("text")
            else -> ""
        }
        normalize(raw)
    }.getOrDefault("")

    private fun trFold(s: String): String = s
        .replace('ş','s').replace('ç','c').replace('ğ','g')
        .replace('ı','i').replace('ö','o').replace('ü','u')

    private fun levenshtein(a: String, b: String): Int {
        if (a == b) return 0
        if (a.isEmpty()) return b.length
        if (b.isEmpty()) return a.length
        var prev = IntArray(b.length + 1) { it }
        var cur = IntArray(b.length + 1)
        for (i in a.indices) {
            cur[0] = i + 1
            for (j in b.indices) {
                val cost = if (a[i] == b[j]) 0 else 1
                cur[j + 1] = minOf(cur[j] + 1, prev[j + 1] + 1, prev[j] + cost)
            }
            val tmp = prev; prev = cur; cur = tmp
        }
        return prev[b.length]
    }

    private fun wakeIndex(words: List<String>): Int {
        val targets = WAKE_WORDS.map(::trFold)
        return words.indexOfFirst { raw ->
            val w = trFold(raw)
            w.length >= 3 && targets.any { t -> w == t || (kotlin.math.abs(w.length - t.length) <= 2 && levenshtein(w, t) <= 2) }
        }
    }

    private fun checkWake(heard: String) {
        if (!active || commandMode || heard.isBlank()) return
        val words = heard.split(' ').filter { it.isNotBlank() }
        val idx = wakeIndex(words)
        if (idx < 0) return
        val trailing = words.drop(idx + 1).joinToString(" ").trim()
        sendBroadcast(Intent(ACTION_WAKE_DETECTED).setPackage(packageName).putExtra(EXTRA_HEARD, heard))
        // Aynı cümlede komut da söylendiyse beklemeden uygula: "Şaomi WhatsApp'ı aç".
        startCommandListening(trailing)
    }

    private fun executeCommand(command: String) {
        if (!active || commandHandled || command.isBlank()) return
        commandHandled = true
        handler.removeCallbacks(commandTimeout)
        val result = commands.execute(command)
        sendBroadcast(
            Intent(ACTION_COMMAND_RESULT).setPackage(packageName)
                .putExtra(EXTRA_COMMAND, command)
                .putExtra(EXTRA_MESSAGE, result.message)
                .putExtra(EXTRA_SUCCESS, result.success)
        )
        handler.postDelayed({ if (active) startWakeListening() }, 700L)
    }

    private fun check(json: String, finalResult: Boolean) {
        val heard = extract(json)
        if (heard.isBlank()) return
        if (commandMode) {
            // Komut için partial'da yalnız çok net eylemler gelirse hızlandır; aksi halde final sonucu bekle.
            val k = trFold(heard)
            val actionable = listOf(" ac", " kapat", " ara", " fener", " sesi", " rehber", " whatsapp", " youtube", " chatgpt", " tradingview")
                .any { it.trim() in k }
            if (finalResult || (heard.split(' ').size >= 2 && actionable)) executeCommand(heard)
        } else {
            checkWake(heard)
        }
    }

    override fun onPartialResult(hypothesis: String) = check(hypothesis, false)
    override fun onResult(hypothesis: String) = check(hypothesis, true)
    override fun onFinalResult(hypothesis: String) {
        check(hypothesis, true)
        if (active && !commandMode && !commandHandled) startWakeListening()
    }
    override fun onError(exception: Exception) {
        if (active) handler.postDelayed({ startWakeListening() }, 250L)
    }
    override fun onTimeout() {
        if (active) startWakeListening()
    }

    private fun stopRecognition() {
        runCatching { speech?.stop() }
        runCatching { speech?.shutdown() }
        speech = null
        runCatching { recognizer?.close() }
        recognizer = null
    }

    private fun sendState(state: String) {
        sendBroadcast(Intent(ACTION_WAKE_STATE).setPackage(packageName).putExtra(EXTRA_STATE, state))
    }

    override fun onDestroy() {
        active = false
        handler.removeCallbacksAndMessages(null)
        stopRecognition()
        runCatching { model?.close() }
        model = null
        runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }
        wakeLock = null
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "ŞAOMİ uyandırma", NotificationManager.IMPORTANCE_LOW))
    }

    companion object {
        const val CHANNEL = "shaomi_wake"
        const val NOTIFICATION_ID = 9131
        const val ACTION_WAKE_DETECTED = "com.orhan.shaomi.WAKE_DETECTED"
        const val ACTION_WAKE_STATE = "com.orhan.shaomi.WAKE_STATE"
        const val ACTION_COMMAND_RESULT = "com.orhan.shaomi.COMMAND_RESULT"
        const val ACTION_PAUSE = "com.orhan.shaomi.WAKE_PAUSE"
        const val ACTION_RESUME = "com.orhan.shaomi.WAKE_RESUME"
        const val ACTION_STOP = "com.orhan.shaomi.WAKE_STOP"
        const val EXTRA_HEARD = "heard"
        const val EXTRA_STATE = "state"
        const val EXTRA_COMMAND = "command"
        const val EXTRA_MESSAGE = "message"
        const val EXTRA_SUCCESS = "success"
        private val WAKE_WORDS = setOf("şaomi", "şami", "xiaomi", "şayomi", "şomi", "saomi", "sayomi")
    }
}
