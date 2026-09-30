package com.neutron.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * Fired by the periodic AlarmManager check (and nothing else). If GitHub
 * has a newer release than the installed build, posts a system
 * notification so the user hears about the update even without opening
 * the app. Tapping it opens the app straight into the update dialog.
 *
 * Notifies at most once per release tag.
 */
public class UpdateCheckReceiver extends BroadcastReceiver {

    public static final String ACTION_CHECK = "com.neutron.app.action.CHECK_UPDATES";

    private static final String PREFS = "neutron_update";
    private static final String KEY_NOTIFIED_TAG = "notified_tag";
    private static final int NOTIF_ID = 4201;
    private static final String CHANNEL_ID = "neutron_updates";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_CHECK.equals(intent.getAction())) return;
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try {
                UpdateManager.UpdateInfo info = UpdateManager.checkNow(context);
                if (info != null) {
                    SharedPreferences prefs =
                            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                    String notified = prefs.getString(KEY_NOTIFIED_TAG, "");
                    if (!info.tag.equals(notified)) {
                        postUpdateNotification(context, info);
                        prefs.edit().putString(KEY_NOTIFIED_TAG, info.tag).apply();
                    }
                }
            } catch (Exception ignored) {
            } finally {
                pr.finish();
            }
        }).start();
    }

    private void postUpdateNotification(Context ctx, UpdateManager.UpdateInfo info) {
        NotificationManager nm =
                (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "App updates", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Notifies you when a new NEUTRON version is released.");
            try { nm.createNotificationChannel(ch); } catch (Exception ignored) {}
        }

        Intent open = new Intent(ctx, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        open.putExtra("neutron_force_update_check", true);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, flags);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) b = new Notification.Builder(ctx, CHANNEL_ID);
        else b = new Notification.Builder(ctx);
        b.setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("NEUTRON " + info.tag + " is ready")
                .setContentText("Tap to download and install the update.")
                .setContentIntent(pi)
                .setAutoCancel(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC);
        try { nm.notify(NOTIF_ID, b.build()); } catch (Exception ignored) {}
    }
}
