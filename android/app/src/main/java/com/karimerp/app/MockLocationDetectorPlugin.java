package com.karimerp.app;

import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * MockLocationDetector — L1-native anti-spoof layer for punch attendance.
 * ────────────────────────────────────────────────────────────────────────────
 * مبدأ v2: الرفض القاطع يحتاج دليلًا على القراءة نفسها، لا على تاريخ الجهاز.
 *   1) كاش آخر موقع معروف يُحتسب فقط إذا كان طازجًا (≤ LASTKNOWN_FRESH_MS) —
 *      كاش معلّم مزيف من أسابيع لا يتهم من لم يزوّف اليوم.
 *   2) فحص حي: استماع قصير لإصلاح GPS/Network فعلي وقراءة isMock() منه — دليل
 *      مرتبط بلحظة البصمة، ويتزامن مع جمع قراءات الموقع في الواجهة.
 *   3) اختيار تطبيق مزيف في خيارات المطور إشارة ضبط لا دليل تزييف — تُرجع
 *      منفصلة (mockAppSelected) للتسجيل الإداري بلا رفض. التزييف الفعلي بلا
 *      علامة mock يصطاده فحوص الفيزياء على السيرفر (تجميد/انتقال/واقعية).
 *
 * لا يرمي أبدًا — أي شك يرجع mocked:false. الحقول للتشخيص وسجل السيرفر:
 *   mocked          دليل تزييف على القراءة نفسها (رفض قاطع)
 *   mockAppSelected إشارة ضبط فقط (تُسجَّل ولا ترفض)
 *   source          none | lastKnown | live
 *   detail          مكن الآلة: lastKnown:GPS / live:network:clean / liveTimeout …
 *   ageS            عمر القراءة المستخدمة بالثواني (-1 = لا قراءة)
 */
@CapacitorPlugin(name = "MockLocationDetector")
public class MockLocationDetectorPlugin extends Plugin {

    /** كاش أقدم من ذلك لا يثبت شيئًا عن لحظة البصمة (حتى لو معلّم مزيف) */
    private static final long LASTKNOWN_FRESH_MS = 120_000L;
    /** نافذة الفحص الحي — داخل زمن جمع قراءات الموقع في الواجهة (~9 ث) */
    private static final long LIVE_WINDOW_MS = 6_500L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private LocationListener liveListener;
    private volatile boolean resolved;

    @PluginMethod
    @SuppressWarnings("deprecation") // requestSingleUpdate: بديلها (getCurrentLocation) API 30+ فقط
    public void isMockLocation(PluginCall call) {
        resolved = false;
        final JSObject ret = new JSObject();
        ret.put("mocked", false);
        ret.put("mockAppSelected", isMockAppSelected());
        ret.put("source", "none");
        ret.put("detail", "none");
        ret.put("ageS", -1);

        final LocationManager lm =
            (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);

        // 1) مسار سريع: الكاش الطازج فقط — الكاش القديم لا يتهم أحدًا
        boolean canListen = false;
        if (lm != null) {
            String[] providers = { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER };
            for (String provider : providers) {
                try {
                    Location loc = lm.getLastKnownLocation(provider);
                    if (loc == null) {continue;}
                    long ageS = (SystemClock.elapsedRealtimeNanos() - loc.getElapsedRealtimeNanos())
                        / 1_000_000_000L;
                    if (ageS > LASTKNOWN_FRESH_MS / 1000) {continue;}
                    if (isMock(loc)) {
                        ret.put("mocked", true);
                        ret.put("source", "lastKnown");
                        ret.put("detail", "lastKnown:" + provider);
                        ret.put("ageS", (int) Math.max(0, ageS));
                        resolveOnce(call, ret);
                        return;
                    }
                } catch (SecurityException ignored) {
                    // بلا إذن موقع أصلي — الفحص الحي لن يعمل أيضًا
                } catch (Exception ignored) {}
            }

            // 2) فحص حي: أول إصلاح فعلي خلال النافذة يحسم الإجابة بنفسه
            try {
                boolean gpsOn = lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
                boolean netOn = lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
                if (gpsOn || netOn) {
                    final LocationListener listener = new LocationListener() {
                        @Override
                        public void onLocationChanged(Location location) {
                            try {
                                long ageS = (SystemClock.elapsedRealtimeNanos()
                                    - location.getElapsedRealtimeNanos()) / 1_000_000_000L;
                                ret.put("ageS", (int) Math.max(0, ageS));
                                if (isMock(location)) {
                                    ret.put("mocked", true);
                                    ret.put("source", "live");
                                    ret.put("detail", "live:" + location.getProvider());
                                } else {
                                    ret.put("source", "live");
                                    ret.put("detail", "live:" + location.getProvider() + ":clean");
                                }
                            } catch (Exception ignored) {}
                            cleanup(lm);
                            resolveOnce(call, ret);
                        }
                        @Override public void onProviderDisabled(String p) {}
                        @Override public void onStatusChanged(String p, int s, Bundle e) {}
                    };
                    boolean any = false;
                    try {
                        if (gpsOn) {
                            lm.requestSingleUpdate(LocationManager.GPS_PROVIDER, listener, Looper.getMainLooper());
                            any = true;
                        }
                    } catch (Exception ignored) {}
                    try {
                        if (netOn) {
                            lm.requestSingleUpdate(LocationManager.NETWORK_PROVIDER, listener, Looper.getMainLooper());
                            any = true;
                        }
                    } catch (Exception ignored) {}
                    if (any) {
                        liveListener = listener;
                        canListen = true;
                    }
                }
            } catch (SecurityException se) {
                ret.put("detail", "noPermission");
                canListen = false;
            } catch (Exception ignored) {
                canListen = false;
            }
        }

        if (!canListen) {
            // لا إذن/لا مزود نشط — الحكم على الكاش الطازج فقط (لم يرفض أعلاه = نظيف أو غائب)
            resolveOnce(call, ret);
            return;
        }
        mainHandler.postDelayed(() -> {
            if (!resolved) {ret.put("detail", "liveTimeout");}
            if (lm != null) {cleanup(lm);}
            resolveOnce(call, ret);
        }, LIVE_WINDOW_MS);
    }

    private boolean isMock(Location loc) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                return loc.isMock();
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR2) {
                return loc.isFromMockProvider();
            }
        } catch (Exception ignored) {}
        return false;
    }

    /**
     * إشارة ضبط: هل يوجد تطبيق مُختار كمزيف مواقع؟ على أندرويد الحديث القيمة اسم
     * حزمة التطبيق المُختار، وعلى القديم "1" — كلاهما لا يعني أن البصمة الحالية مزيفة.
     */
    private boolean isMockAppSelected() {
        try {
            String v = Settings.Secure.getString(getContext().getContentResolver(), "mock_location");
            if (v == null) {return false;}
            String s = v.trim();
            return !(s.isEmpty() || "0".equals(s) || "false".equalsIgnoreCase(s)
                || "null".equalsIgnoreCase(s) || "none".equalsIgnoreCase(s));
        } catch (Exception ignored) {
            return false;
        }
    }

    private void cleanup(LocationManager lm) {
        LocationListener listener = liveListener;
        liveListener = null;
        if (listener != null) {
            try {lm.removeUpdates(listener);} catch (Exception ignored) {}
        }
        mainHandler.removeCallbacksAndMessages(null);
    }

    private void resolveOnce(PluginCall call, JSObject ret) {
        if (resolved) {return;}
        resolved = true;
        call.resolve(ret);
    }
}
