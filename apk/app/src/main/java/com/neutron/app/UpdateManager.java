package com.neutron.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Self-updater: checks the latest GitHub release once a day, prompts the
 * user, downloads the APK via DownloadManager and fires the installer.
 * No Play Store or manual re-download needed after this version.
 */
public class UpdateManager {

    private static final String REPO = "sunnymishraatf-lgtm/My-Agent";
    private static final String RELEASES_URL =
            "https://api.github.com/repos/" + REPO + "/releases/latest";
    private static final long CHECK_INTERVAL_MS = 24L * 60 * 60 * 1000;
    private static final String PREFS = "neutron_update";
    private static final String KEY_LAST_CHECK = "last_check";
    public static final String KEY_BACKEND_URL = "backend_url";

    private final Activity activity;
    private long pendingDownloadId = -1;
    private BroadcastReceiver downloadReceiver;

    public UpdateManager(Activity activity) {
        this.activity = activity;
    }

    /** Fire-and-forget: runs the check on a background thread. */
    public void checkForUpdates() {
        checkForUpdates(false);
    }

    /**
     * Fire-and-forget: runs the check on a background thread.
     * @param force when true, bypasses the once-a-day throttle
     *              (used when the user taps the update notification).
     */
    public void checkForUpdates(boolean force) {
        SharedPreferences prefs =
                activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long last = prefs.getLong(KEY_LAST_CHECK, 0);
        if (!force && System.currentTimeMillis() - last < CHECK_INTERVAL_MS) return;

        new Thread(() -> {
            // Keep the backend URL fresh: newest successful deployment wins.
            String backend = BackendResolver.resolve();
            if (backend != null) {
                prefs.edit().putString(KEY_BACKEND_URL, backend).apply();
            }
            UpdateInfo info = checkNow(activity);
            markChecked(prefs);
            if (info == null) return;
            final String tag = info.tag;
            final String url = info.apkUrl;
            activity.runOnUiThread(() -> promptUpdate(tag, url));
        }).start();
    }

    /** A newer release with a downloadable APK, or null when up to date. */
    public static class UpdateInfo {
        public final String tag;
        public final String apkUrl;

        UpdateInfo(String tag, String apkUrl) {
            this.tag = tag;
            this.apkUrl = apkUrl;
        }
    }

    /**
     * Synchronous GitHub release check. Safe to call from any background
     * thread — used by the activity flow and by the periodic background
     * receiver that posts the update notification.
     */
    public static UpdateInfo checkNow(Context ctx) {
        try {
            HttpURLConnection c =
                    (HttpURLConnection) new URL(RELEASES_URL).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(10000);
            c.setRequestProperty("Accept", "application/vnd.github+json");
            c.setRequestProperty("User-Agent", "NEUTRON-app");
            if (c.getResponseCode() != 200) return null;

            JSONObject rel = new JSONObject(readAllStatic(c.getInputStream()));
            int latest = parseVersionStatic(rel.optString("tag_name", ""));
            if (latest <= currentVersionCodeStatic(ctx)) return null;
            String apkUrl = findApkAssetStatic(rel.optJSONArray("assets"));
            if (apkUrl == null) return null;
            return new UpdateInfo(rel.optString("tag_name", ""), apkUrl);
        } catch (Exception ignored) {
            // No network or API hiccup: stay silent, retry next time.
            return null;
        }
    }

    private void markChecked(SharedPreferences prefs) {
        prefs.edit().putLong(KEY_LAST_CHECK, System.currentTimeMillis()).apply();
    }

    private int parseVersion(String tag) {
        return parseVersionStatic(tag);
    }

    private static int parseVersionStatic(String tag) {
        try {
            return Integer.parseInt(tag.replaceAll("[^0-9]", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private int currentVersionCode() {
        return currentVersionCodeStatic(activity);
    }

    private static int currentVersionCodeStatic(Context ctx) {
        try {
            if (Build.VERSION.SDK_INT >= 28) {
                return (int) ctx.getPackageManager()
                        .getPackageInfo(ctx.getPackageName(), 0)
                        .getLongVersionCode();
            }
            @SuppressWarnings("deprecation")
            int v = ctx.getPackageManager()
                    .getPackageInfo(ctx.getPackageName(), 0).versionCode;
            return v;
        } catch (PackageManager.NameNotFoundException e) {
            return 0;
        }
    }

    private String findApkAsset(JSONArray assets) {
        return findApkAssetStatic(assets);
    }

    private static String findApkAssetStatic(JSONArray assets) {
        if (assets == null) return null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject a = assets.optJSONObject(i);
            if (a == null) continue;
            String name = a.optString("name", "");
            if (name.endsWith(".apk")) return a.optString("browser_download_url", null);
        }
        return null;
    }

    private String readAll(InputStream in) throws Exception {
        return readAllStatic(in);
    }

    private static String readAllStatic(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }

    private void promptUpdate(String tag, String apkUrl) {
        new AlertDialog.Builder(activity)
                .setTitle("Update available")
                .setMessage("NEUTRON " + tag + " is ready. Download and install it now?")
                .setPositiveButton("Download", (d, w) -> startDownload(apkUrl))
                .setNegativeButton("Later", (d, w) -> d.dismiss())
                .setCancelable(true)
                .show();
    }

    private void startDownload(String apkUrl) {
        DownloadManager dm =
                (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        DownloadManager.Request req = new DownloadManager.Request(Uri.parse(apkUrl))
                .setTitle("NEUTRON update")
                .setDescription("Downloading the latest version…")
                .setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(
                        Environment.DIRECTORY_DOWNLOADS, "NEUTRON-update.apk")
                .setMimeType("application/vnd.android.package-archive");
        pendingDownloadId = dm.enqueue(req);

        downloadReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (id != pendingDownloadId) return;
                DownloadManager.Query q = new DownloadManager.Query().setFilterById(id);
                try (Cursor cur = dm.query(q)) {
                    if (cur.moveToFirst()
                            && cur.getInt(cur.getColumnIndexOrThrow(
                                    DownloadManager.COLUMN_STATUS))
                                    == DownloadManager.STATUS_SUCCESSFUL) {
                        installApk(dm.getUriForDownloadedFile(id));
                    }
                } catch (Exception ignored) {
                }
            }
        };
        IntentFilter f = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            activity.registerReceiver(downloadReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        } else {
            activity.registerReceiver(downloadReceiver, f);
        }
    }

    private void installApk(Uri uri) {
        if (uri == null) return;
        if (Build.VERSION.SDK_INT >= 26
                && !activity.getPackageManager().canRequestPackageInstalls()) {
            activity.startActivity(new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName())));
            return;
        }
        Intent install = new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(uri, "application/vnd.android.package-archive");
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_ACTIVITY_NEW_TASK);
        activity.startActivity(install);
    }

    public void onDestroy() {
        if (downloadReceiver != null) {
            try {
                activity.unregisterReceiver(downloadReceiver);
            } catch (Exception ignored) {
            }
            downloadReceiver = null;
        }
    }
}
