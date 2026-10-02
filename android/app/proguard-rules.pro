# ProGuard Rules for Karim ERP Capacitor Application

# Keep Capacitor Bridge & Plugin classes
-keep class com.getcapacitor.** { *; }
-keep class com.karimerp.app.** { *; }

# Preserve JavascriptInterfaces
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve Native Bridge annotations
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Keep Cordova plugins
-keep class org.apache.cordova.** { *; }

# Keep AndroidX SplashScreen
-keep class androidx.core.splashscreen.** { *; }

# Line numbers for debugging crash logs
-keepattributes SourceFile,LineNumberTable
