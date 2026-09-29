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

    private final Activity activity;
    private long pendingDownloadId = -1;
    private BroadcastReceiver downloadReceiver;

    public UpdateManager(Activity activity) {
        this.activity = activity;
    }

    /** Fire-and-forget: runs the check on a background thread. */
    public void checkForUpdates() {
        SharedPreferences prefs =
                activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        long last = prefs.getLong(KEY_LAST_CHECK, 0);
        if (System.currentTimeMillis() - last < CHECK_INTERVAL_MS) return;

        new Thread(() -> {
            try {
                HttpURLConnection c =
                        (HttpURLConnection) new URL(RELEASES_URL).openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(10000);
                c.setRequestProperty("Accept", "application/vnd.github+json");
                c.setRequestProperty("User-Agent", "NEUTRON-app");
                if (c.getResponseCode() != 200) return;

                JSONObject rel = new JSONObject(readAll(c.getInputStream()));
                int latest = parseVersion(rel.optString("tag_name", ""));
                if (latest <= currentVersionCode()) {
                    markChecked(prefs);
                    return;
                }
                String apkUrl = findApkAsset(rel.optJSONArray("assets"));
                if (apkUrl == null) {
                    markChecked(prefs);
                    return;
                }
                markChecked(prefs);
                final String tag = rel.optString("tag_name", "");
                final String url = apkUrl;
                activity.runOnUiThread(() -> promptUpdate(tag, url));
            } catch (Exception ignored) {
                // No network or API hiccup: stay silent, retry next launch.
            }
        }).start();
    }

    private void markChecked(SharedPreferences prefs) {
        prefs.edit().putLong(KEY_LAST_CHECK, System.currentTimeMillis()).apply();
    }

    private int parseVersion(String tag) {
        try {
            return Integer.parseInt(tag.replaceAll("[^0-9]", ""));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private int currentVersionCode() {
        try {
            if (Build.VERSION.SDK_INT >= 28) {
                return (int) activity.getPackageManager()
                        .getPackageInfo(activity.getPackageName(), 0)
                        .getLongVersionCode();
            }
            @SuppressWarnings("deprecation")
            int v = activity.getPackageManager()
                    .getPackageInfo(activity.getPackageName(), 0).versionCode;
            return v;
        } catch (PackageManager.NameNotFoundException e) {
            return 0;
        }
    }

    private String findApkAsset(JSONArray assets) {
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
