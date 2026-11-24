package com.karimerp.app;

import android.media.AudioAttributes;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * ArabicTts — النطق العربي الأصلي على الهاتف.
 * ────────────────────────────────────────────────────────────────────────────
 * لماذا بلجن أصلي؟
 *   WebView على أندرويد لا يعرض أصواتًا: `speechSynthesis.getVoices()`
 *   يعيد قائمةً فارغة، فلا نطق ولا نبرة. المحرك الأصلي
 *   (android.speech.tts.TextToSpeech) هو ما يقدّم صوتًا عربيًا حقيقيًا
 *   على جهاز الموظف — صوت الجهاز نفسه، بلا خدمة سحابية ولا حساب ولا شبكة.
 *
 * «واقعي واحترافي»:
 *   · نختار أفضل صوتٍ عربي متاح: جودة عالية، ولهجة قريبة (مصر ← الخليج)،
 *     ويفضّل صوت الشبكة (أحدث بياناتِه) إن توفّر.
 *   · سرعة 0.95 (أوضح قليلًا في صخب المطبخ) ونبرة 1.0 (لا حدّة ولا رنين).
 *
 * لا يرمي أبدًا: كل نداءٍ يُرجع نتيجةً (نُطق / سببُ التعذّر). فاشلُ النطق
 * لا يوقف التطبيق، والإشعار يبقى مرئيًّا على الشاشة في كل الأحوال.
 *
 * الخصوصية: لا يخرج من الجهاز إلا النصّ المنطوق — ولا يُرسل أي شيء إلى
 * الخادم أو أي جهة. التوكن لا يمسّ هذا البلجن أصلًا.
 */
@CapacitorPlugin(name = "ArabicTts")
public class ArabicTtsPlugin extends Plugin {

    /** مهلة تجهيز المحرك: إن لم يجهز، صمتٌ بدل تعليقٍ بلا نهاية. */
    private static final long INIT_TIMEOUT_MS = 6000L;
    /** مهلة النطق: إن لم يُبلّغ المحرك بالنهاية، نُرجع «انتهى» بدل وعودٍ معلّق. */
    private static final long SPEAK_TIMEOUT_MS = 45_000L;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<PluginCall> pendingInit = new ArrayList<>();

    private TextToSpeech tts;
    private boolean initDone = false;
    private boolean initOk = false;
    private String initError = "";
    private Voice chosen = null;
    private String chosenName = "";
    private String chosenLang = "";
    private int seq = 0;

    /* ── التهيئة ─────────────────────────────────────────────────────── */

    private synchronized void ensureTts() {
        if (tts != null) {return;}
        try {
            tts = new TextToSpeech(getContext(), status -> {
                synchronized (ArabicTtsPlugin.this) {
                    initDone = true;
                    initOk = (status == TextToSpeech.SUCCESS);
                    if (initOk) {
                        configureVoice();
                    } else {
                        initError = "engine-init-failed";
                    }
                    flushPendingInit();
                }
            });
            tts.setOnUtteranceProgressListener(new TextToSpeech.OnUtteranceProgressListener() {
                @Override public void onStart(String utteranceId) { }
                @Override public void onDone(String utteranceId) { }
                @Override public void onError(String utteranceId) { }
                @Override public void onError(String utteranceId, int errorCode) { }
            });
        } catch (Throwable t) {
            initDone = true;
            initOk = false;
            initError = "engine-missing";
        }
    }

    /** ضبط اللغة وسِمة الصوت ثم اختيار أفضل صوتٍ عربي. */
    private void configureVoice() {
        try {
            tts.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
        } catch (Throwable ignored) { }

        // اللغة: مصر ← الخليج ← أيّ عربي
        Locale[] order = new Locale[] {
            new Locale("ar", "EG"), new Locale("ar", "SA"), new Locale("ar", "AE"), new Locale("ar")
        };
        for (Locale l : order) {
            try {
                int r = tts.isLanguageAvailable(l);
                if (r >= TextToSpeech.LANG_AVAILABLE) {
                    tts.setLanguage(l);
                    break;
                }
            } catch (Throwable ignored) { }
        }

        // الصوت: أفضل صوتٍ عربي متاح على الجهاز
        try {
            Set<Voice> voices = tts.getVoices();
            if (voices != null) {
                Voice best = null;
                int bestScore = Integer.MIN_VALUE;
                for (Voice v : voices) {
                    Locale loc = v.getLocale();
                    if (loc == null || !"ar".equalsIgnoreCase(loc.getLanguage())) {continue;}
                    int s = voiceScore(v);
                    if (s > bestScore) {bestScore = s; best = v;}
                }
                if (best != null) {
                    tts.setVoice(best);
                    chosen = best;
                    chosenName = String.valueOf(best.getName());
                    chosenLang = best.getLocale() == null ? "" : best.getLocale().toLanguageTag();
                }
            }
        } catch (Throwable ignored) { }
    }

    /** ترتيب الأصوات: الجودة أولًا، ثم قرب اللهجة، ثم صوت الشبكة (أحدث بيانات). */
    private int voiceScore(Voice v) {
        int score = 0;
        try {
            if (v.getQuality() >= Voice.QUALITY_HIGH) {score += 4;}
        } catch (Throwable ignored) { }
        Locale loc = v.getLocale();
        String country = loc == null ? "" : String.valueOf(loc.getCountry()).toUpperCase();
        if ("EG".equals(country)) {score += 3;}
        else if ("SA".equals(country) || "AE".equals(country)) {score += 2;}
        try {
            Set<String> features = v.getFeatures();
            if (features != null
                && features.contains(TextToSpeech.Engine.KEY_FEATURE_NETWORK_SYNTHESIS)) {score += 1;}
        } catch (Throwable ignored) { }
        return score;
    }

    /** يُفرَّغ النداءات التي انتظرت جاهزية المحرك. */
    private void flushPendingInit() {
        if (pendingInit.isEmpty()) {return;}
        List<PluginCall> waiting = new ArrayList<>(pendingInit);
        pendingInit.clear();
        for (PluginCall c : waiting) {
            if (initOk) {
                Float rateArg = c.getFloat("rate", 0.95f);
                Float pitchArg = c.getFloat("pitch", 1.0f);
                Boolean flushArg = c.getBoolean("flush", true);
                speakNow(c, String.valueOf(c.getString("text", "")),
                    (rateArg == null) ? 0.95f : rateArg,
                    (pitchArg == null) ? 1.0f : pitchArg,
                    (flushArg == null) || flushArg);
            } else {
                c.resolve(result(false, initError.isEmpty() ? "engine-unavailable" : initError));
            }
        }
    }

    /* ── الأفعال ─────────────────────────────────────────────────────── */

    /** حالة النطق على هذا الجهاز: جاهز؟ صوتٌ عربي؟ أيّ صوت؟ */
    @PluginMethod
    public void available(PluginCall call) {
        ensureTts();
        JSObject ret = new JSObject();
        if (!initDone) {
            ret.put("ready", false);
            ret.put("arabic", false);
            call.resolve(ret);
            return;
        }
        ret.put("ready", initOk);
        ret.put("arabic", initOk && chosen != null);
        ret.put("voice", chosenName);
        ret.put("lang", chosenLang);
        call.resolve(ret);
    }

    /** قائمة الأصوات العربية المتاحة (تشخيص وتفضيل). */
    @PluginMethod
    public void voices(PluginCall call) {
        ensureTts();
        JSArray list = new JSArray();
        try {
            Set<Voice> voices = (initOk && tts != null) ? tts.getVoices() : null;
            if (voices != null) {
                for (Voice v : voices) {
                    Locale loc = v.getLocale();
                    if (loc == null || !"ar".equalsIgnoreCase(loc.getLanguage())) {continue;}
                    JSObject o = new JSObject();
                    o.put("name", String.valueOf(v.getName()));
                    o.put("lang", loc.toLanguageTag());
                    o.put("quality", v.getQuality());
                    list.put(o);
                }
            }
        } catch (Throwable ignored) { }
        JSObject ret = new JSObject();
        ret.put("voices", list);
        call.resolve(ret);
    }

    /**
     * ينطق نصًّا. النتيجة: {spoken, reason?, voice?, lang?}
     * spoken = true يعني «تسلّمه المحرك» لا «سمعه أحد».
     */
    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.resolve(result(false, "empty-text"));
            return;
        }
        Float rateArg = call.getFloat("rate", 0.95f);
        Float pitchArg = call.getFloat("pitch", 1.0f);
        Boolean flushArg = call.getBoolean("flush", true);
        float rate = (rateArg == null) ? 0.95f : rateArg;
        float pitch = (pitchArg == null) ? 1.0f : pitchArg;
        boolean flush = (flushArg == null) || flushArg;
        ensureTts();
        if (initDone && !initOk) {
            call.resolve(result(false, initError.isEmpty() ? "engine-unavailable" : initError));
            return;
        }
        if (!initDone) {
            pendingInit.add(call);
            main.postDelayed(() -> {
                synchronized (ArabicTtsPlugin.this) {
                    if (pendingInit.remove(call)) {
                        call.resolve(result(false, "engine-timeout"));
                    }
                }
            }, INIT_TIMEOUT_MS);
            return;
        }
        speakNow(call, text, rate, pitch, flush);
    }

    private void speakNow(PluginCall call, String text, float rate, float pitch, boolean flush) {
        final AtomicBoolean resolved = new AtomicBoolean(false);
        final String id = "karim_" + System.currentTimeMillis() + "_" + (seq++);
        try {
            tts.setSpeechRate(clamp(rate, 0.5f, 2.0f));
            tts.setPitch(clamp(pitch, 0.5f, 2.0f));
            tts.setOnUtteranceProgressListener(new TextToSpeech.OnUtteranceProgressListener() {
                @Override public void onStart(String utteranceId) { }
                @Override public void onDone(String utteranceId) {
                    if (id.equals(utteranceId) && resolved.compareAndSet(false, true)) {
                        call.resolve(result(true, ""));
                    }
                }
                @Override public void onError(String utteranceId) {
                    if (id.equals(utteranceId) && resolved.compareAndSet(false, true)) {
                        call.resolve(result(false, "speak-error"));
                    }
                }
                @Override public void onError(String utteranceId, int errorCode) {
                    if (id.equals(utteranceId) && resolved.compareAndSet(false, true)) {
                        call.resolve(result(false, "speak-error"));
                    }
                }
            });
            int mode = flush ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD;
            int rc = tts.speak(text, mode, null, id);
            if (rc != TextToSpeech.SUCCESS) {
                if (resolved.compareAndSet(false, true)) {call.resolve(result(false, "speak-rejected"));}
                return;
            }
        } catch (Throwable t) {
            if (resolved.compareAndSet(false, true)) {call.resolve(result(false, "speak-failed"));}
            return;
        }
        /* شبكة أمان: بعض المحركات لا تُبلّغ بالنهاية (استُبدل النداء مثلًا). */
        main.postDelayed(() -> {
            if (resolved.compareAndSet(false, true)) {
                call.resolve(result(false, "speak-timeout"));
            }
        }, SPEAK_TIMEOUT_MS);
    }

    /** يوقف النطق الجاري فورًا (نداءٌ جديد يقطع القديم). */
    @PluginMethod
    public void stop(PluginCall call) {
        try { if (tts != null) {tts.stop();} } catch (Throwable ignored) { }
        JSObject ret = new JSObject();
        ret.put("stopped", true);
        call.resolve(ret);
    }

    /* ── أدوات ──────────────────────────────────────────────────────── */

    private JSObject result(boolean spoken, String reason) {
        JSObject ret = new JSObject();
        ret.put("spoken", spoken);
        if (reason != null && !reason.isEmpty()) {ret.put("reason", reason);}
        ret.put("voice", chosenName);
        ret.put("lang", chosenLang);
        return ret;
    }

    private float clamp(float v, float lo, float hi) {
        if (Float.isNaN(v) || Float.isInfinite(v)) {return (lo + hi) / 2f;}
        return Math.max(lo, Math.min(hi, v));
    }

    @Override
    protected void handleOnDestroy() {
        try { if (tts != null) {tts.stop(); tts.shutdown();} } catch (Throwable ignored) { }
        tts = null;
        super.handleOnDestroy();
    }
}
