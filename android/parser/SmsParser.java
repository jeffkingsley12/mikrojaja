package com.airtel.voucher.parser;

import android.util.Log;

import androidx.annotation.Nullable;

import com.airtel.voucher.model.ParsedSms;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses Airtel Money Uganda SMS messages into structured {@link ParsedSms} objects.
 *
 * <p>All patterns are compiled once as static constants — never inside a loop.
 *
 * <p>Handles known Airtel Uganda message variants:
 * <ul>
 *   <li>"You have received UGX 2,000 from 0771234567..."</li>
 *   <li>"Confirmed. You have received UGX2,000 from +256771234567..."</li>
 *   <li>"TID: AB123456 You have received UGX 2,000 from 077XXXXXXX"</li>
 * </ul>
 *
 * <p>Returns null on any parse failure — callers must handle null gracefully.
 */
public final class SmsParser {

    private static final String TAG = "SmsParser";

    // ── Sender filter ─────────────────────────────────────────────────────────
    private static final String AIRTEL_KEYWORD = "Airtel Money";

    // ── Amount: UGX followed by optional space, then digits with optional commas
    // Non-greedy match; no catastrophic backtracking risk.
    private static final Pattern AMOUNT_PATTERN = Pattern.compile(
        "UGX[\\s]?([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)"
    );

    // ── Phone: "from" followed by optional space, then E.164 or local Uganda number
    // Accepts +256XXXXXXXXX, 256XXXXXXXXX, 07XXXXXXXX, 03XXXXXXXX
    private static final Pattern PHONE_PATTERN = Pattern.compile(
        "from\\s([+]?(?:256)?[037][0-9]{8,9})"
    );

    // ── Transaction ID: various Airtel prefixes
    private static final Pattern TXN_PATTERN = Pattern.compile(
        "(?:TID|Ref|TransID|transaction\\s*ID)[:\\s]+([A-Z0-9]{6,20})",
        Pattern.CASE_INSENSITIVE
    );

    // Private constructor — utility class
    private SmsParser() {}

    /**
     * Attempt to parse an SMS body.
     *
     * @param sender  originating address from SmsMessage
     * @param body    full reassembled SMS body
     * @return {@link ParsedSms} on success, null if the message should be ignored
     */
    @Nullable
    public static ParsedSms parse(String sender, String body) {
        if (body == null || body.isEmpty()) return null;

        // Only process Airtel Money messages
        if (!body.contains(AIRTEL_KEYWORD)) return null;

        // ── Amount ────────────────────────────────────────────────────────────
        Matcher amountMatcher = AMOUNT_PATTERN.matcher(body);
        if (!amountMatcher.find()) {
            Log.w(TAG, "No amount found in Airtel SMS from " + sender);
            return null;
        }
        String rawAmount = amountMatcher.group(1);
        if (rawAmount == null) return null;
        String amount = rawAmount.replace(",", "").trim();

        // Sanity check: amount must be a positive integer within reasonable range
        int amountInt;
        try {
            amountInt = Integer.parseInt(amount);
        } catch (NumberFormatException e) {
            Log.w(TAG, "Amount parse failed: " + rawAmount);
            return null;
        }
        if (amountInt <= 0 || amountInt > 10_000_000) {
            Log.w(TAG, "Amount out of range: " + amountInt);
            return null;
        }

        // ── Phone ─────────────────────────────────────────────────────────────
        Matcher phoneMatcher = PHONE_PATTERN.matcher(body);
        String phone;
        if (phoneMatcher.find()) {
            phone = normalizePhone(phoneMatcher.group(1));
        } else {
            // Fall back to the SMS sender address (e.g. for automated push messages)
            phone = normalizePhone(sender);
        }

        if (phone == null) {
            Log.w(TAG, "Could not determine phone from SMS");
            return null;
        }

        // ── Transaction ID (optional) ─────────────────────────────────────────
        Matcher txnMatcher = TXN_PATTERN.matcher(body);
        String txnId = txnMatcher.find() ? txnMatcher.group(1) : null;

        Log.d(TAG, "Parsed: amount=" + amount + " phone=" + phone + " txnId=" + txnId);
        return new ParsedSms(amount, phone, txnId, body);
    }

    /**
     * Normalize a Ugandan phone number to E.164 (+256XXXXXXXXX).
     * Returns null if the input cannot be recognized as a valid local number.
     */
    @Nullable
    private static String normalizePhone(String raw) {
        if (raw == null) return null;
        String digits = raw.trim().replaceAll("[\\s\\-()]", "");

        if (digits.startsWith("+256") && digits.length() == 13) return digits;
        if (digits.startsWith("256")  && digits.length() == 12) return "+" + digits;
        if ((digits.startsWith("07") || digits.startsWith("03"))
                && digits.length() == 10) {
            return "+256" + digits.substring(1);
        }
        // Unknown format — return as-is if it looks phone-like
        if (digits.matches("[+\\d]{9,15}")) return digits;
        return null;
    }
}
