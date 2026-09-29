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

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends Activity implements ScriptEngine.Target {
    private final List<GameEndpoint> games = new ArrayList<>();
    private ArrayAdapter<GameEndpoint> adapter;
    private TextView status, log;
    private EditText editor;
    private RadarView radar;
    private boolean distanceLabels = true;
    private String enemyColor = "green";

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        status = findViewById(R.id.statusText);
        log = findViewById(R.id.logText);
        editor = findViewById(R.id.scriptEditor);
        radar = findViewById(R.id.radarView);

        Spinner spinner = findViewById(R.id.gameSpinner);
        Button scan = findViewById(R.id.scanButton);
        Button pair = findViewById(R.id.pairButton);
        Button run = findViewById(R.id.runButton);

        adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, games);
        spinner.setAdapter(adapter);

        scan.setOnClickListener(v -> scanInstalledApps());

        pair.setOnClickListener(v -> {
            GameEndpoint g = (GameEndpoint) spinner.getSelectedItem();

            if (g == null) {
                status.setText("Önce telefondaki oyunları tara.");
                return;
            }

            if (!g.compatible) {
                status.setText(
                    "Bu uygulama bulundu ama ESP Bridge desteği yok.\n" +
                    "Paket: " + g.packageName + "\n" +
                    "Kendi oyununa ESP Bridge SDK eklenince eşleşebilir."
                );
                radar.setPoints(new ArrayList<>());
                return;
            }

            status.setText(
                "Eşleşti: " + g.label + "\n" +
                "Paket: " + g.packageName + "\n" +
                "Bridge: " + g.serviceName
            );

            // Şimdilik bağlantı doğrulama görünümü.
            // Canlı koordinatlar, oyunun Bridge servisine bağlandıktan sonra buraya gelir.
            List<EnemyPoint> demo = new ArrayList<>();
            demo.add(new EnemyPoint(35, 70, 78));
            demo.add(new EnemyPoint(-60, 20, 63));
            demo.add(new EnemyPoint(90, -40, 98));
            radar.setPoints(demo);
        });

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
            if (ri.serviceInfo != null) {
                bridges.put(ri.serviceInfo.packageName, ri);
            }
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

        int compatibleCount = 0;
        for (GameEndpoint g : games) {
            if (g.compatible) compatibleCount++;
        }

        status.setText(
            games.size() + " uygulama bulundu.\n" +
            compatibleCount + " tanesinde ESP Bridge desteği var."
        );
    }

    @Override public void setRadar(boolean enabled) {
        radar.setRadarEnabled(enabled);
    }

    @Override public void setDistanceLabels(boolean enabled) {
        distanceLabels = enabled;
    }

    @Override public void setEnemyColor(String color) {
        enemyColor = color;
    }

    @Override public void setMaxDistance(float meters) {
        radar.setMaxDistance(meters);
    }
}
