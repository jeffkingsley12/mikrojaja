# ── OkHttp ────────────────────────────────────────────────────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase

# ── Room ──────────────────────────────────────────────────────────────────────
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
-keep @androidx.room.Dao class *
-dontwarn androidx.room.paging.**

# ── WorkManager ───────────────────────────────────────────────────────────────
-keep class * extends androidx.work.Worker
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}

# ── App classes (keep all public API) ────────────────────────────────────────
-keep class com.airtel.voucher.model.**     { *; }
-keep class com.airtel.voucher.receiver.**  { *; }
-keep class com.airtel.voucher.worker.**    { *; }
