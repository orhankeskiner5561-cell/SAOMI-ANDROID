package com.orhan.esptrainer;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Bundle;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends Activity implements ScriptEngine.Target {
    private final List<GameEndpoint> games = new ArrayList<>();
    private ArrayAdapter<GameEndpoint> adapter;
    private TextView status, log;
    private EditText editor, endpointInput, jsonInput;
    private RadarView radar;
    private Spinner gameSpinner, modeSpinner;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        status = findViewById(R.id.statusText);
        log = findViewById(R.id.logText);
        editor = findViewById(R.id.scriptEditor);
        endpointInput = findViewById(R.id.endpointInput);
        jsonInput = findViewById(R.id.jsonInput);
        radar = findViewById(R.id.radarView);
        gameSpinner = findViewById(R.id.gameSpinner);
        modeSpinner = findViewById(R.id.modeSpinner);

        Button scan = findViewById(R.id.scanButton);
        Button pair = findViewById(R.id.pairButton);
        Button run = findViewById(R.id.runButton);

        adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, games);
        gameSpinner.setAdapter(adapter);

        String[] modes = {"Otomatik", "ESP Bridge", "Local API", "Manuel JSON"};
        modeSpinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, modes));

        scan.setOnClickListener(v -> scanInstalledApps());
        pair.setOnClickListener(v -> connectSelected());
        run.setOnClickListener(v ->
                log.setText("Log:\n" + ScriptEngine.run(editor.getText().toString(), this))
        );
    }

    private void scanInstalledApps() {
        games.clear();
        PackageManager pm = getPackageManager();

        Map<String, ResolveInfo> bridges = new HashMap<>();
        Intent bridgeQuery = new Intent("com.orhan.espbridge.DISCOVER");
        List<ResolveInfo> bridgeResults = pm.queryIntentServices(bridgeQuery, PackageManager.MATCH_ALL);
        for (ResolveInfo ri : bridgeResults) {
            if (ri.serviceInfo != null) bridges.put(ri.serviceInfo.packageName, ri);
        }

        Intent launcher = new Intent(Intent.ACTION_MAIN);
        launcher.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> launchable = pm.queryIntentActivities(launcher, 0);

        for (ResolveInfo ri : launchable) {
            if (ri.activityInfo == null) continue;
            String pkg = ri.activityInfo.packageName;
            if (getPackageName().equals(pkg)) continue;

            String label = ri.loadLabel(pm).toString();
            ResolveInfo bridge = bridges.get(pkg);
            boolean compatible = bridge != null && bridge.serviceInfo != null;
            String serviceName = compatible ? bridge.serviceInfo.name : "";

            games.add(new GameEndpoint(label, pkg, serviceName, compatible));
        }

        adapter.notifyDataSetChanged();

        int bridgeCount = 0;
        for (GameEndpoint g : games) if (g.compatible) bridgeCount++;

        status.setText(games.size() + " uygulama bulundu.\n" +
                bridgeCount + " uygulamada ESP Bridge desteği var.\n" +
                "Bridge olmayan kendi oyunlarında Local API veya Manuel JSON modunu deneyebilirsin.");
    }

    private void connectSelected() {
        GameEndpoint g = (GameEndpoint) gameSpinner.getSelectedItem();
        if (g == null) {
            status.setText("Önce telefondaki oyunları tara.");
            return;
        }

        String mode = String.valueOf(modeSpinner.getSelectedItem());

        if ("Otomatik".equals(mode)) {
            if (g.compatible) connectBridge(g);
            else if (!endpointInput.getText().toString().trim().isEmpty()) fetchLocalApi(g);
            else if (!jsonInput.getText().toString().trim().isEmpty()) parseManualJson(g);
            else status.setText("Otomatik bağlantı yolu bulunamadı.\nLocal API adresi veya Manuel JSON verisi gir.");
            return;
        }

        if ("ESP Bridge".equals(mode)) {
            connectBridge(g);
        } else if ("Local API".equals(mode)) {
            fetchLocalApi(g);
        } else if ("Manuel JSON".equals(mode)) {
            parseManualJson(g);
        }
    }

    private void connectBridge(GameEndpoint g) {
        if (!g.compatible) {
            status.setText("Bu uygulamada ESP Bridge servisi yok.\n" +
                    "Paket: " + g.packageName + "\n" +
                    "Local API veya Manuel JSON modunu kullanabilirsin.");
            radar.setPoints(new ArrayList<>());
            return;
        }

        status.setText("ESP Bridge bulundu: " + g.label + "\n" + g.serviceName);
        // Canlı Binder/AIDL bağlantısı bir sonraki aşamada Bridge SDK ile tamamlanır.
        radar.setPoints(new ArrayList<>());
    }

    private void fetchLocalApi(GameEndpoint g) {
        String endpoint = endpointInput.getText().toString().trim();
        if (endpoint.isEmpty()) {
            status.setText("Local API adresi gir. Örnek: http://127.0.0.1:8765/enemies");
            return;
        }

        status.setText("Local API deneniyor: " + endpoint);

        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                URL url = new URL(endpoint);
                c = (HttpURLConnection) url.openConnection();
                c.setConnectTimeout(3000);
                c.setReadTimeout(3000);
                c.setRequestMethod("GET");

                BufferedReader br = new BufferedReader(new InputStreamReader(c.getInputStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) sb.append(line);

                List<EnemyPoint> points = parseEnemyJson(sb.toString());
                runOnUiThread(() -> {
                    radar.setPoints(points);
                    status.setText("Local API eşleşti: " + g.label + "\n" +
                            points.size() + " hedef radara alındı.");
                });
            } catch (Exception e) {
                String msg = e.getMessage();
                runOnUiThread(() -> status.setText("Local API bağlantısı başarısız.\n" +
                        (msg == null ? "Bilinmeyen hata" : msg)));
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    private void parseManualJson(GameEndpoint g) {
        String raw = jsonInput.getText().toString().trim();
        if (raw.isEmpty()) {
            status.setText("Manuel JSON alanına veri gir.");
            return;
        }

        try {
            List<EnemyPoint> points = parseEnemyJson(raw);
            radar.setPoints(points);
            status.setText("Manuel veri yüklendi: " + g.label + "\n" +
                    points.size() + " hedef radarda.");
        } catch (Exception e) {
            status.setText("JSON okunamadı: " + e.getMessage());
        }
    }

    private List<EnemyPoint> parseEnemyJson(String raw) throws Exception {
        JSONObject root = new JSONObject(raw);
        JSONArray arr = root.getJSONArray("enemies");
        List<EnemyPoint> points = new ArrayList<>();

        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            float x = (float) o.optDouble("x", 0);
            float z = (float) o.optDouble("z", 0);
            float d = (float) o.optDouble("distance", Math.sqrt(x*x + z*z));
            points.add(new EnemyPoint(x, z, d));
        }
        return points;
    }

    @Override public void setRadar(boolean enabled) { radar.setRadarEnabled(enabled); }
    @Override public void setDistanceLabels(boolean enabled) {}
    @Override public void setEnemyColor(String color) {}
    @Override public void setMaxDistance(float meters) { radar.setMaxDistance(meters); }
}
