package com.neutron.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import android.webkit.WebView;

/**
 * WebView that can pretend to stay visible while music is playing.
 *
 * <p>Why: the Music section plays through a YouTube iframe player. YouTube
 * pauses itself as soon as the page reports {@code hidden}, which happens
 * the moment the activity is stopped (user presses Home or switches apps).
 * The foreground {@link MusicService} keeps our process alive, but it
 * cannot stop YouTube from pausing — so we swallow the window-hidden event
 * while music is playing and the page keeps decoding audio in the
 * background.
 *
 * <p>The flag is driven by the JS bridge (AppBridge.onMusicPlaying /
 * onMusicPaused / onMusicStopped). When music is not playing, visibility
 * propagates normally so the WebView throttles like any background page.
 */
public class NeutronWebView extends WebView {
    private volatile boolean keepVisible = false;

    public NeutronWebView(Context context) {
        super(context);
    }

    public NeutronWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    /** While true, window-hidden events are swallowed so the page stays "visible". */
    public void setKeepVisible(boolean keep) {
        keepVisible = keep;
        if (!keep) {
            // Re-sync: if the window is actually hidden right now, let the
            // page know so it throttles normally again.
            int vis = getWindowVisibility();
            if (vis != View.VISIBLE) {
                super.onWindowVisibilityChanged(vis);
            }
        }
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        if (keepVisible && visibility != View.VISIBLE) {
            return; // stay "visible" — keeps YouTube playing in background
        }
        super.onWindowVisibilityChanged(visibility);
    }
}
