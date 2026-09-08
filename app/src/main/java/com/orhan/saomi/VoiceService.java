package com.orhan.saomi;

import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.hardware.camera2.*;
import android.media.AudioManager;
import android.os.*;
import android.speech.*;
import android.speech.tts.TextToSpeech;
import android.widget.Toast;

import java.text.Normalizer;
import java.util.*;

public class VoiceService extends Service {

    private static final String CHANNEL = "saomi_c5";
    private SpeechRecognizer recognizer;
    private Intent speechIntent;
    private TextToSpeech tts;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean running = true;
    private boolean restarting = false;
    private boolean awake = false;
    private long awakeUntil = 0L;

    @Override
    public void onCreate() {
        super.onCreate();

        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL, "ŞAOMİ C5",
                    NotificationManager.IMPORTANCE_LOW);
            getSystemService(NotificationManager.class)
                    .createNotificationChannel(ch);
        }

        Notification n = new Notification.Builder(this, CHANNEL)
                .setContentTitle("ŞAOMİ C5")
                .setContentText("Arka planda dinliyor")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setOngoing(true)
                .build();

        startForeground(2002, n);

        tts = new TextToSpeech(this, r -> {
            if (r == TextToSpeech.SUCCESS) {
                tts.setLanguage(new Locale("tr", "TR"));
            }
        });

        setupSpeech();
        handler.postDelayed(this::listen, 500);
    }

    private void setupSpeech() {
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);

        speechIntent = new Intent(
                RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        speechIntent.putExtra(
                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        speechIntent.putExtra(
                RecognizerIntent.EXTRA_LANGUAGE, "tr-TR");
        speechIntent.putExtra(
                RecognizerIntent.EXTRA_MAX_RESULTS, 3);

        recognizer.setRecognitionListener(
                new RecognitionListener() {

            public void onReadyForSpeech(Bundle b) {}
            public void onBeginningOfSpeech() {}
            public void onRmsChanged(float f) {}
            public void onBufferReceived(byte[] b) {}
            public void onEndOfSpeech() {}

            public void onError(int e) {
                restart();
            }

            public void onResults(Bundle b) {
                ArrayList<String> r =
                        b.getStringArrayList(
                                SpeechRecognizer.RESULTS_RECOGNITION);

                if (r != null && !r.isEmpty()) {
                    handle(r.get(0));
                }

                restart();
            }

            public void onPartialResults(Bundle b) {}
            public void onEvent(int i, Bundle b) {}
        });
    }

    private void listen() {
        if (!running || recognizer == null) return;

        try {
            recognizer.cancel();
            recognizer.startListening(speechIntent);
        } catch (Exception e) {
            restart();
        }
    }

    private void restart() {
        if (!running || restarting) return;

        restarting = true;

        handler.postDelayed(() -> {
            restarting = false;
            listen();
        }, 600);
    }

    private String norm(String text) {
        String s = text.toLowerCase(new Locale("tr", "TR"))
                .replace('ı','i')
                .replace('ş','s')
                .replace('ğ','g')
                .replace('ü','u')
                .replace('ö','o')
                .replace('ç','c');

        return Normalizer.normalize(s, Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "")
                .trim();
    }

    private void handle(String raw) {
        String c = norm(raw);

        boolean hasWakeWord =
                c.matches(".*\\b(saomi|xiaomi)\\b.*");

        if (!awake) {
            if (!hasWakeWord) return;

            c = c.replaceFirst(
                    "^.*?\\b(saomi|xiaomi)\\b\\s*",
                    ""
            ).trim();

            if (c.isEmpty()) {
                awake = true;
                awakeUntil =
                        System.currentTimeMillis() + 8000L;

                reply("Efendim Orhan Bey.");

                handler.postDelayed(() -> {
                    if (awake && System.currentTimeMillis() <= awakeUntil) {
                        listen();
                    }
                }, 700);

                return;
            }

            awake = true;
            awakeUntil =
                    System.currentTimeMillis() + 8000L;

        } else {

            if (System.currentTimeMillis() > awakeUntil) {
                awake = false;
                return;
            }

            c = c.replaceFirst(
                    "^.*?\\b(saomi|xiaomi)\\b\\s*",
                    ""
            ).trim();
        }

        awake = false;

        if (c.contains("fener") && c.contains("ac")) {
            torch(true);
            reply("Feneri açtım.");
            return;
        }

        if (c.contains("fener") && c.contains("kapat")) {
            torch(false);
            reply("Feneri kapattım.");
            return;
        }

        if (c.contains("whatsapp") && c.contains("ac")) {
            openPackage("com.whatsapp", "WhatsApp");
            return;
        }

        if (c.contains("youtube") && c.contains("ac")) {
            openPackage("com.google.android.youtube", "YouTube");
            return;
        }

        if (c.contains("chatgpt") && c.contains("ac")) {
            openPackage("com.openai.chatgpt", "ChatGPT");
            return;
        }

        if (c.contains("tradingview") && c.contains("ac")) {
            openPackage("com.tradingview.tradingviewapp", "TradingView");
            return;
        }

        if ((c.contains("ses") || c.contains("sesi"))
                && c.matches(".*\\b\\d{1,3}\\b.*")) {
            int p = percent(c);
            media(p);
            reply("Sesi yüzde " + p + " yaptım.");
            return;
        }

        if (c.contains("sesi ac") || c.equals("ses ac")) {
            media(100);
            reply("Sesi açtım.");
            return;
        }

        if (c.contains("sesi kis") || c.equals("ses kis")) {
            media(20);
            reply("Sesi kıstım.");
            return;
        }

        if (c.contains("sesi kapat") || c.equals("sessiz")) {
            media(0);
            reply("Sesi kapattım.");
            return;
        }

    }

    private void torch(boolean on) {
        try {
            CameraManager cm = (CameraManager) getSystemService(CAMERA_SERVICE);
            String id = cm.getCameraIdList()[0];
            cm.setTorchMode(id, on);
        } catch (Exception e) {
        }
    }

    private void media(int percent) {
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int vol = Math.round(max * Math.max(0, Math.min(100, percent)) / 100f);
            am.setStreamVolume(AudioManager.STREAM_MUSIC, vol, 0);
        } catch (Exception e) {
        }
    }

    private int percent(String text) {
        try {
            String n = text.replaceAll("[^0-9]", "");
            if (!n.isEmpty()) {
                return Math.max(0, Math.min(100, Integer.parseInt(n)));
            }
        } catch (Exception e) {
        }
        return 50;
    }

    private void openPackage(String pkg, String label) {
        try {
            PackageManager pm = getPackageManager();
            Intent i = pm.getLaunchIntentForPackage(pkg);

            if (i == null) {
                reply(label + " bulunamadı.");
                return;
            }

            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP);

            startActivity(i);
            reply(label + " açıldı.");

        } catch (Exception e) {
            reply(label + " açılamadı.");
        }
    }

    private void reply(String text) {
        Toast.makeText(
                this,
                text,
                Toast.LENGTH_SHORT
        ).show();

        if (tts != null) {
            tts.speak(
                    text,
                    TextToSpeech.QUEUE_FLUSH,
                    null,
                    "c5_reply"
            );
        }
    }

    @Override
    public int onStartCommand(
            Intent intent,
            int flags,
            int startId) {

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;

        if (recognizer != null) {
            try {
                recognizer.destroy();
            } catch (Exception ignored) {
            }
        }

        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }

        handler.removeCallbacksAndMessages(null);

        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
