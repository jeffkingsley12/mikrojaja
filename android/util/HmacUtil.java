package com.airtel.voucher.util;

import android.util.Log;

import java.nio.charset.StandardCharsets;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * HMAC-SHA256 utility for signing outbound API requests.
 *
 * <p>Mirrors the server-side signature verification in middleware/auth.js.
 * Signed payload format: "{timestamp}:{amount}:{phone}"
 */
public final class HmacUtil {

    private static final String TAG       = "HmacUtil";
    private static final String ALGORITHM = "HmacSHA256";

    private HmacUtil() {}

    /**
     * Compute HMAC-SHA256 of {@code data} using {@code secret}.
     *
     * @param secret UTF-8 secret key
     * @param data   data to sign
     * @return lowercase hex digest, or null on failure (should never happen in practice)
     */
    public static String compute(String secret, String data) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            SecretKeySpec keySpec = new SecretKeySpec(
                secret.getBytes(StandardCharsets.UTF_8),
                ALGORITHM
            );
            mac.init(keySpec);
            byte[] raw = mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
            return bytesToHex(raw);
        } catch (Exception e) {
            Log.e(TAG, "HMAC computation failed", e);
            return null;
        }
    }

    /**
     * Build the canonical signed payload for a payment request.
     * Must match the server expectation: "{timestamp}:{amount}:{phone}"
     */
    public static String buildPayload(long timestampSecs, String amount, String phone) {
        return timestampSecs + ":" + amount + ":" + phone;
    }

    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
