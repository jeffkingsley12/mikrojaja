package com.airtel.voucher.db;

import android.content.Context;

import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

import com.airtel.voucher.model.PendingPayment;

@Database(
    entities  = { PendingPayment.class },
    version   = 1,
    exportSchema = false
)
public abstract class AppDatabase extends RoomDatabase {

    private static volatile AppDatabase INSTANCE;

    public abstract PendingPaymentDao pendingPaymentDao();

    public static AppDatabase getInstance(Context context) {
        if (INSTANCE == null) {
            synchronized (AppDatabase.class) {
                if (INSTANCE == null) {
                    INSTANCE = Room.databaseBuilder(
                            context.getApplicationContext(),
                            AppDatabase.class,
                            "voucher_gateway.db"
                        )
                        .fallbackToDestructiveMigration() // dev only; use proper migrations in production
                        .build();
                }
            }
        }
        return INSTANCE;
    }
}
