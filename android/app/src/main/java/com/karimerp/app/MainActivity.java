package com.karimerp.app;

import android.annotation.SuppressLint;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Install AndroidX SplashScreen before super.onCreate
        SplashScreen.installSplashScreen(this);

        // L1-native anti-spoof: كشف التزييف الأصلي لبصمة الحضور (MockLocationDetector)
        try { registerPlugin(MockLocationDetectorPlugin.class); } catch (Exception ignored) {}

        super.onCreate(savedInstanceState);

        // Setup WebView optimizations and Back button handling
        setupWebView();
        setupBackButtonHandler();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        if (this.bridge == null) return;
        
        WebView webView = this.bridge.getWebView();
        if (webView == null) return;

        WebSettings settings = webView.getSettings();
        
        // Performance & Local Storage Optimizations
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        
        // Native feel scrolling
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        
        // Handle web loading errors with custom professional offline UI
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                
                // Show custom offline page only for main frame navigation failures
                if (request != null && request.isForMainFrame()) {
                    String failingUrl = request.getUrl() != null ? request.getUrl().toString() : "";
                    showOfflinePage(view, failingUrl);
                }
            }
        });
    }

    private void setupBackButtonHandler() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (bridge != null && bridge.getWebView() != null && bridge.getWebView().canGoBack()) {
                    bridge.getWebView().goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
    }

    private void showOfflinePage(WebView view, String targetUrl) {
        String retryAction = (targetUrl != null && !targetUrl.isEmpty())
                ? "window.location.href='" + targetUrl + "'"
                : "window.location.reload()";

        String offlineHtml = "<!DOCTYPE html>"
                + "<html dir='rtl' lang='ar'>"
                + "<head>"
                + "<meta charset='UTF-8'>"
                + "<meta name='viewport' content='width=device-width, initial-scale=1.0'>"
                + "<title>تعذر الاتصال</title>"
                + "<style>"
                + "  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; "
                + "         background-color: #0F172A; color: #F8FAFC; display: flex; flex-direction: column; "
                + "         align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 24px; text-align: center; box-sizing: border-box; }"
                + "  .card { background: #1E293B; border-radius: 16px; padding: 32px 24px; max-width: 360px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #334155; }"
                + "  .icon { font-size: 56px; margin-bottom: 16px; }"
                + "  h2 { margin: 0 0 12px 0; font-size: 22px; font-weight: 700; color: #FFFFFF; }"
                + "  p { margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #94A3B8; }"
                + "  button { background-color: #2563EB; color: #FFFFFF; border: none; padding: 14px 28px; font-size: 16px; font-weight: 600; border-radius: 10px; cursor: pointer; transition: background 0.2s; width: 100%; }"
                + "  button:active { background-color: #1D4ED8; }"
                + "</style>"
                + "</head>"
                + "<body>"
                + "  <div class='card'>"
                + "    <div class='icon'>📶</div>"
                + "    <h2>تعذر الاتصال بالخادم</h2>"
                + "    <p>يرجى التأكد من الاتصال بالإنترنت أو حالة خادم نظام Karim ERP وإعادة المحاولة.</p>"
                + "    <button onclick=\"" + retryAction + "\">إعادة المحاولة</button>"
                + "  </div>"
                + "</body>"
                + "</html>";

        view.loadDataWithBaseURL(null, offlineHtml, "text/html", "UTF-8", null);
    }
}
