package com.neutron.app;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** NEUTRON — thin native shell around the live NEUTRON web app. */
public class MainActivity extends Activity {

    // Stable production URL — never changes. The dynamic resolver below
    // is only a fallback in case production is ever stale.
    private static final String FALLBACK_URL =
            "https://neutron-agent.vercel.app/app";

    private WebView web;
    private UpdateManager updater;

    /** Backend URL: last resolved deployment, or the baked-in fallback. */
    private String homeUrl() {
        return getSharedPreferences("neutron_update", MODE_PRIVATE)
                .getString(UpdateManager.KEY_BACKEND_URL, FALLBACK_URL);
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
        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl(homeUrl());
        }

        // Self-updater: silently checks GitHub releases for a newer build.
        updater = new UpdateManager(this);
        updater.checkForUpdates();
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
}
