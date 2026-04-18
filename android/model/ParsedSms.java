package com.airtel.voucher.model;

/**
 * Value object representing a successfully parsed Airtel Money SMS.
 * Immutable — constructed once by SmsParser and passed through the pipeline.
 */
public final class ParsedSms {

    public final String amount;      // numeric string, e.g. "2000"
    public final String phone;       // normalized E.164, e.g. "+256771234567"
    public final String txnId;       // nullable — from Airtel transaction ID if present
    public final String rawSms;      // original body for dedup hash fallback

    public ParsedSms(String amount, String phone, String txnId, String rawSms) {
        this.amount = amount;
        this.phone  = phone;
        this.txnId  = txnId;
        this.rawSms = rawSms;
    }

    @Override
    public String toString() {
        return "ParsedSms{amount=" + amount + ", phone=" + phone
                + ", txnId=" + txnId + "}";
    }
}
