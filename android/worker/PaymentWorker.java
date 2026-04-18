package com.airtel.voucher.worker;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.airtel.voucher.config.AppConfig;
import com.airtel.voucher.db.AppDatabase;
import com.airtel.voucher.db.PendingPaymentDao;
import com.airtel.voucher.model.PendingPayment;
import com.airtel.voucher.network.ApiService;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.TimeUnit;

/**
 * WorkManager worker that delivers a parsed payment to the backend API.
 *
 * <p>Lifecycle guarantees provided by WorkManager:
 * <ul>
 *   <li>Survives process death and device reboot (work is persisted to disk)</li>
 *   <li>Runs only when network is available</li>
 *   <li>Retries with exponential backoff on failure</li>
 *   <li>Idempotent — safe to run multiple times for the same payment</li>
 * </ul>
 *
 * <p>Input data keys match {@link #KEY_*} constants.
 */
public class PaymentWorker extends Worker {

    private static final String TAG = "PaymentWorker";

    // ── WorkManager input data keys ───────────────────────────────────────────
    public static final String KEY_PAYMENT_DB_ID = "payment_db_id";
    public static final String KEY_AMOUNT         = "amount";
    public static final String KEY_PHONE          = "phone";
    public static final String KEY_RAW_SMS        = "raw_sms";
    public static final String KEY_TXN_ID         = "txn_id";

    public PaymentWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        long   dbId   = getInputData().getLong(KEY_PAYMENT_DB_ID, -1L);
        String amount = getInputData().getString(KEY_AMOUNT);
        String phone  = getInputData().getString(KEY_PHONE);
        String rawSms = getInputData().getString(KEY_RAW_SMS);
        String txnId  = getInputData().getString(KEY_TXN_ID); // may be null

        if (dbId == -1 || amount == null || phone == null || rawSms == null) {
            Log.e(TAG, "Missing required input data — aborting");
            return Result.failure();
        }

        PendingPaymentDao dao = AppDatabase.getInstance(getApplicationContext())
            .pendingPaymentDao();

        // ── Check max attempts ────────────────────────────────────────────────
        // getRunAttemptCount() is 0-based on first attempt
        if (getRunAttemptCount() >= AppConfig.MAX_ATTEMPTS) {
            Log.e(TAG, "Max attempts reached for payment " + dbId);
            dao.markFailed(dbId, "Max retry attempts exceeded");
            return Result.failure();
        }

        // ── Deliver to backend ────────────────────────────────────────────────
        Log.d(TAG, "Delivering payment dbId=" + dbId + " attempt=" + getRunAttemptCount());
        ApiService.Result apiResult = ApiService.submitPayment(amount, phone, rawSms, txnId);

        if (apiResult.success || apiResult.isDuplicate) {
            // Success or idempotent duplicate — either way, payment is handled
            dao.markDelivered(dbId);
            Log.i(TAG, "Payment delivered: dbId=" + dbId + " status=" + apiResult.statusCode);
            return Result.success();
        }

        // ── Determine retry strategy ──────────────────────────────────────────
        String error = "HTTP " + apiResult.statusCode + ": " + apiResult.body;
        dao.incrementAttempts(dbId, error);

        // 4xx = client error (bad data) — retrying will not help
        if (apiResult.statusCode >= 400 && apiResult.statusCode < 500) {
            Log.e(TAG, "Client error — not retrying: " + error);
            dao.markFailed(dbId, error);
            return Result.failure();
        }

        // 5xx or network error — retry with exponential backoff
        Log.w(TAG, "Transient error — will retry: " + error);
        return Result.retry();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Static factory: enqueue a payment delivery job
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Persist a payment locally and enqueue a WorkManager delivery job.
     *
     * <p>This is the single entry point called from {@link com.airtel.voucher.receiver.SmsReceiver}.
     *
     * @param context application context
     * @param amount  parsed amount string
     * @param phone   normalized phone
     * @param rawSms  original SMS body
     * @param txnId   nullable transaction ID
     */
    public static void enqueue(
        Context context,
        String amount,
        String phone,
        String rawSms,
        String txnId
    ) {
        // ── Persist to Room DB first (survives crashes before job runs) ───────
        String dedupKey = txnId != null ? txnId : sha256(rawSms.trim().toLowerCase());

        PendingPayment record = new PendingPayment();
        record.dedupKey   = dedupKey;
        record.amount     = Integer.parseInt(amount);
        record.phone      = phone;
        record.txnId      = txnId;
        record.rawSms     = rawSms;
        record.receivedAt = System.currentTimeMillis();
        record.status     = PendingPayment.STATUS_PENDING;

        PendingPaymentDao dao = AppDatabase.getInstance(context).pendingPaymentDao();
        long rowId = dao.insert(record); // IGNORE on conflict — idempotent

        if (rowId == -1L) {
            // Duplicate — already in local DB; WorkManager job may already be queued
            Log.d(TAG, "Duplicate SMS in local DB (dedup_key=" + dedupKey + ") — skipping enqueue");
            return;
        }

        // ── Build WorkManager job ─────────────────────────────────────────────
        Data inputData = new Data.Builder()
            .putLong(KEY_PAYMENT_DB_ID, rowId)
            .putString(KEY_AMOUNT,  amount)
            .putString(KEY_PHONE,   phone)
            .putString(KEY_RAW_SMS, rawSms)
            .putString(KEY_TXN_ID,  txnId)  // null is handled by WorkManager
            .build();

        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();

        OneTimeWorkRequest workRequest = new OneTimeWorkRequest.Builder(PaymentWorker.class)
            .setInputData(inputData)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, AppConfig.BACKOFF_SECS, TimeUnit.SECONDS)
            .addTag("payment")
            .addTag("dedup:" + dedupKey)
            .build();

        WorkManager.getInstance(context).enqueue(workRequest);
        Log.i(TAG, "WorkManager job enqueued for payment dbId=" + rowId);
    }

    // ─────────────────────────────────────────────────────────────────────────

    /** SHA-256 of input string as hex — used for SMS dedup key fallback. */
    private static String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : hash) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is guaranteed to be available on Android
            throw new RuntimeException("SHA-256 not available", e);
        }
    }
}
