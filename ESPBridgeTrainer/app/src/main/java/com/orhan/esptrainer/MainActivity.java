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
import java.util.List;

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
        scan.setOnClickListener(v -> scanCompatibleGames());
        pair.setOnClickListener(v -> {
            GameEndpoint g = (GameEndpoint) spinner.getSelectedItem();
            if (g == null) { status.setText("Önce uyumlu bir oyun bulun."); return; }
            status.setText("Eşleşti: " + g.label + "\nBridge: " + g.serviceName);
            List<EnemyPoint> demo = new ArrayList<>();
            demo.add(new EnemyPoint(35, 70, 78));
            demo.add(new EnemyPoint(-60, 20, 63));
            demo.add(new EnemyPoint(90, -40, 98));
            radar.setPoints(demo);
        });
        run.setOnClickListener(v -> log.setText("Log:\n" + ScriptEngine.run(editor.getText().toString(), this)));
    }

    private void scanCompatibleGames() {
        games.clear();
        PackageManager pm = getPackageManager();
        Intent query = new Intent("com.orhan.espbridge.DISCOVER");
        List<ResolveInfo> results = pm.queryIntentServices(query, PackageManager.MATCH_ALL);
        for (ResolveInfo ri : results) {
            String label = ri.loadLabel(pm).toString();
            games.add(new GameEndpoint(label, ri.serviceInfo.packageName, ri.serviceInfo.name));
        }
        adapter.notifyDataSetChanged();
        status.setText(games.isEmpty() ? "Uyumlu oyun bulunamadı. Oyuna ESP Bridge servisini ekle." : games.size() + " uyumlu oyun bulundu.");
    }

    @Override public void setRadar(boolean enabled) { radar.setRadarEnabled(enabled); }
    @Override public void setDistanceLabels(boolean enabled) { distanceLabels = enabled; }
    @Override public void setEnemyColor(String color) { enemyColor = color; }
    @Override public void setMaxDistance(float meters) { radar.setMaxDistance(meters); }
}
