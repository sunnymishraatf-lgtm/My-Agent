package com.neutron.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps NEUTRON music playing when the app is in the background or the
 * screen is off: holds a wake lock + wifi lock, shows a media notification
 * with play/pause/next/stop, and exposes lock-screen controls via
 * MediaSession. The audio itself stays in the WebView's YouTube player;
 * this service only keeps the process alive and relays controls.
 *
 * Honest limit: if the user swipes the app away from recents, the activity
 * (and its WebView) is destroyed and playback stops — Android gives no
 * supported way to keep an activity WebView alive without its activity.
 */
public class MusicService extends Service {

    /** Broadcast the service sends when a notification button is tapped. */
    public static final String ACTION_CMD = "com.neutron.app.MUSIC_CMD";
    public static final String EXTRA_CMD = "cmd";
    public static final String CMD_TOGGLE = "toggle";
    public static final String CMD_NEXT = "next";
    public static final String CMD_STOP = "stop";

    private static final String ACTION_UPDATE = "com.neutron.app.music.UPDATE";
    private static final int NOTIF_ID = 4101;
    private static final String CHANNEL_ID = "neutron_music";

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private MediaSession mediaSession;
    private NotificationManager notifManager;

    private String currentTitle = "NEUTRON Music";
    private boolean playing = false;
    private boolean foreground = false;

    /** Called from the WebView bridge when playback starts or the track changes. */
    public static void update(Context ctx, String title, boolean isPlaying) {
        Intent i = new Intent(ctx, MusicService.class);
        i.setAction(ACTION_UPDATE);
        if (title != null) i.putExtra("title", title);
        i.putExtra("playing", isPlaying);
        startSvc(ctx, i);
    }

    /** Called from the WebView bridge when playback is stopped entirely. */
    public static void stop(Context ctx) {
        Intent i = new Intent(ctx, MusicService.class);
        i.setAction(CMD_STOP);
        startSvc(ctx, i);
    }

    private static void startSvc(Context ctx, Intent i) {
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i);
            else ctx.startService(i);
        } catch (Exception e) {
            // Background-start restrictions etc.: best effort, never crash the app.
            try { ctx.startService(i); } catch (Exception ignored) {}
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        notifManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        ensureChannel();

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "NEUTRON:music");
        wakeLock.setReferenceCounted(false);
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "NEUTRON:music");
        wifiLock.setReferenceCounted(false);

        mediaSession = new MediaSession(this, "NEUTRONMusic");
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { sendCmd(CMD_TOGGLE); }
            @Override public void onPause() { sendCmd(CMD_TOGGLE); }
            @Override public void onSkipToNext() { sendCmd(CMD_NEXT); }
            @Override public void onStop() { sendCmd(CMD_STOP); }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (CMD_STOP.equals(action)) {
                sendCmd(CMD_STOP);
                shutdown();
                return START_NOT_STICKY;
            }
            if (CMD_TOGGLE.equals(action)) {
                sendCmd(CMD_TOGGLE);
                return START_STICKY;
            }
            if (CMD_NEXT.equals(action)) {
                sendCmd(CMD_NEXT);
                return START_STICKY;
            }
            if (ACTION_UPDATE.equals(action)) {
                String t = intent.getStringExtra("title");
                if (t != null && !t.isEmpty()) currentTitle = t;
                playing = intent.getBooleanExtra("playing", true);
                goForeground();
                return START_STICKY;
            }
        }
        return START_STICKY;
    }

    private void goForeground() {
        if (!wakeLock.isHeld()) {
            try { wakeLock.acquire(12 * 60 * 60 * 1000L); } catch (Exception ignored) {}
        }
        if (!wifiLock.isHeld()) {
            try { wifiLock.acquire(); } catch (Exception ignored) {}
        }
        updateSession();
        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIF_ID, n);
            }
            foreground = true;
        } catch (Exception e) {
            // Couldn't go foreground (background-start restriction): keep the
            // locks so audio survives as long as possible, best effort.
            try { notifManager.notify(NOTIF_ID, n); } catch (Exception ignored) {}
        }
    }

    private void updateSession() {
        if (mediaSession == null) return;
        try {
            MediaMetadata md = new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, "NEUTRON Music")
                    .build();
            mediaSession.setMetadata(md);
            PlaybackState ps = new PlaybackState.Builder()
                    .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                            | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_STOP)
                    .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                            PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
                    .build();
            mediaSession.setPlaybackState(ps);
        } catch (Exception ignored) {}
    }

    private void sendCmd(String cmd) {
        Intent i = new Intent(ACTION_CMD);
        i.putExtra(EXTRA_CMD, cmd);
        i.setPackage(getPackageName());
        try { sendBroadcast(i); } catch (Exception ignored) {}
    }

    private void shutdown() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {}
        try {
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (Exception ignored) {}
        try {
            if (mediaSession != null) { mediaSession.setActive(false); mediaSession.release(); }
        } catch (Exception ignored) {}
        mediaSession = null;
        try { notifManager.cancel(NOTIF_ID); } catch (Exception ignored) {}
        if (foreground) {
            try { stopForeground(true); } catch (Exception ignored) {}
            foreground = false;
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID, "Music playback", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shows what's playing and offers playback controls.");
            try { notifManager.createNotificationChannel(ch); } catch (Exception ignored) {}
        }
    }

    private PendingIntent actionIntent(String cmd) {
        Intent i = new Intent(this, MusicService.class);
        i.setAction(cmd);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getService(this, cmd.hashCode(), i, flags);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setAction(Intent.ACTION_MAIN);
        open.addCategory(Intent.CATEGORY_LAUNCHER);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent content = PendingIntent.getActivity(this, 0, open, flags);

        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) b = new Notification.Builder(this, CHANNEL_ID);
        else b = new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(currentTitle)
                .setContentText(playing ? "Playing in NEUTRON" : "Paused")
                .setContentIntent(content)
                .setOngoing(playing)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(new Notification.Action.Builder(
                        playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "Pause" : "Play",
                        actionIntent(CMD_TOGGLE)).build())
                .addAction(new Notification.Action.Builder(
                        android.R.drawable.ic_media_next, "Next",
                        actionIntent(CMD_NEXT)).build())
                .addAction(new Notification.Action.Builder(
                        android.R.drawable.ic_menu_close_clear_cancel, "Stop",
                        actionIntent(CMD_STOP)).build());
        if (Build.VERSION.SDK_INT >= 21) {
            b.setStyle(new Notification.MediaStyle()
                    .setShowActionsInCompactView(0, 1)
                    .setMediaSession(
                            mediaSession != null ? mediaSession.getSessionToken() : null));
        }
        return b.build();
    }
}
