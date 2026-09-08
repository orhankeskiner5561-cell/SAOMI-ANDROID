package com.orhan.shaomi

import android.Manifest
import android.content.Intent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.MediaStore
import android.provider.Settings
import android.speech.tts.TextToSpeech
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.orhan.shaomi.databinding.ActivityMainBinding
import java.util.Locale

class MainActivity : AppCompatActivity(), TextToSpeech.OnInitListener {
    private lateinit var binding: ActivityMainBinding
    private lateinit var commands: CommandEngine
    private lateinit var vosk: VoskOfflineRecognizer
    private lateinit var hybrid: HybridSpeechRecognizer
    private var tts: TextToSpeech? = null
    private var state = State.IDLE
    private var wakeReceiverRegistered = false
    private val wakeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                WakeWordService.ACTION_WAKE_DETECTED -> {
                    // WakeWordService komut moduna kendisi geçiyor.
                    // Burada ikinci bir SpeechRecognizer/Vosk oturumu başlatmıyoruz.
                    if (state == State.IDLE) {
                        show("ŞAOMİ uyandı. Komutunuzu söyleyin Orhan Bey")
                    }
                }
                WakeWordService.ACTION_COMMAND_RESULT -> {
                    val command = intent.getStringExtra(WakeWordService.EXTRA_COMMAND).orEmpty()
                    val message = intent.getStringExtra(WakeWordService.EXTRA_MESSAGE).orEmpty()
                    if (command.isNotBlank()) binding.heardText.text = "“$command”"
                    if (message.isNotBlank()) show(message)
                    state = State.IDLE
                }
                WakeWordService.ACTION_WAKE_STATE -> {
                    when (val value = intent.getStringExtra(WakeWordService.EXTRA_STATE).orEmpty()) {
                        "PREPARING" -> binding.wakeButton.text = "ŞAOMİ UYANDIRMA: HAZIRLANIYOR"
                        "ACTIVE" -> binding.wakeButton.text = "ŞAOMİ UYANDIRMA: AKTİF"
                        "PAUSED" -> binding.wakeButton.text = "ŞAOMİ UYANDIRMA: KOMUT DİNLENİYOR"
                        "TRIGGERED" -> binding.wakeButton.text = "ŞAOMİ UYANDI"
                        "COMMAND_LISTENING" -> binding.wakeButton.text = "ŞAOMİ: KOMUTU SÖYLEYİN"
                        "NO_MIC_PERMISSION" -> binding.wakeButton.text = "ŞAOMİ UYANDIRMA: MİKROFON İZNİ YOK"
                        else -> if (value.startsWith("ERROR:")) binding.wakeButton.text = "ŞAOMİ UYANDIRMA: HATA"
                    }
                }
            }
        }
    }
    private enum class State { IDLE, PREPARING, LISTENING, PROCESSING, SPEAKING }

    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) listenOnce()
        else show("Mikrofon izni verilmedi.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        commands = CommandEngine(this)
        val wakeFilter = IntentFilter().apply {
            addAction(WakeWordService.ACTION_WAKE_DETECTED)
            addAction(WakeWordService.ACTION_WAKE_STATE)
            addAction(WakeWordService.ACTION_COMMAND_RESULT)
        }
        ContextCompat.registerReceiver(this, wakeReceiver, wakeFilter, ContextCompat.RECEIVER_NOT_EXPORTED)
        wakeReceiverRegistered = true
        tts = TextToSpeech(this, this)

        vosk = VoskOfflineRecognizer(
            context = this,
            onReady = {
                state = State.IDLE
                binding.listenButton.isEnabled = true
                binding.wakeButton.isEnabled = true
                binding.wakeButton.text = "ŞAOMİ UYANDIRMA: HAZIRLANIYOR"
                show("Hazırım Orhan Bey")
                startWakeModeSilently()
            },
            onText = { heard -> handleHeard(heard) },
            onError = { message ->
                state = State.IDLE
                show(message)
            }
        )

        hybrid = HybridSpeechRecognizer(
            context = this,
            vosk = vosk,
            onListening = { message -> show(message) },
            onText = { heard -> handleHeard(heard) },
            onError = { message -> state = State.IDLE; show(message) }
        )

        binding.listenButton.isEnabled = false
        binding.wakeButton.isEnabled = false
        binding.wakeButton.text = "Türkçe ses sistemi hazırlanıyor"
        state = State.PREPARING
        vosk.prepare()

        binding.listenButton.setOnClickListener { requestListening() }
        binding.cameraButton.setOnClickListener { startActivity(Intent(MediaStore.ACTION_IMAGE_CAPTURE)) }
        binding.videoButton.setOnClickListener { startActivity(Intent(MediaStore.ACTION_VIDEO_CAPTURE)) }
        binding.accessibilityAccessButton.setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        binding.notificationAccessButton.visibility = android.view.View.VISIBLE
        binding.notificationAccessButton.setOnClickListener { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        binding.enrollVoiceButton.visibility = android.view.View.GONE
        binding.modelButton.visibility = android.view.View.VISIBLE
        binding.modelButton.text = "ARKA PLAN / PİL İZNİ"
        binding.modelButton.setOnClickListener { openBatterySettings() }
        binding.wakeButton.setOnClickListener { startWakeMode() }
        // Arka plan uyandırma WakeWordService tarafından yönetilir; burada ikinci dinleyici başlatılmaz.
    }

    private fun startWakeMode() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            permissions.launch(arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.READ_CONTACTS, Manifest.permission.CALL_PHONE))
            return
        }
        startWakeModeSilently()
        show("ŞAOMİ uyandırma aktif. ‘Şaomi’ diyebilirsiniz Orhan Bey")
    }

    private fun startWakeModeSilently() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED && state == State.IDLE) {
            runCatching { ContextCompat.startForegroundService(this, Intent(this, WakeWordService::class.java)) }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // WakeWordService zaten komut moduna geçtiği için burada ek dinleme başlatılmaz.
    }

    private fun requestListening() {
        if (state != State.IDLE) return
        val needed = arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.READ_CONTACTS, Manifest.permission.CALL_PHONE)
            .filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (needed.isEmpty()) listenOnce() else permissions.launch(needed.toTypedArray())
    }

    private fun listenOnce() {
        runCatching { startService(Intent(this, WakeWordService::class.java).setAction(WakeWordService.ACTION_PAUSE)) }
        state = State.LISTENING
        show("Dinliyorum Orhan Bey")
        binding.root.postDelayed({ hybrid.listenOnce() }, 450L)
    }

    private fun handleHeard(heard: String) {
        if (state != State.LISTENING) return
        binding.heardText.text = "“$heard”"
        val normalized = heard.trim().lowercase(Locale("tr", "TR"))
        val wakeOnly = setOf("şaomi", "şami", "xiaomi", "şayomi", "şaomi.", "şomi")
        if (normalized in wakeOnly) {
            state = State.IDLE
            show("Dinliyorum Orhan Bey")
            binding.root.postDelayed({ requestListening() }, 450L)
            return
        }
        state = State.PROCESSING
        val result = commands.execute(heard)
        speak(result.message)
    }

    private fun speak(message: String) {
        show(message)
        state = State.SPEAKING
        tts?.speak(message, TextToSpeech.QUEUE_FLUSH, null, "shaomi-answer")
        binding.root.postDelayed({ if (state == State.SPEAKING) { state = State.IDLE; resumeWakeService() } }, 2_200L)
    }

    private fun resumeWakeService() {
        runCatching { ContextCompat.startForegroundService(this, Intent(this, WakeWordService::class.java).setAction(WakeWordService.ACTION_RESUME)) }
    }

    private fun openBatterySettings() {
        runCatching {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = android.net.Uri.parse("package:$packageName")
            }
            startActivity(intent)
        }.onFailure {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName")))
        }
    }

    private fun show(message: String) { binding.statusText.text = message }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) tts?.language = Locale("tr", "TR")
    }

    override fun onDestroy() {
        if (wakeReceiverRegistered) {
            runCatching { unregisterReceiver(wakeReceiver) }
            wakeReceiverRegistered = false
        }
        hybrid.close()
        vosk.close()
        tts?.stop()
        tts?.shutdown()
        super.onDestroy()
    }
}
