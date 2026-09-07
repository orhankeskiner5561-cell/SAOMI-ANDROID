package com.orhan.saomi;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.os.BatteryManager;
import android.os.Bundle;
import android.os.Handler;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.widget.Button;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {

    private static final int REQ_AUDIO = 1001;

    private TextView status;
    private Button listenButton;
    private Switch continuousSwitch;

    private SpeechRecognizer recognizer;
    private Intent recognizerIntent;
    private TextToSpeech tts;
    private boolean listening = false;
    private boolean restarting = false;
    private final Handler handler = new Handler();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(com.orhan.saomi.R.layout.activity_main);

        status = findViewById(R.id.status);
        listenButton = findViewById(R.id.listenButton);
        continuousSwitch = findViewById(R.id.continuousSwitch);

        tts = new TextToSpeech(this, result -> {
            if (result == TextToSpeech.SUCCESS) {
                tts.setLanguage(new Locale("tr", "TR"));
                tts.setSpeechRate(1.0f);
            }
        });

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA}, REQ_AUDIO);
        }

        setupRecognizer();

        listenButton.setOnClickListener(v -> {
            if (listening) stopListening();
            else startListening();
        });

        continuousSwitch.setOnCheckedChangeListener((buttonView, isChecked) -> {
            if (isChecked) startListening();
            else stopListening();
        });
    }

    private void setupRecognizer() {
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            status.setText("Telefonda konuşma tanıma servisi bulunamadı.");
            return;
        }

        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {
                listening = true;
                listenButton.setText("DİNLİYOR...");
                status.setText("Dinliyorum...");
            }

            @Override public void onBeginningOfSpeech() {
                status.setText("Sizi duyuyorum...");
            }

            @Override public void onRmsChanged(float rmsdB) {}
            @Override public void onBufferReceived(byte[] buffer) {}

            @Override public void onEndOfSpeech() {
                status.setText("Anlıyorum...");
            }

            @Override public void onError(int error) {
                listening = false;
                listenButton.setText("DİNLE");
                status.setText("Dinleme yeniden hazırlanıyor...");
                restartIfNeeded();
            }

            @Override public void onResults(Bundle results) {
                listening = false;
                listenButton.setText("DİNLE");

                ArrayList<String> texts = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                String heard = (texts != null && !texts.isEmpty()) ? texts.get(0) : "";
                status.setText("Algılanan: " + heard);

                if (!heard.isEmpty()) {
                    handleCommand(heard);
                }
                restartIfNeeded();
            }

            @Override public void onPartialResults(Bundle partialResults) {
                ArrayList<String> texts = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                if (texts != null && !texts.isEmpty()) {
                    status.setText("Algılanan: " + texts.get(0));
                }
            }

            @Override public void onEvent(int eventType, Bundle params) {}
        });

        recognizerIntent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "tr-TR");
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "tr-TR");
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_ONLY_RETURN_LANGUAGE_PREFERENCE, "tr-TR");
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3);
        recognizerIntent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, false);
    }

    private void startListening() {
        if (recognizer == null) {
            setupRecognizer();
            if (recognizer == null) return;
        }

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
            return;
        }

        try {
            recognizer.cancel();
            recognizer.startListening(recognizerIntent);
        } catch (Exception e) {
            status.setText("Dinleme başlatılamadı: " + e.getMessage());
        }
    }

    private void stopListening() {
        listening = false;
        if (recognizer != null) {
            try { recognizer.cancel(); } catch (Exception ignored) {}
        }
        listenButton.setText("DİNLE");
        status.setText("Dinleme durduruldu.");
    }

    private void restartIfNeeded() {
        if (!continuousSwitch.isChecked() || restarting) return;
        restarting = true;
        handler.postDelayed(() -> {
            restarting = false;
            startListening();
        }, 450);
    }

    private String norm(String text) {
        String s = text.toLowerCase(new Locale("tr", "TR"))
                .replace('ı', 'i')
                .replace('ş', 's')
                .replace('ğ', 'g')
                .replace('ü', 'u')
                .replace('ö', 'o')
                .replace('ç', 'c');
        s = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        return s.trim();
    }

    private void handleCommand(String raw) {
        String c = norm(raw);

        // "Şaomi" uyandırma kelimesi söylenmişse kaldır.
        c = c.replaceFirst("^(saomi|xiaomi|şaomi)\\s*", "");

        if (c.contains("fener") && (c.contains("ac") || c.contains("yak"))) {
            setTorch(true);
            reply("Feneri açtım.");
            return;
        }

        if (c.contains("fener") && (c.contains("kapat") || c.contains("sondur"))) {
            setTorch(false);
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

        if ((c.contains("ses") || c.contains("sesi")) && c.matches(".*\\b\\d{1,3}\\b.*")) {
            int p = extractPercent(c);
            setMediaPercent(p);
            reply("Sesi yüzde " + p + " yaptım.");
            return;
        }

        if (c.contains("sesi ac") || c.equals("ses ac")) {
            setMediaPercent(100);
            reply("Sesi açtım.");
            return;
        }

        if (c.contains("sesi kis") || c.equals("ses kis")) {
            setMediaPercent(20);
            reply("Sesi kıstım.");
            return;
        }

        if (c.contains("sesi kapat") || c.equals("sessiz")) {
            setMediaPercent(0);
            reply("Sesi kapattım.");
            return;
        }

        if (c.contains("pil") || c.contains("sarj") || c.contains("batarya")) {
            BatteryManager bm = (BatteryManager) getSystemService(BATTERY_SERVICE);
            int pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            reply("Pil yüzde " + pct + ".");
            return;
        }

        if (c.endsWith(" ac")) {
            String appName = c.substring(0, c.length() - 3).trim();
            if (openAppByLabel(appName)) return;
        }

        reply("Bu komutu henüz tanımıyorum.");
    }

    private int extractPercent(String text) {
        String digits = text.replaceAll(".*?\\b(\\d{1,3})\\b.*", "$1");
        try {
            int p = Integer.parseInt(digits);
            return Math.max(0, Math.min(100, p));
        } catch (Exception e) {
            return 50;
        }
    }

    private void setMediaPercent(int percent) {
        AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
        int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int level = Math.round(max * (percent / 100f));
        am.setStreamVolume(AudioManager.STREAM_MUSIC, level, AudioManager.FLAG_SHOW_UI);
    }

    private void setTorch(boolean on) {
        CameraManager cm = (CameraManager) getSystemService(CAMERA_SERVICE);
        try {
            for (String id : cm.getCameraIdList()) {
                CameraCharacteristics cc = cm.getCameraCharacteristics(id);
                Boolean flash = cc.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                Integer facing = cc.get(CameraCharacteristics.LENS_FACING);
                if (Boolean.TRUE.equals(flash) &&
                        facing != null &&
                        facing == CameraCharacteristics.LENS_FACING_BACK) {
                    cm.setTorchMode(id, on);
                    return;
                }
            }
            Toast.makeText(this, "Fener bulunamadı.", Toast.LENGTH_SHORT).show();
        } catch (CameraAccessException | SecurityException e) {
            Toast.makeText(this, "Fener hatası: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void openPackage(String pkg, String label) {
        Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
        if (i != null) {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            reply(label + " açıldı.");
        } else {
            reply(label + " bulunamadı.");
        }
    }

    private boolean openAppByLabel(String spokenName) {
        PackageManager pm = getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN);
        launcher.addCategory(Intent.CATEGORY_LAUNCHER);

        List<ResolveInfo> apps = pm.queryIntentActivities(launcher, PackageManager.MATCH_ALL);
        String target = norm(spokenName);

        ResolveInfo best = null;
        int bestScore = 0;

        for (ResolveInfo ri : apps) {
            CharSequence labelCs = ri.loadLabel(pm);
            if (labelCs == null) continue;
            String label = norm(labelCs.toString());

            int score = similarityScore(target, label);
            if (score > bestScore) {
                bestScore = score;
                best = ri;
            }
        }

        if (best != null && bestScore >= 60) {
            Intent i = new Intent(Intent.ACTION_MAIN);
            i.addCategory(Intent.CATEGORY_LAUNCHER);
            i.setClassName(best.activityInfo.packageName, best.activityInfo.name);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            reply(best.loadLabel(pm) + " açıldı.");
            return true;
        }

        reply(spokenName + " uygulamasını bulamadım.");
        return false;
    }

    private int similarityScore(String a, String b) {
        if (a.equals(b)) return 100;
        if (b.contains(a) || a.contains(b)) return 85;

        String[] aa = a.split("\\s+");
        String[] bb = b.split("\\s+");
        int common = 0;
        for (String x : aa) {
            for (String y : bb) {
                if (x.equals(y) && !x.isEmpty()) common++;
            }
        }
        int denom = Math.max(aa.length, bb.length);
        if (denom == 0) return 0;
        return (common * 100) / denom;
    }

    private void reply(String text) {
        status.setText(text);
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
        if (tts != null) {
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "saomi_reply");
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (recognizer != null) {
            try { recognizer.destroy(); } catch (Exception ignored) {}
        }
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
    }
}
