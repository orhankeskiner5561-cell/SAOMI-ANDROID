package com.saomi.tradeai;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;

import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Locale;

public class MainActivity extends Activity {
    private WebView webView;
    private static final String ASSET_BASE = "file:///android_asset/";
    private static final int REQ_VOICE = 6127;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(7,11,18));
        getWindow().setNavigationBarColor(Color.rgb(7,11,18));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(7,11,18));
        webView.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " SAOMITradeAI/6.12");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView,true);

        webView.addJavascriptInterface(new AndroidBridge(), "SaomiAndroid");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request){
                Uri u=request.getUrl();
                String scheme=u.getScheme();
                if("file".equalsIgnoreCase(scheme)||"https".equalsIgnoreCase(scheme)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW,u)); } catch(Exception ignored) {}
                return true;
            }
        });
        if(state!=null && webView.restoreState(state)!=null) return;
        loadInlineApp();
    }

    public final class AndroidBridge {
        @JavascriptInterface public void showKeyboard(){
            runOnUiThread(() -> {
                if(webView==null) return;
                webView.requestFocus();
                InputMethodManager imm=(InputMethodManager)getSystemService(Context.INPUT_METHOD_SERVICE);
                if(imm!=null) imm.showSoftInput(webView, InputMethodManager.SHOW_IMPLICIT);
            });
        }

        @JavascriptInterface public void startVoiceInput(){
            runOnUiThread(() -> launchVoice());
        }
    }

    private void launchVoice(){
        try{
            Intent i=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"tr-TR");
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE,"tr-TR");
            i.putExtra(RecognizerIntent.EXTRA_PROMPT,"Konuş");
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,3);
            startActivityForResult(i,REQ_VOICE);
            eval("window.saomiVoiceStatus&&window.saomiVoiceStatus('🎙 Konuş…')");
        }catch(Exception e){
            eval("window.saomiVoiceStatus&&window.saomiVoiceStatus('Ses tanıma uygulaması yok · Gboard mikrofonunu kullanın')");
            if(webView!=null){
                webView.requestFocus();
                InputMethodManager imm=(InputMethodManager)getSystemService(Context.INPUT_METHOD_SERVICE);
                if(imm!=null) imm.showSoftInput(webView,InputMethodManager.SHOW_IMPLICIT);
            }
        }
    }

    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode!=REQ_VOICE) return;
        if(resultCode==RESULT_OK && data!=null){
            ArrayList<String> rows=data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            String text=(rows!=null&&!rows.isEmpty())?rows.get(0):"";
            eval("window.saomiVoiceResult&&window.saomiVoiceResult("+jsQuote(text)+")");
        }else{
            eval("window.saomiVoiceStatus&&window.saomiVoiceStatus('Ses alınamadı · tekrar mikrofona dokunun')");
        }
    }

    private void eval(String js){
        if(webView==null) return;
        runOnUiThread(() -> { if(webView!=null) webView.evaluateJavascript(js,null); });
    }

    private static String jsQuote(String s){
        if(s==null) s="";
        StringBuilder b=new StringBuilder(s.length()+16).append('"');
        for(int i=0;i<s.length();i++){
            char c=s.charAt(i);
            switch(c){
                case '\\': b.append("\\\\"); break;
                case '"': b.append("\\\""); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default: if(c<32) b.append(String.format(Locale.US,"\\u%04x",(int)c)); else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    private void loadInlineApp(){
        try{
            StringBuilder html=new StringBuilder(360_000);
            for(int i=0;i<32;i++){
                String name=String.format(Locale.US,"part%02d.txt",i);
                try(InputStream in=getAssets().open(name); ByteArrayOutputStream out=new ByteArrayOutputStream()){
                    byte[] buf=new byte[8192]; int n;
                    while((n=in.read(buf))>0) out.write(buf,0,n);
                    html.append(out.toString(StandardCharsets.UTF_8.name()));
                }catch(FileNotFoundException missing){ if(i==0) throw missing; break; }
            }
            if(html.length()==0) throw new IllegalStateException("Inline uygulama boş");
            webView.loadDataWithBaseURL(ASSET_BASE,html.toString(),"text/html","UTF-8",null);
        }catch(Exception e){
            webView.loadUrl(ASSET_BASE+"master.html");
        }
    }

    @Override protected void onSaveInstanceState(Bundle out){ super.onSaveInstanceState(out); webView.saveState(out); }
    @Override public void onBackPressed(){ if(webView!=null && webView.canGoBack()) webView.goBack(); else super.onBackPressed(); }
    @Override protected void onDestroy(){ if(webView!=null){ webView.removeJavascriptInterface("SaomiAndroid"); webView.loadUrl("about:blank"); webView.stopLoading(); webView.destroy(); webView=null; } super.onDestroy(); }
}