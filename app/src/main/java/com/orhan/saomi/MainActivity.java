package com.orhan.saomi;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

public class MainActivity extends Activity {

    private static final String PROD_URL =
            "https://saomi-trade-ai.vercel.app/?app=android&build=rc5.60";
    private static final long RESUME_REFRESH_MS = 30_000L;

    private WebView webView;
    private TextView errorView;
    private long lastLoadAt = 0L;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(7, 16, 29));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(7, 16, 29));
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setLoadsImagesAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        // Eski APK/WebView arayüzü bir daha cihaz önbelleğinde takılı kalmasın.
        webView.clearCache(true);
        webView.clearHistory();

        errorView = new TextView(this);
        errorView.setTextColor(Color.WHITE);
        errorView.setBackgroundColor(Color.rgb(7, 16, 29));
        errorView.setTextSize(17f);
        errorView.setGravity(android.view.Gravity.CENTER);
        errorView.setPadding(32, 32, 32, 32);
        errorView.setVisibility(View.GONE);

        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        root.addView(errorView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("saomi-trade-ai.vercel.app".equalsIgnoreCase(uri.getHost())) {
                    return false;
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                lastLoadAt = SystemClock.elapsedRealtime();
                errorView.setVisibility(View.GONE);
                webView.setVisibility(View.VISIBLE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    webView.setVisibility(View.GONE);
                    errorView.setText("ŞAOMİ canlı arayüzüne bağlanılamadı.\nİnternet bağlantısını kontrol edip uygulamayı yeniden açın.");
                    errorView.setVisibility(View.VISIBLE);
                }
            }
        });

        loadFresh();
    }

    private void loadFresh() {
        errorView.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
        String url = PROD_URL + "&t=" + System.currentTimeMillis();
        webView.loadUrl(url);
        lastLoadAt = SystemClock.elapsedRealtime();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null && lastLoadAt > 0 &&
                SystemClock.elapsedRealtime() - lastLoadAt > RESUME_REFRESH_MS) {
            loadFresh();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
