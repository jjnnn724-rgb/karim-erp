package com.karimerp.app;

import android.content.Context;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * MockLocationDetector — L1-native anti-spoof layer for punch attendance.
 * ────────────────────────────────────────────────────────────────────────────
 * UPGRADE 2026-10-01: المتصفح لا يستطيع قراءة علامة التزييف — هذا الفحص الأصلي
 * يقرأها مباشرة (best-effort — لا يرمي أبدًا):
 *   1) آخر موقع معروف (GPS/Network): Location.isFromMockProvider (API 18+)
 *      أو مفتاح mockLocation في extras (API 31+).
 *   2) ضبط النظام: هل يوجد تطبيق تزييف مختار كموفر وهمي.
 * أي إيجابية → mocked=true. السلبية ليست إثبات صدق — فحوص الفيزياء على
 * السيرفر (geolib + realism + teleport) تبقى الحَكَم النهائي.
 */
@CapacitorPlugin(name = "MockLocationDetector")
public class MockLocationDetectorPlugin extends Plugin {

    @PluginMethod
    public void isMockLocation(PluginCall call) {
        boolean mocked = false;
        String detail = "none";
        try {
            Context ctx = getContext();
            LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            if (lm != null) {
                String[] providers = new String[]{ LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER };
                for (String provider : providers) {
                    try {
                        Location loc = lm.getLastKnownLocation(provider);
                        if (loc != null && isMock(loc)) {
                            mocked = true;
                            detail = "lastKnown:" + provider;
                            break;
                        }
                    } catch (SecurityException ignored) {
                        // بلا إذن موقع أصلي — نسقط لفحص ضبط النظام أدناه
                    }
                }
            }
            if (!mocked) {
                String mockApp = null;
                try {
                    mockApp = Settings.Secure.getString(ctx.getContentResolver(), "mock_location");
                } catch (Exception ignored) {}
                if (mockApp != null && !mockApp.isEmpty() && !"null".equalsIgnoreCase(mockApp) 
                        && !"0".equals(mockApp) && !"false".equalsIgnoreCase(mockApp)) {
                    mocked = true;
                    detail = "mockAppSelected";
                }
            }
        } catch (Exception ignored) {}
        JSObject ret = new JSObject();
        ret.put("mocked", mocked);
        ret.put("detail", detail);
        call.resolve(ret);
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
}
