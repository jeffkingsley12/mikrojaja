package com.airtel.voucher.model;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/**
 * Room entity representing a payment that has been parsed from SMS
 * but not yet successfully delivered to the backend.
 *
 * Persisted locally so payments survive app restarts and network outages.
 */
@Entity(
    tableName = "pending_payments",
    indices   = { @Index(value = "dedup_key", unique = true) }
)
public class PendingPayment {

    public static final String STATUS_PENDING   = "pending";
    public static final String STATUS_DELIVERED = "delivered";
    public static final String STATUS_FAILED    = "failed";

    @PrimaryKey(autoGenerate = true)
    public long id;

    /** SHA-256 of raw SMS or Airtel txnId — used for local dedup */
    @ColumnInfo(name = "dedup_key")
    @NonNull
    public String dedupKey = "";

    @ColumnInfo(name = "amount")
    public int amount;

    @ColumnInfo(name = "phone")
    @NonNull
    public String phone = "";

    @Nullable
    @ColumnInfo(name = "txn_id")
    public String txnId;

    @ColumnInfo(name = "raw_sms")
    @NonNull
    public String rawSms = "";

    @ColumnInfo(name = "status")
    @NonNull
    public String status = STATUS_PENDING;

    /** ISO-8601 timestamp when SMS was received */
    @ColumnInfo(name = "received_at")
    public long receivedAt;

    /** Number of delivery attempts so far */
    @ColumnInfo(name = "attempts")
    public int attempts = 0;

    @Nullable
    @ColumnInfo(name = "last_error")
    public String lastError;
}
