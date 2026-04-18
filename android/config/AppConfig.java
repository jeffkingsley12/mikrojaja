package com.airtel.voucher.config;

/**
 * Central application configuration.
 *
 * In a real build:
 *  - API_BASE_URL and API_SECRET come from BuildConfig (set in local.properties + build.gradle)
 *  - Secrets are NEVER committed to source control
 *
 * build.gradle example:
 *   buildConfigField "String", "API_BASE_URL", "\"${project.properties['API_BASE_URL']}\""
 *   buildConfigField "String", "API_SECRET",   "\"${project.properties['API_SECRET']}\""
 */
public final class AppConfig {

    private AppConfig() {}

    // ── Backend ───────────────────────────────────────────────────────────────
    /** Base URL of your backend server. NO trailing slash. */
    public static final String API_BASE_URL = BuildConfig.API_BASE_URL;

    /** Shared HMAC secret — must match API_SECRET in backend .env */
    public static final String API_SECRET   = BuildConfig.API_SECRET;

    /** Payment submission endpoint */
    public static final String PAYMENT_ENDPOINT = API_BASE_URL + "/api/payment/airtel";

    // ── WorkManager ───────────────────────────────────────────────────────────
    /** Initial backoff for failed delivery attempts (seconds) */
    public static final long BACKOFF_SECS = 30L;

    /** Maximum delivery attempts before marking as permanently failed */
    public static final int MAX_ATTEMPTS = 10;

    // ── HTTP ──────────────────────────────────────────────────────────────────
    public static final int CONNECT_TIMEOUT_SECS = 15;
    public static final int READ_TIMEOUT_SECS    = 20;

    // ── Local DB pruning ──────────────────────────────────────────────────────
    /** Keep delivered records for 7 days before pruning */
    public static final long PRUNE_DELIVERED_AFTER_MS = 7L * 24 * 60 * 60 * 1000;
}
