package com.neutron.app;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** NEUTRON — thin native shell around the live NEUTRON web app. */
public class MainActivity extends Activity {

    // Stable production URL — never changes. The dynamic resolver below
    // is only a fallback in case production is ever stale.
    private static final String FALLBACK_URL =
            "https://neutron-agent.vercel.app/app";

    private static final int REQ_APP_PERMISSIONS = 1001;

    /** Google OAuth client (same as the web app). */
    private static final String GOOGLE_CLIENT_ID =
            "485781555196-n5bv0ftsuoivr71u6to7net5lkg2qoth.apps.googleusercontent.com";

    private NeutronWebView web;
    private UpdateManager updater;
    /** WebView permission request held while we ask Android for the matching
        runtime permission; completed in onRequestPermissionsResult. */
    private PermissionRequest pendingWebRequest;

    /** Relays notification/lock-screen music buttons into the web player,
        plus native-audio events (track ended / error) from MusicService. */
    private final BroadcastReceiver musicCmdReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context ctx, Intent intent) {
            if (web == null || intent == null) return;
            String action = intent.getAction();
            /* Native player event: only fixed event names are forwarded,
               never raw intent extras (no JS injection surface). */
            if (MusicService.ACTION_AUDIO_EVENT.equals(action)) {
                String ev = intent.getStringExtra(MusicService.EXTRA_EVENT);
                String js = null;
                if (MusicService.EVENT_ENDED.equals(ev)) {
                    js = "(window.NeutronMusic && NeutronMusic._onNativeAudioEvent('ended'))";
                } else if (MusicService.EVENT_ERROR.equals(ev)) {
                    js = "(window.NeutronMusic && NeutronMusic._onNativeAudioEvent('error'))";
                }
                if (js != null) {
                    try { web.evaluateJavascript(js, null); } catch (Exception ignored) {}
                }
                return;
            }
            String cmd = intent.getStringExtra(MusicService.EXTRA_CMD);
            String js = null;
            if (MusicService.CMD_TOGGLE.equals(cmd)) {
                js = "(window.NeutronMusic && NeutronMusic.toggle())";
            } else if (MusicService.CMD_NEXT.equals(cmd)) {
                js = "(window.NeutronMusic && NeutronMusic.next())";
            } else if (MusicService.CMD_STOP.equals(cmd)) {
                js = "(window.NeutronMusic && NeutronMusic.stop())";
            }
            if (js != null) {
                try { web.evaluateJavascript(js, null); } catch (Exception ignored) {}
            }
        }
    };
    private boolean musicReceiverRegistered = false;

    /** Backend URL: last resolved deployment, or the baked-in fallback. */
    private String homeUrl() {
        return getSharedPreferences("neutron_update", MODE_PRIVATE)
                .getString(UpdateManager.KEY_BACKEND_URL, FALLBACK_URL);
    }

    /** Dangerous permissions the app asks for (POST_NOTIFICATIONS only
        exists on API 33+). */
    private static String[] wantedPermissions() {
        if (Build.VERSION.SDK_INT >= 33) {
            return new String[] {
                    Manifest.permission.RECORD_AUDIO,
                    Manifest.permission.CAMERA,
                    Manifest.permission.POST_NOTIFICATIONS,
            };
        }
        return new String[] {
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.CAMERA,
        };
    }

    private boolean hasPermission(String perm) {
        return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasAllPermissions() {
        for (String p : wantedPermissions()) {
            if (!hasPermission(p)) return false;
        }
        return true;
    }

    /** Ask Android for mic/camera/notification permission (API 23+). */
    private void ensureAppPermissions() {
        if (Build.VERSION.SDK_INT >= 23 && !hasAllPermissions()) {
            requestPermissions(wantedPermissions(), REQ_APP_PERMISSIONS);
        }
    }

    /** True when the app is already exempt from battery optimization. */
    private boolean ignoringBatteryOptimizations() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
        } catch (Exception e) {
            return true; // assume fine if we can't check
        }
    }

    /** First-time nudge: only ask once, the first time music plays. */
    private void promptBatteryOptimizationOnce() {
        try {
            android.content.SharedPreferences prefs =
                    getSharedPreferences("neutron_prefs", Context.MODE_PRIVATE);
            if (prefs.getBoolean("battery_opt_asked", false)) return;
            prefs.edit().putBoolean("battery_opt_asked", true).apply();
        } catch (Exception ignored) {}
        promptBatteryOptimization(false);
    }

    /**
     * Ask the user to let NEUTRON run in the background (exempt from battery
     * optimization). Without this, most phones kill background audio minutes
     * after the screen turns off, foreground service or not.
     */
    private void promptBatteryOptimization(final boolean force) {
        if (!force && ignoringBatteryOptimizations()) return;
        if (force && ignoringBatteryOptimizations()) {
            android.widget.Toast.makeText(this,
                    "Background run is already allowed.", android.widget.Toast.LENGTH_SHORT).show();
            return;
        }
        new android.app.AlertDialog.Builder(this)
                .setTitle("Keep music playing in background?")
                .setMessage("Your phone's battery saver can stop NEUTRON's music when the " +
                        "screen is off. Allow background run so playback never cuts out.")
                .setPositiveButton("Allow", new android.content.DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(android.content.DialogInterface d, int which) {
                        try {
                            Intent i = new Intent(
                                    android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                                    android.net.Uri.parse("package:" + getPackageName()));
                            startActivity(i);
                        } catch (Exception e) {
                            // Fallback: open the app's battery settings page.
                            try {
                                Intent i = new Intent(
                                        android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                                startActivity(i);
                            } catch (Exception ignored) {}
                        }
                    }
                })
                .setNegativeButton("Not now", null)
                .show();
    }

    private boolean hasWebResources(String[] resources) {
        for (String r : resources) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)
                    && !hasPermission(Manifest.permission.RECORD_AUDIO)) return false;
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)
                    && !hasPermission(Manifest.permission.CAMERA)) return false;
        }
        return true;
    }

    /** Runs on the UI thread (see the WebChromeClient above). */
    private void handleWebPermissionRequest(PermissionRequest request) {
        String[] resources = request.getResources();
        boolean media = false;
        for (String r : resources) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)
                    || PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) {
                media = true;
            }
        }
        if (!media) {
            request.deny();
            return;
        }
        if (hasWebResources(resources)) {
            request.grant(resources);
        } else {
            // Ask Android first; grant/deny when the user answers.
            pendingWebRequest = request;
            ensureAppPermissions();
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new NeutronWebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Allow popups (e.g. Google sign-in) — handled in onCreateWindow below.
        s.setSupportMultipleWindows(true);

        /* Downloads: WebView ignores <a download> clicks, so handle them
           natively — save to the public Downloads folder and notify. */
        web.setDownloadListener(new android.webkit.DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent,
                                        String contentDisposition, String mimeType,
                                        long contentLength) {
                try {
                    android.app.DownloadManager dm = (android.app.DownloadManager)
                            getSystemService(DOWNLOAD_SERVICE);
                    android.app.DownloadManager.Request req =
                            new android.app.DownloadManager.Request(
                                    android.net.Uri.parse(url));
                    String name = android.webkit.URLUtil.guessFileName(
                            url, contentDisposition, mimeType);
                    req.setTitle(name);
                    req.setDescription("Downloading from NEUTRON");
                    req.setNotificationVisibility(
                            android.app.DownloadManager.Request
                                    .VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    req.setDestinationInExternalPublicDir(
                            android.os.Environment.DIRECTORY_DOWNLOADS, name);
                    if (dm != null) dm.enqueue(req);
                    android.widget.Toast.makeText(MainActivity.this,
                            "Downloading " + name + "…",
                            android.widget.Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    android.widget.Toast.makeText(MainActivity.this,
                            "Download failed.",
                            android.widget.Toast.LENGTH_SHORT).show();
                }
            }
        });

        web.setWebViewClient(new WebViewClient());
        /* Bridge page mic/camera requests (e.g. voice-call getUserMedia)
           to Android runtime permissions. Without this, WebView silently
           denies them and the page can never open the microphone. */
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // grant()/deny() must run on the UI thread.
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        handleWebPermissionRequest(request);
                    }
                });
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (request == pendingWebRequest) pendingWebRequest = null;
            }

            /* Popup windows (e.g. Google sign-in OAuth). Show in a dialog
               WebView; Google closes it via window.close() when done. */
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog,
                                          boolean isUserGesture, android.os.Message resultMsg) {
                final android.app.Dialog dialog = new android.app.Dialog(MainActivity.this);
                final WebView popup = new WebView(MainActivity.this);
                popup.getSettings().setJavaScriptEnabled(true);
                popup.getSettings().setDomStorageEnabled(true);
                popup.setWebViewClient(new WebViewClient());
                popup.setWebChromeClient(new WebChromeClient() {
                    @Override
                    public void onCloseWindow(WebView w) {
                        try { dialog.dismiss(); } catch (Exception ignored) {}
                    }
                });
                dialog.setContentView(popup);
                try {
                    dialog.show();
                } catch (Exception e) {
                    return false;
                }
                WebView.WebViewTransport transport =
                        (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(popup);
                resultMsg.sendToTarget();
                return true;
            }
        });
        web.addJavascriptInterface(new AppBridge(), "NeutronApp");
        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(homeUrl());
        }

        // Ask for mic / camera / notification permission on launch.
        ensureAppPermissions();

        // Self-updater: silently checks GitHub releases for a newer build.
        updater = new UpdateManager(this);
        updater.checkForUpdates();
        // Background update check: posts a system notification when a new
        // release is published, even if the app hasn't been opened.
        UpdateScheduler.schedule(this);
        // Tapped the update notification: jump straight to the update dialog.
        handleUpdateIntent(getIntent());

        // Notification/lock-screen music controls -> web player.
        IntentFilter musicFilter = new IntentFilter(MusicService.ACTION_CMD);
        musicFilter.addAction(MusicService.ACTION_AUDIO_EVENT);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(musicCmdReceiver, musicFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(musicCmdReceiver, musicFilter);
        }
        musicReceiverRegistered = true;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleUpdateIntent(intent);
        handleOAuthRedirect(intent);
    }

    /**
     * Captures the Google OAuth redirect (com.neutron.app:/oauth2redirect),
     * extracts the ID token, and hands it to the web app for verification.
     */
    private void handleOAuthRedirect(Intent intent) {
        if (intent == null || intent.getData() == null) return;
        android.net.Uri uri = intent.getData();
        if (!"com.neutron.app".equals(uri.getScheme())) return;
        if (!"/oauth2redirect".equals(uri.getPath())) return;
        // Implicit flow returns the token in the URL fragment.
        String frag = uri.getFragment();
        String idToken = null;
        if (frag != null) {
            for (String kv : frag.split("&")) {
                int eq = kv.indexOf('=');
                if (eq > 0 && "id_token".equals(kv.substring(0, eq))) {
                    try {
                        idToken = java.net.URLDecoder.decode(
                                kv.substring(eq + 1), "UTF-8");
                    } catch (Exception ignored) {}
                }
            }
        }
        if (idToken == null || idToken.isEmpty()) {
            String err = uri.getQueryParameter("error");
            final String msg = err != null ? err : "no token returned";
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    android.widget.Toast.makeText(MainActivity.this,
                            "Google sign-in failed: " + msg,
                            android.widget.Toast.LENGTH_LONG).show();
                }
            });
            return;
        }
        final String token = idToken;
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    String js = "(function(){try{"
                            + "if(window.NeutronAuth&&NeutronAuth.nativeGoogleToken)"
                            + "NeutronAuth.nativeGoogleToken("
                            + org.json.JSONObject.quote(token) + ");"
                            + "}catch(e){}})()";
                    if (web != null) web.evaluateJavascript(js, null);
                } catch (Exception ignored) {}
            }
        });
    }

    /** Opens the update dialog when launched from the update notification. */
    private void handleUpdateIntent(Intent intent) {
        if (intent != null
                && intent.getBooleanExtra("neutron_force_update_check", false)
                && updater != null) {
            intent.removeExtra("neutron_force_update_check");
            updater.checkForUpdates(true);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_APP_PERMISSIONS && pendingWebRequest != null) {
            PermissionRequest req = pendingWebRequest;
            pendingWebRequest = null;
            java.util.ArrayList<String> granted = new java.util.ArrayList<>();
            for (String r : req.getResources()) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)
                        && hasPermission(Manifest.permission.RECORD_AUDIO)) granted.add(r);
                if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)
                        && hasPermission(Manifest.permission.CAMERA)) granted.add(r);
            }
            if (granted.isEmpty()) req.deny();
            else req.grant(granted.toArray(new String[0]));
        }
    }

    @Override
    protected void onDestroy() {
        if (musicReceiverRegistered) {
            try { unregisterReceiver(musicCmdReceiver); } catch (Exception ignored) {}
            musicReceiverRegistered = false;
        }
        if (updater != null) updater.onDestroy();
        super.onDestroy();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /** JS bridge: lets the web app read the native shell version. */
    private class AppBridge {
        @JavascriptInterface
        public String getApkVersion() {
            try {
                return getPackageManager()
                        .getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "?";
            }
        }

        @JavascriptInterface
        public int getApkVersionCode() {
            try {
                if (Build.VERSION.SDK_INT >= 28) {
                    return (int) getPackageManager()
                            .getPackageInfo(getPackageName(), 0).getLongVersionCode();
                }
                @SuppressWarnings("deprecation")
                int v = getPackageManager()
                        .getPackageInfo(getPackageName(), 0).versionCode;
                return v;
            } catch (Exception e) {
                return 0;
            }
        }

        /**
         * Native Google sign-in: opens the OAuth flow in the system browser
         * (where the user's Gmail accounts are already signed in, so they
         * get the account picker instead of typing their email). Google
         * returns the ID token to com.neutron.app:/oauth2redirect, which
         * onNewIntent captures and hands to the WebView.
         */
        @JavascriptInterface
        public void googleSignIn() {            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        String nonce = java.util.UUID.randomUUID().toString();
                        String url = "https://accounts.google.com/o/oauth2/v2/auth"
                                + "?client_id=" + android.net.Uri.encode(GOOGLE_CLIENT_ID)
                                + "&redirect_uri=" + android.net.Uri.encode("com.neutron.app:/oauth2redirect")
                                + "&response_type=id_token"
                                + "&scope=" + android.net.Uri.encode("openid email profile")
                                + "&nonce=" + android.net.Uri.encode(nonce);
                        Intent i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
                        // Prefer a real browser over the app itself for the OAuth page.
                        i.addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY);
                        startActivity(i);
                    } catch (Exception e) {
                        android.widget.Toast.makeText(MainActivity.this,
                                "Couldn't open browser for Google sign-in.",
                                android.widget.Toast.LENGTH_LONG).show();
                    }
                }
            });
        }

        /** Music started playing (or the track changed) — keep it alive
            in the background with a media notification. */
        @JavascriptInterface
        public void onMusicPlaying(final String title) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (web != null) web.setKeepVisible(true);
                    MusicService.update(MainActivity.this, title, true);
                    promptBatteryOptimizationOnce();
                }
            });
        }

        /**
         * Ask the user to exempt NEUTRON from battery optimization, so music
         * keeps playing with the screen off / app in background. Shown once,
         * the first time music plays (when the reason is obvious). Also
         * available on demand via {@link #requestBackgroundPermission}.
         */
        @JavascriptInterface
        public void requestBackgroundPermission() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    promptBatteryOptimization(true);
                }
            });
        }

        /**
         * Save a base64-encoded file to Downloads. Used for blob downloads
         * (e.g. generated zips) which WebView can't handle natively.
         * Returns the saved file path, or an error string prefixed with "ERR:".
         */
        @JavascriptInterface
        public String saveFile(final String base64Data, final String filename,
                               final String mimeType) {
            try {
                byte[] data = android.util.Base64.decode(base64Data,
                        android.util.Base64.DEFAULT);
                // Sanitize filename.
                String safe = filename.replaceAll("[^a-zA-Z0-9._-]", "_");
                if (safe.isEmpty()) safe = "download";
                final String savedName;
                String resultPath;

                if (android.os.Build.VERSION.SDK_INT >= 29) {
                    // Scoped storage: use MediaStore.
                    android.content.ContentValues values = new android.content.ContentValues();
                    values.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, safe);
                    values.put(android.provider.MediaStore.Downloads.MIME_TYPE,
                            mimeType != null ? mimeType : "application/octet-stream");
                    values.put(android.provider.MediaStore.Downloads.RELATIVE_PATH,
                            android.os.Environment.DIRECTORY_DOWNLOADS);
                    android.net.Uri uri = getContentResolver().insert(
                            android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) return "ERR:couldn't create file";
                    java.io.OutputStream os = getContentResolver().openOutputStream(uri);
                    if (os == null) return "ERR:couldn't open file";
                    os.write(data);
                    os.close();
                    savedName = safe;
                    resultPath = uri.toString();
                } else {
                    // Legacy: direct file access.
                    java.io.File dir = android.os.Environment.getExternalStoragePublicDirectory(
                            android.os.Environment.DIRECTORY_DOWNLOADS);
                    if (!dir.exists()) dir.mkdirs();
                    java.io.File out = new java.io.File(dir, safe);
                    int n = 1;
                    while (out.exists()) {
                        int dot = safe.lastIndexOf('.');
                        String base = dot > 0 ? safe.substring(0, dot) : safe;
                        String ext = dot > 0 ? safe.substring(dot) : "";
                        out = new java.io.File(dir, base + " (" + n + ")" + ext);
                        n++;
                    }
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(out);
                    fos.write(data);
                    fos.close();
                    try {
                        android.media.MediaScannerConnection.scanFile(
                                MainActivity.this,
                                new String[]{out.getAbsolutePath()}, null, null);
                    } catch (Exception ignored) {}
                    savedName = out.getName();
                    resultPath = out.getAbsolutePath();
                }
                final String toastName = savedName;
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        android.widget.Toast.makeText(MainActivity.this,
                                "Saved to Downloads: " + toastName,
                                android.widget.Toast.LENGTH_LONG).show();
                    }
                });
                return resultPath;
            } catch (Exception e) {
                return "ERR:" + e.getMessage();
            }
        }

        /** Music paused — keep the notification, show the paused state. */
        @JavascriptInterface
        public void onMusicPaused() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (web != null) web.setKeepVisible(false);
                    MusicService.update(MainActivity.this, null, false);
                }
            });
        }

        /** Music stopped entirely — dismiss the notification, release locks. */
        @JavascriptInterface
        public void onMusicStopped() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (web != null) web.setKeepVisible(false);
                    MusicService.stop(MainActivity.this);
                }
            });
        }

        /* ----- Native URL audio (free-music engine) -----
           Streams an mp3 URL directly in MusicService's MediaPlayer, so it
           keeps playing with the screen off — no WebView involved. */

        /** Feature-detect: the free-music engine uses this to pick the
            native player over the HTML5 fallback. */
        @JavascriptInterface
        public boolean hasNativeAudio() {
            return true;
        }

        @JavascriptInterface
        public void nativeAudioPlay(final String url, final String title, final String artist) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    promptBatteryOptimizationOnce();
                    MusicService.playStream(MainActivity.this, url,
                            title != null ? title : "NEUTRON Music",
                            artist != null ? artist : "");
                }
            });
        }

        @JavascriptInterface
        public void nativeAudioPause() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MusicService.pauseStream(MainActivity.this);
                }
            });
        }

        @JavascriptInterface
        public void nativeAudioResume() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MusicService.resumeStream(MainActivity.this);
                }
            });
        }

        @JavascriptInterface
        public void nativeAudioStop() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    MusicService.stopStream(MainActivity.this);
                }
            });
        }

        /* ----- Persistent data (SharedPreferences) -----
           The web app mirrors localStorage here, so user data (history,
           playlists, theme, API keys, friends) survives even if the
           WebView's own storage is ever wiped. Synchronous and fast
           (SharedPreferences is in-memory after first load). */
        @JavascriptInterface
        public void nativeSave(String key, String value) {
            try {
                getSharedPreferences("neutron_data", MODE_PRIVATE)
                        .edit().putString(key, value).apply();
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public String nativeLoad(String key) {
            try {
                return getSharedPreferences("neutron_data", MODE_PRIVATE)
                        .getString(key, null);
            } catch (Exception e) {
                return null;
            }
        }

        @JavascriptInterface
        public void nativeRemove(String key) {
            try {
                getSharedPreferences("neutron_data", MODE_PRIVATE)
                        .edit().remove(key).apply();
            } catch (Exception ignored) {}
        }

        /** Open the Android share sheet (used for room invites). */
        @JavascriptInterface
        public void shareText(final String title, final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent share = new Intent(Intent.ACTION_SEND);
                    share.setType("text/plain");
                    share.putExtra(Intent.EXTRA_TEXT, text);
                    try {
                        startActivity(Intent.createChooser(
                                share, title != null ? title : "Share"));
                    } catch (Exception ignored) {}
                }
            });
        }
    }
}
