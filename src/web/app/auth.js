/* ==========================================================================
   NEUTRON Accounts — login with Google / email / guest, unique usernames,
   public profiles, and connections (friend requests).

   Auth lives on the Node server (/api/auth/*); the Vercel serverless
   deployment has no user store, so this screen explains that honestly and
   points at the Render backend. Sessions are Bearer tokens kept in
   localStorage (which the APK mirrors to native storage).
   ========================================================================== */
(function () {
  "use strict";

  var TOKEN_KEY = "neutron_auth_token";
  var ME_CACHE = null;
  /* If the current backend has no auth (e.g. Vercel serverless), fall back
     to the user's Node server so login works everywhere. */
  var AUTH_FALLBACK_BASE = "https://neutron-server.onrender.com";
  var authBase = null; // resolved working auth backend (string) or false

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function toast(msg) {
    if (window.NeutronUI && window.NeutronUI.toast) window.NeutronUI.toast(msg);
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
  }

  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
    ME_CACHE = null;
  }

  function currentBackendBase() {
    try {
      if (window.NeutronUI && window.NeutronUI.backendBase) {
        return window.NeutronUI.backendBase();
      }
      return (localStorage.getItem("neutron_backend_url") || "").trim();
    } catch (e) { return ""; }
  }

  async function tryAuthBase(base) {
    try {
      var res = await fetch(base + "/api/auth/status", { method: "GET" });
      if (!res.ok) return false;
      var d = await res.json();
      return !!(d && d.ok);
    } catch (e) { return false; }
  }

  async function resolveAuthBase() {
    if (authBase !== null) return authBase || "";
    var primary = currentBackendBase();
    if (await tryAuthBase(primary)) { authBase = primary; return authBase; }
    if (primary !== AUTH_FALLBACK_BASE && await tryAuthBase(AUTH_FALLBACK_BASE)) {
      authBase = AUTH_FALLBACK_BASE;
      return authBase;
    }
    authBase = false;
    return "";
  }

  async function apiAuth(method, path, body) {
    var base = await resolveAuthBase();
    var headers = { "content-type": "application/json" };
    var t = getToken();
    if (t) headers["authorization"] = "Bearer " + t;
    var res = await fetch(base + path, {
      method: method,
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    var data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || ("HTTP " + res.status));
    return data;
  }

  async function authStatus() {
    var base = await resolveAuthBase();
    if (!base) return null;
    try { return await apiAuth("GET", "/api/auth/status"); }
    catch (e) { return null; }
  }

  async function me(force) {
    if (ME_CACHE && !force) return ME_CACHE;
    var t = getToken();
    if (!t) return null;
    try {
      var d = await apiAuth("GET", "/api/auth/me");
      ME_CACHE = d.user || null;
      return ME_CACHE;
    } catch (e) {
      if (/Not logged in|401/.test(String((e && e.message) || e))) { setToken(""); }
      return null;
    }
  }

  async function loginDone(user, token) {
    setToken(token);
    ME_CACHE = user;
    toast("Welcome, " + (user.displayName || user.username) + ".");
    renderIntoCurrent();
  }

  function renderIntoCurrent() {
    // Re-render the account route if we're on it.
    try {
      if ((location.hash || "") === "#/account" && window.NeutronAuth) {
        var view = document.getElementById("view");
        if (view) { view.innerHTML = ""; window.NeutronAuth.renderAccount(view); }
      }
    } catch (e) {}
  }

  /* ---------- Google Identity Services ---------- */

  var gisLoading = null;
  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      return Promise.resolve();
    }
    if (!gisLoading) {
      gisLoading = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true; s.defer = true;
        s.onload = resolve;
        s.onerror = function () { reject(new Error("Couldn't load Google sign-in.")); };
        document.head.appendChild(s);
      });
    }
    return gisLoading;
  }

  function renderGoogleButton(box, clientId, onToken) {
    var wrap = el("div", "auth-google-wrap");
    box.appendChild(wrap);
    box.appendChild(el("p", "muted small", "Google verifies your identity; NEUTRON never sees your password."));
    loadGis().then(function () {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: function (resp) {
          if (resp && resp.credential) onToken(resp.credential);
          else toast("Google sign-in was cancelled.");
        },
        auto_select: false,
      });
      // Official Google button — opens the proper OAuth popup.
      window.google.accounts.id.renderButton(wrap, {
        theme: "outline",
        size: "large",
        text: "continue_with",
        width: 280,
        locale: "en",
      });
    }).catch(function () {
      wrap.appendChild(el("p", "auth-err", "Couldn't load Google sign-in. Check your connection."));
    });
  }

  /* ---------- screens ---------- */

  function renderAccount(view) {
    view.innerHTML = "";
    view.appendChild(el("h1", null, "Account"));
    var statusBox = el("div", "panel");
    statusBox.appendChild(el("p", "muted", "Checking account server…"));
    view.appendChild(statusBox);

    authStatus().then(function (st) {
      statusBox.innerHTML = "";
      if (!st) {
        statusBox.appendChild(el("h2", null, "Accounts are unreachable"));
        statusBox.appendChild(el("p", "muted",
          "Couldn't reach an account server on this backend or your Node server. " +
          "Check your connection, or set the backend URL to your Render Node server " +
          "in Settings → Developer mode."));
        var goBtn = el("button", "btn", "Open Settings");
        goBtn.onclick = function () { location.hash = "#/settings"; };
        statusBox.appendChild(goBtn);
        return;
      }
      if (!st.persistent) {
        var warn = el("p", "auth-warn",
          "Note: this server has no persistent database configured — accounts " +
          "may reset when the server sleeps. Ask the server owner to set " +
          "UPSTASH_REDIS_REST_URL / TOKEN for permanent accounts.");
        statusBox.appendChild(warn);
      }
      me(true).then(function (user) {
        statusBox.innerHTML = "";
        if (!st.persistent) {
          statusBox.appendChild(el("p", "auth-warn",
            "Note: this server has no persistent database — accounts may reset " +
            "when the server sleeps."));
        }
        if (user) renderProfile(statusBox, view, user);
        else renderLogin(statusBox, view, st);
      });
    });
  }

  function renderLogin(box, view, st) {
    box.appendChild(el("h2", null, "Log in to NEUTRON"));
    box.appendChild(el("p", "muted small",
      "Your profile gets a unique @username you can share so friends can connect with you."));
    resolveAuthBase().then(function (base) {
      if (base === AUTH_FALLBACK_BASE) {
        box.appendChild(el("p", "muted small",
          "Using your Node server for accounts."));
      }
    });

    // Google
    if (st.google && st.googleClientId) {
      var gbox = el("div", "auth-block");
      var googleLogin = function (idToken) {
        apiAuth("POST", "/api/auth/google", { idToken: idToken }).then(function (d) {
          loginDone(d.user, d.token);
        }).catch(function (e) { toast(String((e && e.message) || e)); });
      };
      // Called by the native shell after system-browser OAuth completes.
      window.NeutronAuth.nativeGoogleToken = function (idToken) {
        if (idToken) googleLogin(idToken);
        else toast("Google sign-in was cancelled.");
      };
      // In the Android app, use the native flow: system browser shows the
      // device's Gmail accounts (account picker) instead of a typed login.
      var bridge = null;
      try { bridge = window.NeutronApp; } catch (e) {}
      if (bridge && typeof bridge.googleSignIn === "function") {
        var nBtn = el("button", "btn primary auth-google-native", "Continue with Google");
        nBtn.onclick = function () {
          toast("Opening Google sign-in…");
          try { bridge.googleSignIn(); } catch (e) {
            toast("Couldn't open Google sign-in.");
          }
        };
        gbox.appendChild(nBtn);
        gbox.appendChild(el("p", "muted small", "Sign in with your phone's Google account."));
      } else {
        renderGoogleButton(gbox, st.googleClientId, googleLogin);
      }
      box.appendChild(gbox);
    } else {
      box.appendChild(el("p", "muted small",
        "Google login isn't configured on this server yet (needs GOOGLE_CLIENT_ID)."));
    }

    var orRow = el("div", "auth-or", "or");
    box.appendChild(orRow);

    // Email tabs
    var tabs = el("div", "auth-tabs");
    var loginTab = el("button", "btn sm auth-tab active", "Log in");
    var regTab = el("button", "btn sm auth-tab", "Sign up");
    tabs.appendChild(loginTab); tabs.appendChild(regTab);
    box.appendChild(tabs);
    var formBox = el("div", "auth-block");
    box.appendChild(formBox);

    function emailForm(isRegister) {
      formBox.innerHTML = "";
      var emailI = el("input", "input"); emailI.placeholder = "Email"; emailI.type = "email";
      emailI.setAttribute("aria-label", "Email");
      var passI = el("input", "input"); passI.placeholder = "Password (8+ chars)"; passI.type = "password";
      passI.setAttribute("aria-label", "Password");
      formBox.appendChild(emailI); formBox.appendChild(passI);
      var userI = null;
      if (isRegister) {
        userI = el("input", "input"); userI.placeholder = "Username (3-24, letters/numbers/_/.)";
        userI.setAttribute("aria-label", "Username");
        formBox.appendChild(userI);
        var nameI = el("input", "input"); nameI.placeholder = "Display name (optional)";
        nameI.setAttribute("aria-label", "Display name");
        formBox.appendChild(nameI);
      }
      var go = el("button", "btn primary", isRegister ? "Create account" : "Log in");
      formBox.appendChild(go);
      var err = el("p", "auth-err hidden");
      formBox.appendChild(err);
      function fail(m) { err.textContent = m; err.classList.remove("hidden"); }
      go.onclick = function () {
        err.classList.add("hidden");
        go.disabled = true;
        var done = function () { go.disabled = false; };
        if (isRegister) {
          apiAuth("POST", "/api/auth/register", {
            email: emailI.value.trim(), password: passI.value,
            username: userI.value.trim(), displayName: nameI.value.trim(),
          }).then(function (d) {
            done();
            loginDone(d.user, d.token);
            // Prompt to verify the email address.
            setTimeout(function () {
              toast(d.mailSent
                ? "Account created! Check your inbox to verify your email."
                : "Account created! Email verification is pending — check Account for status.");
            }, 400);
          }).catch(function (e) { done(); fail(String((e && e.message) || e)); });
        } else {
          apiAuth("POST", "/api/auth/login", {
            login: emailI.value.trim(), password: passI.value,
          }).then(function (d) { done(); loginDone(d.user, d.token); })
            .catch(function (e) { done(); fail(String((e && e.message) || e)); });
        }
      };
    }
    loginTab.onclick = function () {
      loginTab.classList.add("active"); regTab.classList.remove("active");
      emailForm(false);
    };
    regTab.onclick = function () {
      regTab.classList.add("active"); loginTab.classList.remove("active");
      emailForm(true);
    };
    emailForm(false);

    box.appendChild(el("div", "auth-or", "or"));
    var guestBtn = el("button", "btn", "Continue as guest");
    guestBtn.onclick = function () {
      guestBtn.disabled = true;
      var uname = "guest" + Math.floor(1000 + Math.random() * 9000);
      apiAuth("POST", "/api/auth/guest", { username: uname }).then(function (d) {
        loginDone(d.user, d.token);
      }).catch(function (e) {
        guestBtn.disabled = false;
        toast(String((e && e.message) || e));
      });
    };
    box.appendChild(guestBtn);
    box.appendChild(el("p", "muted small", "Guest is instant — no email needed. You can set your username after."));
  }

  function renderProfile(box, view, user) {
    var head = el("div", "auth-head");
    var av = el("div", "auth-avatar", (user.displayName || user.username || "?").slice(0, 1).toUpperCase());
    if (user.avatarUrl) {
      av.textContent = "";
      var img = document.createElement("img");
      img.src = user.avatarUrl; img.alt = "";
      av.appendChild(img);
    }
    head.appendChild(av);
    var idbox = el("div");
    idbox.appendChild(el("div", "auth-display", user.displayName || user.username));
    idbox.appendChild(el("div", "auth-username", "@" + user.username));
    if (user.bio) idbox.appendChild(el("div", "auth-bio", user.bio));
    idbox.appendChild(el("span", "auth-provider", user.provider === "google" ? "Google"
      : user.provider === "email" ? "Email" : "Guest"));
    // Email verification status.
    if (user.provider === "email") {
      if (user.emailVerified) {
        var vb = el("span", "auth-verified", "✓ Verified");
        vb.style.marginLeft = "6px";
        idbox.appendChild(vb);
      } else {
        var vw = el("div", "auth-unverified");
        vw.appendChild(el("span", null, "⚠ Email not verified — "));
        var rsBtn = el("button", "btn sm linklike", "resend link");
        rsBtn.onclick = function () {
          rsBtn.disabled = true;
          // The resend endpoint takes the email; use the stored user email.
          apiAuth("POST", "/api/auth/resend-verification", { email: user.email || "" })
            .then(function () { toast("Verification email sent — check your inbox."); })
            .catch(function (e) { toast(String((e && e.message) || e)); })
            .finally(function () { rsBtn.disabled = false; });
        };
        vw.appendChild(rsBtn);
        idbox.appendChild(vw);
      }
    }
    head.appendChild(idbox);
    box.appendChild(head);

    var shareBtn = el("button", "btn sm", "Share my profile");
    shareBtn.onclick = function () {
      var text = "Connect with me on NEUTRON: @" + user.username;
      try {
        var bridge = window.NeutronApp;
        if (bridge && typeof bridge.shareText === "function") {
          bridge.shareText("Share profile", text);
          toast("Opening share…");
          return;
        }
      } catch (e) {}
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          toast("Profile link copied to clipboard.");
        }).catch(function () { toast(text); });
      } else toast(text);
    };
    box.appendChild(shareBtn);

    // Edit profile
    var editBtn = el("button", "btn sm ghost", "Edit profile");
    editBtn.onclick = function () { renderEditProfile(view, user); };
    box.appendChild(editBtn);

    var outBtn = el("button", "btn sm ghost", "Log out");
    outBtn.onclick = function () {
      apiAuth("POST", "/api/auth/logout").catch(function () {}).finally(function () {
        setToken("");
        // Stop the friend-request poller.
        try {
          if (window.NeutronAuth._reqPoll) {
            clearInterval(window.NeutronAuth._reqPoll);
            window.NeutronAuth._reqPoll = null;
          }
        } catch (e) {}
        renderAccount(view);
        toast("Logged out.");
      });
    };
    box.appendChild(outBtn);

    // Connections
    var connBox = el("div", "panel");
    connBox.appendChild(el("h2", null, "Connections"));
    view.appendChild(connBox);
    renderConnections(connBox, user);

    // Who viewed my profile
    var viewsBox = el("div", "panel");
    viewsBox.appendChild(el("h2", null, "Who viewed your profile"));
    view.appendChild(viewsBox);
    renderProfileViews(viewsBox);
  }

  /** #/verify?token=xxx — email verification landing page. */
  function renderVerify(view) {
    view.innerHTML = "";
    view.appendChild(el("h1", null, "Verify email"));
    var box = el("div", "panel");
    box.appendChild(el("p", "muted", "Checking your verification link…"));
    view.appendChild(box);
    var m = (location.hash.match(/token=([^&]+)/) || [])[1];
    var token = m ? decodeURIComponent(m) : "";
    if (!token) {
      box.innerHTML = "";
      box.appendChild(el("p", "auth-err", "No verification token in the link."));
      return;
    }
    apiAuth("GET", "/api/auth/verify?token=" + encodeURIComponent(token)).then(function (d) {
      box.innerHTML = "";
      box.appendChild(el("p", null, "✓ Your email is verified, " + (d.user.displayName || d.user.username) + "!"));
      var go = el("button", "btn primary", "Go to Account");
      go.onclick = function () { location.hash = "#/account"; };
      box.appendChild(go);
      // Refresh the cached user so the ✓ badge appears without a reload.
      try {
        if (ME_CACHE && ME_CACHE.id === d.user.id) ME_CACHE = d.user;
      } catch (e) {}
    }).catch(function (e) {
      box.innerHTML = "";
      box.appendChild(el("p", "auth-err", String((e && e.message) || e)));
      box.appendChild(el("p", "muted small", "The link may have expired — request a new one from Account."));
    });
  }
  /** Show another user's public profile; records the view. */
  function viewUserProfile(username) {
    apiAuth("GET", "/api/auth/profile?u=" + encodeURIComponent(username)).then(function (d) {
      var p = d.profile;
      if (!p) { toast("User not found."); return; }
      // Record the view (fire and forget).
      apiAuth("POST", "/api/auth/profile/view", { username: p.username }).catch(function () {});
      var overlay = el("div", "auth-overlay");
      var card = el("div", "panel auth-profile-card");
      var close = el("button", "btn sm ghost auth-close", "✕");
      close.setAttribute("aria-label", "Close profile");
      close.onclick = function () { closeOverlay(); };
      card.appendChild(close);
      var head = el("div", "auth-head");
      head.appendChild(el("div", "auth-avatar", (p.displayName || p.username || "?").slice(0, 1).toUpperCase()));
      var idbox = el("div");
      idbox.appendChild(el("div", "auth-display", p.displayName || p.username));
      idbox.appendChild(el("div", "auth-username", "@" + p.username));
      if (p.bio) idbox.appendChild(el("div", "auth-bio", p.bio));
      head.appendChild(idbox);
      card.appendChild(head);
      var conn = el("button", "btn primary sm", "Send friend request");
      conn.onclick = function () {
        apiAuth("POST", "/api/connections/request", { username: p.username }).then(function () {
          toast("Request sent to @" + p.username + ".");
          conn.disabled = true;
          conn.textContent = "Sent";
        }).catch(function (e) { toast(String((e && e.message) || e)); });
      };
      card.appendChild(conn);
      overlay.appendChild(card);
      var closeOverlay = function () {
        try { document.body.removeChild(overlay); } catch (e) {}
        document.removeEventListener("keydown", onKey);
      };
      var onKey = function (ev) {
        if (ev.key === "Escape") closeOverlay();
      };
      document.addEventListener("keydown", onKey);
      overlay.onclick = function (ev) {
        if (ev.target === overlay) closeOverlay();
      };
      document.body.appendChild(overlay);
    }).catch(function (e) { toast(String((e && e.message) || e)); });
  }

  function timeAgo(ts) {    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  function renderProfileViews(box) {
    box.appendChild(el("p", "muted small", "Loading…"));
    apiAuth("GET", "/api/auth/profile/views").then(function (d) {
      box.innerHTML = "";
      box.appendChild(el("h2", null, "Who viewed your profile"));
      var views = d.views || [];
      if (!views.length) {
        box.appendChild(el("p", "muted small",
          "No views yet. Share your @username so people can find you."));
        return;
      }
      views.forEach(function (v) {
        var row = el("div", "friend-row");
        var info = el("div", "friend-info");
        info.appendChild(el("div", "friend-name", v.viewer.displayName || v.viewer.username));
        info.appendChild(el("div", "muted small", "@" + v.viewer.username + " · " + timeAgo(v.viewedAt)));
        row.appendChild(info);
        box.appendChild(row);
      });
    }).catch(function () {
      box.innerHTML = "";
      box.appendChild(el("h2", null, "Who viewed your profile"));
      box.appendChild(el("p", "muted small", "Couldn't load views."));
    });
  }

  function renderEditProfile(view, user) {
    view.innerHTML = "";
    view.appendChild(el("h1", null, "Edit profile"));
    var box = el("div", "panel");
    view.appendChild(box);
    var nameI = el("input", "input"); nameI.value = user.displayName || "";
    nameI.placeholder = "Display name"; nameI.setAttribute("aria-label", "Display name");
    var userI = el("input", "input"); userI.value = user.username || "";
    userI.placeholder = "Username"; userI.setAttribute("aria-label", "Username");
    var bioI = document.createElement("textarea");
    bioI.className = "input"; bioI.value = user.bio || "";
    bioI.placeholder = "Bio — tell people who you are (160 chars)";
    bioI.setAttribute("aria-label", "Bio"); bioI.rows = 3; bioI.maxLength = 160;
    box.appendChild(nameI); box.appendChild(userI); box.appendChild(bioI);
    var err = el("p", "auth-err hidden"); box.appendChild(err);
    var save = el("button", "btn primary", "Save");
    save.onclick = function () {
      err.classList.add("hidden");
      apiAuth("POST", "/api/auth/me/update", {
        displayName: nameI.value.trim(), username: userI.value.trim(),
        bio: bioI.value.trim(),
      }).then(function (d) {
        ME_CACHE = d.user;
        toast("Profile updated.");
        renderAccount(view);
      }).catch(function (e) {
        err.textContent = String((e && e.message) || e);
        err.classList.remove("hidden");
      });
    };
    box.appendChild(save);
    var back = el("button", "btn ghost", "Back");
    back.onclick = function () { renderAccount(view); };
    box.appendChild(back);
  }

  function renderConnections(box, user) {
    var reqBox = el("div");
    box.appendChild(reqBox);
    var listBox = el("div");
    box.appendChild(listBox);

    function refresh() {
      reqBox.innerHTML = ""; listBox.innerHTML = "";
      reqBox.appendChild(el("p", "muted small", "Loading requests…"));
      listBox.appendChild(el("p", "muted small", "Loading friends…"));
      apiAuth("GET", "/api/connections/requests").then(function (d) {
        reqBox.innerHTML = "";
        var reqs = d.requests || [];
        if (reqs.length) {
          reqBox.appendChild(el("h3", null, "Requests (" + reqs.length + ")"));
          reqs.forEach(function (r) {
            var row = el("div", "friend-row panel");
            row.appendChild(el("div", "friend-info",
              (r.from.displayName || r.from.username) + " (@" + r.from.username + ")"));
            var acts = el("div", "friend-actions");
            var ok = el("button", "btn primary sm", "Accept");
            ok.onclick = function () {
              apiAuth("POST", "/api/connections/respond", { id: r.id, accept: true })
                .then(function () { toast("Connected."); refresh(); })
                .catch(function (e) { toast(String((e && e.message) || e)); });
            };
            var no = el("button", "btn sm ghost", "Decline");
            no.onclick = function () {
              apiAuth("POST", "/api/connections/respond", { id: r.id, accept: false })
                .then(function () { refresh(); })
                .catch(function (e) { toast(String((e && e.message) || e)); });
            };
            acts.appendChild(ok); acts.appendChild(no);
            row.appendChild(acts);
            reqBox.appendChild(row);
          });
        }
      }).catch(function (e) {
        reqBox.innerHTML = "";
        reqBox.appendChild(el("p", "auth-err small", "Couldn't load requests."));
      });

      apiAuth("GET", "/api/connections").then(function (d) {
        listBox.innerHTML = "";
        var conns = d.connections || [];
        listBox.appendChild(el("h3", null, "Friends (" + conns.length + ")"));
        if (!conns.length) {
          listBox.appendChild(el("p", "muted small",
            "No connections yet. Share your @username and ask friends to send you a request."));
        }
        conns.forEach(function (c) {
          var row = el("div", "friend-row panel");
          var info = el("div", "friend-info");
          info.appendChild(el("div", "friend-name", c.peer.displayName || c.peer.username));
          info.appendChild(el("div", "muted small", "@" + c.peer.username));
          row.appendChild(info);
          var acts = el("div", "friend-actions");
          var callBtn = el("button", "btn primary sm", "\u260E Call");
          callBtn.onclick = function () {
            // Hand off to the local friends "call" flow with a room invite.
            try {
              if (window.NeutronFriends && window.NeutronRooms) {
                var R = window.NeutronRooms;
                var code = R.createRelayRoom ? R.createRelayRoom("Call with " + (c.peer.displayName || c.peer.username)) : null;
                if (code && R.openRelayRoom) {
                  R.openRelayRoom(code);
                  location.hash = "#/rooms";
                  toast("Room created. Tap the phone icon for voice.");
                  return;
                }
              }
            } catch (e) {}
            location.hash = "#/rooms";
          };
          acts.appendChild(callBtn);
          var rm = el("button", "btn sm ghost", "Remove");
          rm.onclick = function () {
            if (!window.confirm || confirm("Remove @" + c.peer.username + "?")) {
              apiAuth("POST", "/api/connections/remove", { id: c.id })
                .then(function () { refresh(); })
                .catch(function (e) { toast(String((e && e.message) || e)); });
            }
          };
          acts.appendChild(rm);
          row.appendChild(acts);
          listBox.appendChild(row);
        });
      }).catch(function () {
        listBox.innerHTML = "";
        listBox.appendChild(el("p", "auth-err small", "Couldn't load friends."));
      });
    }

    // Find users by username, then send requests from results.
    var searchBox = el("div", "panel");
    searchBox.appendChild(el("h3", null, "Find people"));
    var searchRow = el("div", "friend-add");
    var sInput = el("input", "input");
    sInput.placeholder = "Search by username or name…";
    sInput.setAttribute("aria-label", "Search users");
    searchRow.appendChild(sInput);
    var sBtn = el("button", "btn primary sm", "Search");
    searchRow.appendChild(sBtn);
    searchBox.appendChild(searchRow);
    var sResults = el("div", "auth-search-results");
    searchBox.appendChild(sResults);
    var doSearch = function () {
      var q = sInput.value.trim();
      sResults.innerHTML = "";
      if (q.length < 2) {
        sResults.appendChild(el("p", "muted small", "Type at least 2 characters."));
        return;
      }
      sResults.appendChild(el("p", "muted small", "Searching…"));
      apiAuth("GET", "/api/auth/search?q=" + encodeURIComponent(q)).then(function (d) {
        sResults.innerHTML = "";
        var users = d.users || [];
        if (!users.length) {
          sResults.appendChild(el("p", "muted small", "No users found for \"" + q + "\"."));
          return;
        }
        users.forEach(function (u) {
          var row = el("div", "friend-row");
          var info = el("div", "friend-info");
          var nameEl = el("div", "friend-name auth-link", u.displayName || u.username);
          nameEl.style.cursor = "pointer";
          nameEl.onclick = function () { viewUserProfile(u.username); };
          info.appendChild(nameEl);
          info.appendChild(el("div", "muted small", "@" + u.username));
          if (u.bio) info.appendChild(el("div", "muted small auth-bio-sm", u.bio));
          row.appendChild(info);
          var add = el("button", "btn primary sm", "Connect");
          add.onclick = function () {
            add.disabled = true;
            apiAuth("POST", "/api/connections/request", { username: u.username }).then(function () {
              toast("Request sent to @" + u.username + ".");
              add.textContent = "Sent";
            }).catch(function (e) {
              add.disabled = false;
              toast(String((e && e.message) || e));
            });
          };
          row.appendChild(add);
          sResults.appendChild(row);
        });
      }).catch(function (e) {
        sResults.innerHTML = "";
        sResults.appendChild(el("p", "auth-err", String((e && e.message) || e)));
      });
    };
    sBtn.onclick = doSearch;
    sInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); doSearch(); }
    });
    // Live search as you type (debounced).
    var sTimer = null;
    sInput.addEventListener("input", function () {
      if (sTimer) clearTimeout(sTimer);
      sTimer = setTimeout(doSearch, 400);
    });
    box.appendChild(searchBox);
    refresh();

    // Poll for new incoming requests; toast when one arrives.
    if (window.NeutronAuth._reqPoll) clearInterval(window.NeutronAuth._reqPoll);
    var knownReqs = null;
    window.NeutronAuth._reqPoll = setInterval(function () {
      if (!getToken()) return;
      apiAuth("GET", "/api/connections/requests").then(function (d) {
        var ids = {};
        (d.requests || []).forEach(function (r) { ids[r.id] = r.from.username; });
        if (knownReqs !== null) {
          Object.keys(ids).forEach(function (id) {
            if (!knownReqs[id]) {
              toast("New friend request from @" + ids[id] + ".");
              try {
                if (window.NeutronUI && window.NeutronUI.notify) {
                  window.NeutronUI.notify("Friend request", "@" + ids[id] + " wants to connect.");
                }
              } catch (e) {}
              refresh();
            }
          });
        }
        knownReqs = ids;
      }).catch(function () {});
    }, 30000);
  }

  function teardown() { /* stateless */ }

  window.NeutronAuth = {
    renderAccount: renderAccount,
    renderVerify: renderVerify,
    teardown: teardown,
    me: me,
    getToken: getToken,
    authStatus: authStatus,
  };
})();
