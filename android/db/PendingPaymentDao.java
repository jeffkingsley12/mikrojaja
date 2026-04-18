package com.airtel.voucher.db;

import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;

import com.airtel.voucher.model.PendingPayment;

import java.util.List;

@Dao
public interface PendingPaymentDao {

    /**
     * Insert a new payment record.
     * IGNORE on conflict means duplicate SMS (same dedup_key) is silently skipped.
     * Returns the rowId, or -1 if ignored.
     */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    long insert(PendingPayment payment);

    /**
     * All payments not yet successfully delivered, ordered oldest-first
     * so we always retry the earliest payments first.
     */
    @Query("SELECT * FROM pending_payments WHERE status != 'delivered' ORDER BY received_at ASC")
    List<PendingPayment> getPending();

    @Query("UPDATE pending_payments SET status = 'delivered', attempts = attempts + 1 WHERE id = :id")
    void markDelivered(long id);

    @Query("UPDATE pending_payments SET attempts = attempts + 1, last_error = :error WHERE id = :id")
    void incrementAttempts(long id, String error);

    @Query("UPDATE pending_payments SET status = 'failed', last_error = :error WHERE id = :id")
    void markFailed(long id, String error);

    /** Cleanup: remove delivered records older than 7 days */
    @Query("DELETE FROM pending_payments WHERE status = 'delivered' AND received_at < :cutoff")
    void pruneDelivered(long cutoff);
}
