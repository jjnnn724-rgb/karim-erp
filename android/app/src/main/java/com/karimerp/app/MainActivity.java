package com.karimerp.app;

import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.os.Build;
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

        // النطق العربي الأصلي على الهاتف (ArabicTts) — صوت الجهاز بلا خدمة سحابية.
        try { registerPlugin(ArabicTtsPlugin.class); } catch (Exception ignored) {}

        super.onCreate(savedInstanceState);

        // ── قناة إشعارات الهاتف (FCM Push) — 2026-10-31 ──
        // نفس الاسم الذي يرسله الخادم في android.notification.channel_id
        // (backend/push-service.js: karim_requests). أهمية عالية + صوت افتراضي + اهتزاز.
        createPushChannel();

        // Setup WebView optimizations and Back button handling
        setupWebView();
        setupBackButtonHandler();
    }

    private void createPushChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel("karim_requests") != null) return;
        NotificationChannel channel = new NotificationChannel(
                "karim_requests",
                "إشعارات الطلبات",
                NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("طلبات الصرف والشراء والاعتمادات — صوت واهتزاز");
        channel.enableVibration(true);
        channel.setShowBadge(true);
        AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        channel.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI, attributes);
        nm.createNotificationChannel(channel);
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
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        
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
        String retryAction = "window.location.reload()";
        if (targetUrl != null && !targetUrl.isEmpty()) {
            // هروب مزدوج للسياق JS داخل HTML — لا حقن من رابط مُزوّر.
            String escaped = targetUrl.replace("\\", "\\\\").replace("'", "\\'").replace("<", "\\u003c");
            retryAction = "window.location.assign('" + escaped + "')";
        }

        String offlineHtml = "<!DOCTYPE html>"
                + "<html dir='rtl' lang='ar'>"
                + "<head>"
                + "<meta charset='UTF-8'>"
                + "<meta name='viewport' content='width=device-width, initial-scale=1.0, viewport-fit=cover'>"
                + "<meta name='color-scheme' content='dark'>"
                + "<title>Karim ERP — تعذر الاتصال</title>"
                + "<style>"
                + "  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;"
                + "         padding:24px; box-sizing:border-box; color:#eaf2f2; text-align:center;"
                + "         font-family:'IBM Plex Sans Arabic','Segoe UI',Tahoma,system-ui,sans-serif;"
                + "         background:radial-gradient(120% 90% at 50% 0%, #12757b 0%, transparent 55%),"
                + "                    radial-gradient(100% 80% at 50% 110%, #063a3f 0%, transparent 60%), #0b5a5f; }"
                + "  .card { max-width:360px; width:100%; }"
                + "  .logo { width:88px; height:88px; margin:0 auto 18px; border-radius:24px;"
                + "          background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.16);"
                + "          display:grid; place-items:center; font-size:40px; font-weight:700; color:#d4af37; }"
                + "  h2 { margin:0 0 10px; font-size:24px; font-weight:700; }"
                + "  .lat { color:#d4af37; font-family:system-ui,sans-serif; }"
                + "  p { margin:0 0 22px; font-size:14px; line-height:1.9; color:#a8c4c4; }"
                + "  button { width:100%; min-height:52px; border:0; cursor:pointer; font:inherit; font-weight:700; font-size:17px;"
                + "           color:#062e33; border-radius:14px; padding:15px 20px;"
                + "           background:linear-gradient(180deg,#ffd76a 0%,#d4af37 100%);"
                + "           box-shadow:0 10px 30px rgba(212,175,55,.35); }"
                + "  button:active { transform:scale(.97); filter:brightness(.92); }"
                + "  .hint { margin-top:18px; font-size:12px; color:#7fa7a9; line-height:1.9; }"
                + "</style>"
                + "</head>"
                + "<body>"
                + "  <div class='card'>"
                + "    <div class='logo'>K</div>"
                + "    <h2><span class='lat'>Karim ERP</span><br>تعذر الاتصال بالخادم</h2>"
                + "    <p>تأكد إن الجهاز متصل بشبكة الإنترنت أو شبكة المطعم، ثم اضغط «إعادة المحاولة».</p>"
                + "    <button onclick=\"" + retryAction + "\">🔄 إعادة المحاولة</button>"
                + "    <p class='hint'>لو استمرت المشكلة: تأكد إن التطبيق مش معلّق في الخلفية، قرّب من الواي فاي، ولو استمرت كلّم مسؤول النظام.</p>"
                + "  </div>"
                + "</body>"
                + "</html>";

        view.loadDataWithBaseURL(null, offlineHtml, "text/html", "UTF-8", null);
    }
}
