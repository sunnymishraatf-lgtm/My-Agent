package com.neutron.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Schedules the periodic background update check: an inexact alarm every
 * 12 hours (Doze-friendly, no exact-alarm permission needed). When it
 * fires, UpdateCheckReceiver checks GitHub releases and posts a system
 * notification if a newer build is out — so updates reach the user even
 * when the app hasn't been opened in a while.
 */
public class UpdateScheduler {

    private static final int REQ_CODE = 9001;
    private static final long INTERVAL_MS = 12L * 60 * 60 * 1000;
    private static final long FIRST_DELAY_MS = 6L * 60 * 60 * 1000;

    public static void schedule(Context ctx) {
        try {
            AlarmManager am =
                    (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            Intent i = new Intent(ctx, UpdateCheckReceiver.class);
            i.setAction(UpdateCheckReceiver.ACTION_CHECK);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pi =
                    PendingIntent.getBroadcast(ctx, REQ_CODE, i, flags);
            am.setInexactRepeating(AlarmManager.RTC,
                    System.currentTimeMillis() + FIRST_DELAY_MS,
                    INTERVAL_MS, pi);
        } catch (Exception ignored) {
            // Best effort: the in-app check on launch still works.
        }
    }
}
