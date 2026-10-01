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
    var btn = el("button", "btn auth-google", "Continue with Google");
    btn.onclick = function () {
      btn.disabled = true;
      btn.textContent = "Opening Google…";
      loadGis().then(function () {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: function (resp) {
            if (resp && resp.credential) onToken(resp.credential);
            else { btn.disabled = false; btn.textContent = "Continue with Google"; }
          },
          auto_select: false,
        });
        // Use the OAuth popup flow via a temporary button render.
        window.google.accounts.id.prompt(function (n) {
          if (n.isNotDisplayed() || n.isSkippedMoment()) {
            // Fallback: render an official button in a popup-friendly way.
            btn.disabled = false;
            btn.textContent = "Continue with Google";
            toast("Google sign-in was dismissed. Tap again to retry.");
          }
        });
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = "Continue with Google";
        toast(String((e && e.message) || e));
      });
    };
    box.appendChild(btn);
    box.appendChild(el("p", "muted small", "Google verifies your identity; NEUTRON never sees your password."));
  }

  /* ---------- screens ---------- */

  function renderAccount(view) {
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
      renderGoogleButton(gbox, st.googleClientId, function (idToken) {
        apiAuth("POST", "/api/auth/google", { idToken: idToken }).then(function (d) {
          loginDone(d.user, d.token);
        }).catch(function (e) { toast(String((e && e.message) || e)); });
      });
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
          }).then(function (d) { done(); loginDone(d.user, d.token); })
            .catch(function (e) { done(); fail(String((e && e.message) || e)); });
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
    idbox.appendChild(el("span", "auth-provider", user.provider === "google" ? "Google"
      : user.provider === "email" ? "Email" : "Guest"));
    head.appendChild(idbox);
    box.appendChild(head);

    var shareBtn = el("button", "btn sm", "Share my profile");
    shareBtn.onclick = function () {
      var text = "Connect with me on NEUTRON: @" + user.username;
      try {
        var bridge = window.NeutronApp;
        if (bridge && typeof bridge.shareText === "function") { bridge.shareText("Share profile", text); return; }
      } catch (e) {}
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { toast("Profile copied."); });
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
    box.appendChild(nameI); box.appendChild(userI);
    var err = el("p", "auth-err hidden"); box.appendChild(err);
    var save = el("button", "btn primary", "Save");
    save.onclick = function () {
      err.classList.add("hidden");
      apiAuth("POST", "/api/auth/me/update", {
        displayName: nameI.value.trim(), username: userI.value.trim(),
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
      apiAuth("GET", "/api/connections/requests").then(function (d) {
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
      }).catch(function () {});

      apiAuth("GET", "/api/connections").then(function (d) {
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
      }).catch(function () {});
    }

    // Add by username
    var addRow = el("div", "friend-add");
    var uInput = el("input", "input");
    uInput.placeholder = "@username to connect with";
    uInput.setAttribute("aria-label", "Username");
    addRow.appendChild(uInput);
    var addBtn = el("button", "btn primary sm", "Send request");
    addRow.appendChild(addBtn);
    var doReq = function () {
      var u = uInput.value.trim().replace(/^@/, "");
      if (!u) { toast("Enter a username."); return; }
      apiAuth("POST", "/api/connections/request", { username: u }).then(function () {
        uInput.value = "";
        toast("Request sent to @" + u + ".");
        refresh();
      }).catch(function (e) { toast(String((e && e.message) || e)); });
    };
    addBtn.onclick = doReq;
    uInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); doReq(); }
    });
    box.appendChild(addRow);
    refresh();
  }

  function teardown() { /* stateless */ }

  window.NeutronAuth = {
    renderAccount: renderAccount,
    teardown: teardown,
    me: me,
    getToken: getToken,
    authStatus: authStatus,
  };
})();
