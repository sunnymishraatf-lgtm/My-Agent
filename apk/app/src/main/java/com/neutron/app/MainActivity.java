package com.neutron.app;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
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

    private WebView web;
    private UpdateManager updater;
    /** WebView permission request held while we ask Android for the matching
        runtime permission; completed in onRequestPermissionsResult. */
    private PermissionRequest pendingWebRequest;

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
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);

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
    }
}
