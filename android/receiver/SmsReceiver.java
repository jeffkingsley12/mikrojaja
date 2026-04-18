package com.airtel.voucher.receiver;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;

import com.airtel.voucher.model.ParsedSms;
import com.airtel.voucher.parser.SmsParser;
import com.airtel.voucher.worker.PaymentWorker;

/**
 * BroadcastReceiver for incoming SMS messages.
 *
 * <h3>Critical constraints:</h3>
 * <ul>
 *   <li>Android gives the receiver a strict 10-second execution window.</li>
 *   <li>NO network calls here — all async work is delegated to {@link PaymentWorker}.</li>
 *   <li>Multi-part SMS (PDUs) are reassembled before parsing.</li>
 *   <li>Safe for concurrent delivery — WorkManager + Room DB handle deduplication.</li>
 * </ul>
 *
 * <h3>Manifest declaration required:</h3>
 * <pre>{@code
 * <receiver android:name=".receiver.SmsReceiver" android:exported="false">
 *   <intent-filter android:priority="999">
 *     <action android:name="android.provider.Telephony.SMS_RECEIVED"/>
 *   </intent-filter>
 * </receiver>
 * }</pre>
 *
 * <p>Note: {@code android.provider.Telephony.SMS_RECEIVED} is one of the few
 * implicit broadcasts still delivered to manifest-registered receivers on Android 8+.
 */
public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG    = "SmsReceiver";
    private static final String ACTION = "android.provider.Telephony.SMS_RECEIVED";

    @Override
    public void onReceive(Context context, Intent intent) {
        // Guard: ignore intents we didn't register for
        if (!ACTION.equals(intent.getAction())) return;

        Bundle bundle = intent.getExtras();
        if (bundle == null) return;

        Object[] pdus = (Object[]) bundle.get("pdus");
        if (pdus == null || pdus.length == 0) return;

        // "format" is required for SmsMessage.createFromPdu on API 23+
        String format = bundle.getString("format");

        // ── Reassemble multi-part SMS before parsing ──────────────────────────
        // PDUs from a single long SMS arrive in the same broadcast, ordered.
        // Concatenating them reconstructs the full message body.
        StringBuilder fullBody = new StringBuilder();
        String sender = null;

        try {
            for (Object pdu : pdus) {
                SmsMessage sms = createSmsMessage((byte[]) pdu, format);
                if (sms == null) continue;

                // Capture sender from the first segment only (all segments share the same sender)
                if (sender == null) {
                    sender = sms.getOriginatingAddress();
                }
                fullBody.append(sms.getMessageBody());
            }
        } catch (Exception e) {
            // Malformed PDU — log and discard; never crash the receiver
            Log.e(TAG, "PDU parse exception: " + e.getMessage());
            return;
        }

        if (sender == null || fullBody.length() == 0) return;

        String body = fullBody.toString();
        Log.d(TAG, "SMS received from " + sender + ": " + body.substring(0, Math.min(80, body.length())));

        // ── Parse — fast, synchronous, no I/O ────────────────────────────────
        ParsedSms parsed = SmsParser.parse(sender, body);
        if (parsed == null) {
            // Not an Airtel Money payment SMS — ignore silently
            return;
        }

        Log.i(TAG, "Airtel payment detected: " + parsed);

        // ── Delegate all async work to WorkManager ────────────────────────────
        // This returns immediately; the receiver's 10-second window is not consumed.
        PaymentWorker.enqueue(
            context.getApplicationContext(),
            parsed.amount,
            parsed.phone,
            parsed.rawSms,
            parsed.txnId
        );
    }

    /**
     * Creates an SmsMessage from a PDU, handling the API 23 format parameter.
     * Returns null on failure — callers must check.
     */
    private static SmsMessage createSmsMessage(byte[] pdu, String format) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && format != null) {
                return SmsMessage.createFromPdu(pdu, format);
            } else {
                return SmsMessage.createFromPdu(pdu);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to create SmsMessage from PDU: " + e.getMessage());
            return null;
        }
    }
}
