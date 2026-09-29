package com.neutron.app;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Resolves the live backend URL dynamically.
 *
 * Every Vercel redeploy gets a fresh deployment URL, so a hardcoded URL would
 * go stale. Instead we ask the GitHub Deployments API for this repo's newest
 * SUCCESSFUL deployment and use its /app page. Falls back to the baked-in URL
 * when offline or rate-limited (old deployments stay live, so the app keeps
 * working with the previous UI until the next check).
 */
public class BackendResolver {

    private static final String REPO = "sunnymishraatf-lgtm/My-Agent";
    private static final String DEPLOYMENTS_URL =
            "https://api.github.com/repos/" + REPO + "/deployments?per_page=10";

    /** Newest successful deployment's /app URL, or null if unresolvable. */
    public static String resolve() {
        try {
            JSONArray deps = new JSONArray(httpGet(DEPLOYMENTS_URL));
            for (int i = 0; i < deps.length(); i++) {
                JSONObject d = deps.optJSONObject(i);
                if (d == null) continue;
                String statusesUrl = d.optString("statuses_url", "");
                if (statusesUrl.isEmpty()) continue;
                JSONArray st = new JSONArray(httpGet(statusesUrl + "?per_page=1"));
                if (st.length() == 0) continue;
                JSONObject s = st.optJSONObject(0);
                if (s == null) continue;
                if ("success".equals(s.optString("state"))) {
                    String target = s.optString("target_url", "");
                    if (!target.isEmpty()) return target + "/app";
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private static String httpGet(String urlStr) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(urlStr).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(10000);
        c.setRequestProperty("Accept", "application/vnd.github+json");
        c.setRequestProperty("User-Agent", "NEUTRON-app");
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        InputStream in = c.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }
}
