package com.airtel.voucher.network;

import android.util.Log;

import com.airtel.voucher.config.AppConfig;
import com.airtel.voucher.util.HmacUtil;

import org.json.JSONObject;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

/**
 * HTTP client for the voucher backend API.
 *
 * <p>Signs every payment request with HMAC-SHA256.
 * Thread-safe — OkHttpClient is safe to share across threads.
 */
public final class ApiService {

    private static final String TAG         = "ApiService";
    private static final MediaType JSON     = MediaType.get("application/json; charset=utf-8");

    /** Singleton OkHttpClient — reuses connection pool and thread pool */
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(AppConfig.CONNECT_TIMEOUT_SECS, TimeUnit.SECONDS)
        .readTimeout(AppConfig.READ_TIMEOUT_SECS,       TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)  // WorkManager handles retry logic
        .build();

    private ApiService() {}

    /**
     * Result of an API call — avoids exception-based control flow.
     */
    public static final class Result {
        public final boolean success;
        public final int     statusCode;
        public final String  body;
        public final boolean isDuplicate;

        private Result(boolean success, int statusCode, String body) {
            this.success     = success;
            this.statusCode  = statusCode;
            this.body        = body;
            // 409 = duplicate payment, which the server handled idempotently
            this.isDuplicate = (statusCode == 409 || statusCode == 201);
        }

        public static Result success(int code, String body)  { return new Result(true,  code, body); }
        public static Result failure(int code, String body)  { return new Result(false, code, body); }
        public static Result networkError(String msg)        { return new Result(false, 0,    msg);  }
    }

    /**
     * Submit a parsed payment to the backend.
     *
     * @param amount numeric amount string (e.g. "2000")
     * @param phone  normalized phone (e.g. "+256771234567")
     * @param rawSms original SMS body
     * @param txnId  nullable transaction ID
     * @return {@link Result} — never throws
     */
    public static Result submitPayment(String amount, String phone, String rawSms, String txnId) {
        long timestampSecs = System.currentTimeMillis() / 1000L;
        String signedPayload = HmacUtil.buildPayload(timestampSecs, amount, phone);
        String signature     = HmacUtil.compute(AppConfig.API_SECRET, signedPayload);

        if (signature == null) {
            Log.e(TAG, "HMAC signing failed — aborting request");
            return Result.networkError("HMAC signing failed");
        }

        JSONObject payload = new JSONObject();
        try {
            payload.put("amount", Integer.parseInt(amount));
            payload.put("phone",  phone);
            payload.put("raw_sms", rawSms);
            if (txnId != null) payload.put("txn_id", txnId);
        } catch (Exception e) {
            Log.e(TAG, "Payload build failed", e);
            return Result.networkError("Payload construction error: " + e.getMessage());
        }

        RequestBody body = RequestBody.create(payload.toString(), JSON);
        Request request = new Request.Builder()
            .url(AppConfig.PAYMENT_ENDPOINT)
            .post(body)
            .addHeader("X-Timestamp", String.valueOf(timestampSecs))
            .addHeader("X-Signature", signature)
            .addHeader("Accept",      "application/json")
            .build();

        try (Response response = HTTP_CLIENT.newCall(request).execute()) {
            ResponseBody responseBody = response.body();
            String responseStr = (responseBody != null) ? responseBody.string() : "";

            int code = response.code();
            Log.d(TAG, "API response: " + code + " " + responseStr);

            // 201 = created, 200 = already existed (returned idempotently)
            if (code == 201 || code == 200) {
                return Result.success(code, responseStr);
            }

            // 4xx client errors (bad amount, auth failure) — do NOT retry indefinitely
            if (code >= 400 && code < 500) {
                Log.w(TAG, "Client error " + code + " — check payload: " + responseStr);
                return Result.failure(code, responseStr);
            }

            // 5xx server errors — WorkManager will retry
            Log.e(TAG, "Server error " + code + ": " + responseStr);
            return Result.failure(code, responseStr);

        } catch (IOException e) {
            Log.e(TAG, "Network error: " + e.getMessage());
            return Result.networkError(e.getMessage());
        }
    }
}
