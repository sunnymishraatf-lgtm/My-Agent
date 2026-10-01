/* ==========================================================================
   NEUTRON app — vanilla JS SPA (no build step).
   All dynamic text is set via textContent (never innerHTML with server data).

   ONE backend surface: /api/demo/* + /api/health + /api/chat. These routes
   exist on BOTH the persistent Node server and the Vercel serverless
   deployment, so this exact UI works everywhere (browser, APK wrapper).

   BYOK: a provider API key saved in Settings lives in localStorage and
   is sent as the `x-api-key` header with every request. It is never stored
   on the server — each request builds a request-scoped provider config.
   There is NO default provider: the user must pick one explicitly in
   Settings (sent as the `x-provider` header); chat refuses to send until
   a provider is chosen.

   DEVELOPER MODE (Settings): optional backend URL override
   (localStorage neutron_backend_url; empty = same-origin), a client-side
   API inspector (last 50 calls, secrets redacted), and verbose logging.
   ========================================================================== */
"use strict";

/* Persistent storage mirror (Android APK only).
   Every localStorage write is mirrored to the native SharedPreferences
   bridge, and reads prefer the native copy. SharedPreferences survives
   even if the WebView's own storage is wiped, so user data (history,
   playlists, theme, keys, friends) is never lost on restart. No-op on
   plain browsers. Patched on the localStorage instance only — never the
   Storage prototype — so sessionStorage keeps its session-only semantics. */
(function () {
  try {
    var bridge = window.NeutronApp;
    var ls = window.localStorage;
    if (!bridge || typeof bridge.nativeSave !== "function" || !ls || ls.__neutronMirrored) return;
    ls.__neutronMirrored = true;
    var rawSet = ls.setItem.bind(ls);
    var rawGet = ls.getItem.bind(ls);
    var rawRemove = ls.removeItem.bind(ls);
    ls.setItem = function (k, v) {
      try { bridge.nativeSave(String(k), String(v)); } catch (e) { /* ignore */ }
      return rawSet(k, v);
    };
    ls.getItem = function (k) {
      try {
        var nv = bridge.nativeLoad(String(k));
        if (nv !== null && nv !== undefined) return nv;
      } catch (e) { /* ignore */ }
      return rawGet(k);
    };
    ls.removeItem = function (k) {
      try { bridge.nativeRemove(String(k)); } catch (e) { /* ignore */ }
      return rawRemove(k);
    };
  } catch (e) { /* storage unavailable — app continues on localStorage */ }
})();

/* ---------- helpers ---------- */

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ----- BYOK key storage (localStorage only, never sent anywhere except
   as the x-api-key header on the user's own requests) ----- */
var API_KEY_STORAGE = "neutron_api_key";
var PROVIDER_STORAGE = "neutron_provider";
var MODEL_STORAGE = "neutron_model";
var JOB_HISTORY_STORAGE = "neutron_jobs";
var BACKEND_URL_STORAGE = "neutron_backend_url";
var VERBOSE_STORAGE = "neutron_verbose";

function storedApiKey() {
  try { return localStorage.getItem(API_KEY_STORAGE) || ""; } catch (e) { return ""; }
}
function setStoredApiKey(k) {
  try { localStorage.setItem(API_KEY_STORAGE, k); } catch (e) { /* private mode */ }
}
function clearStoredApiKey() {
  try { localStorage.removeItem(API_KEY_STORAGE); } catch (e) { /* private mode */ }
}
function storedProvider() {
  try { return localStorage.getItem(PROVIDER_STORAGE) || ""; } catch (e) { return ""; }
}
function setStoredProvider(id) {
  try {
    if (id) localStorage.setItem(PROVIDER_STORAGE, id);
    else localStorage.removeItem(PROVIDER_STORAGE);
  } catch (e) { /* private mode */ }
}
function storedModel() {
  try { return localStorage.getItem(MODEL_STORAGE) || ""; } catch (e) { return ""; }
}
function setStoredModel(m) {
  try {
    if (m) localStorage.setItem(MODEL_STORAGE, m);
    else localStorage.removeItem(MODEL_STORAGE);
  } catch (e) { /* private mode */ }
}
/* ----- Model router / usage / cost-control storage (Phases 21/23/31).
   All device-local. Rates are the USER's own $/1M-token figures; usage
   token counts come only from provider API responses. ----- */
function lsGet(k) {
  try { return localStorage.getItem(k); } catch (e) { return null; }
}
function lsSet(k, v) {
  try {
    if (v === null || v === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch (e) { /* private mode */ }
}
function routerMode() {
  var UI = window.NeutronUI;
  return UI ? UI.sanitizeRouterMode(lsGet(UI.ROUTER_MODE_KEY)) : "auto";
}
function loadRates() {
  var UI = window.NeutronUI;
  try {
    var raw = UI ? lsGet(UI.RATES_STORE_KEY) : null;
    var r = raw ? JSON.parse(raw) : {};
    if (!r || typeof r !== "object") return {};
    /* Scrub to { modelId: { in, out } } with validated numbers only. */
    var out = {};
    Object.keys(r).forEach(function (k) {
      var v = r[k];
      if (v && typeof v === "object") {
        var ri = UI.validateRate(v.in), ro = UI.validateRate(v.out);
        if (ri != null && ro != null && k) out[k] = { in: ri, out: ro };
      }
    });
    return out;
  } catch (e) { return {}; }
}
function saveRates(rates) { var UI = window.NeutronUI; if (UI) lsSet(UI.RATES_STORE_KEY, JSON.stringify(rates || {})); }
function loadBudget() {
  var UI = window.NeutronUI;
  if (!UI) return { daily: null, monthly: null };
  try { return UI.sanitizeBudget(JSON.parse(lsGet(UI.BUDGET_STORE_KEY) || "{}")); }
  catch (e) { return { daily: null, monthly: null }; }
}
function loadMaxTokens() {
  var UI = window.NeutronUI;
  return UI ? UI.sanitizeMaxTokens(lsGet(UI.MAXTOK_STORE_KEY)) : null;
}
function loadUsageLog() {
  var UI = window.NeutronUI;
  if (!UI) return [];
  try {
    var raw = lsGet(UI.USAGE_STORE_KEY);
    var log = raw ? JSON.parse(raw) : [];
    return Array.isArray(log) ? log.filter(function (e) { return UI.sanitizeUsageEntry(e); }) : [];
  } catch (e) { return []; }
}
/** Append one usage entry to the device-local log (capped). Never throws. */
function recordUsage(entry) {
  var UI = window.NeutronUI;
  if (!UI) return;
  try {
    var log = loadUsageLog();
    lsSet(UI.USAGE_STORE_KEY, JSON.stringify(UI.usageAdd(log, entry)));
  } catch (e) { /* best-effort */ }
}
/** Estimated spend (dollars) over the last `days` days, from user rates. */
function periodSpend(log, rates, days) {
  var UI = window.NeutronUI;
  if (!UI) return { dollars: 0, costed: 0, skipped: 0 };
  var now = Date.now();
  var d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  var cutoff = d0.getTime() - (days - 1) * 86400000;
  var entries = (Array.isArray(log) ? log : []).filter(function (e) { return e && e.ts >= cutoff; });
  return UI.sumEstimatedSpend(entries, rates);
}
/** Budget gate for a chat send. True = proceed. Warns at 80%, confirms at 100%. */
function budgetCheck() {
  var UI = window.NeutronUI;
  if (!UI) return true;
  var b = loadBudget();
  if (!b.daily && !b.monthly) return true;
  var log = loadUsageLog();
  var rates = loadRates();
  function money(n) { return "$" + n.toFixed(2); }
  if (b.daily) {
    var s = periodSpend(log, rates, 1);
    var st = UI.budgetStatus(s.dollars, b.daily);
    if (st === "over") {
      return window.confirm(
        "Over daily budget (" + money(s.dollars) + " of " + money(b.daily) +
        " estimated from your rates). Send anyway?");
    }
    if (st === "warn") toast("Approaching daily budget: " + money(s.dollars) + " of " + money(b.daily) + " estimated.");
  }
  if (b.monthly) {
    var m = periodSpend(log, rates, 30);
    var mst = UI.budgetStatus(m.dollars, b.monthly);
    if (mst === "over") {
      return window.confirm(
        "Over monthly budget (" + money(m.dollars) + " of " + money(b.monthly) +
        " estimated from your rates). Send anyway?");
    }
    if (mst === "warn") toast("Approaching monthly budget: " + money(m.dollars) + " of " + money(b.monthly) + " estimated.");
  }
  return true;
}

/* ----- Developer Mode storage (all client-side) ----- */
function storedBackendUrl() {
  try { return (localStorage.getItem(BACKEND_URL_STORAGE) || "").trim(); } catch (e) { return ""; }
}
function setStoredBackendUrl(u) {
  try {
    if (u) localStorage.setItem(BACKEND_URL_STORAGE, u);
    else localStorage.removeItem(BACKEND_URL_STORAGE);
  } catch (e) { /* private mode */ }
}
/** The base every api() call is made against. Empty = same-origin (automatic). */
function backendBase() {
  return storedBackendUrl().replace(/\/+$/, "");
}
function isVerbose() {
  try { return localStorage.getItem(VERBOSE_STORAGE) === "1"; } catch (e) { return false; }
}
function setVerbose(on) {
  try { localStorage.setItem(VERBOSE_STORAGE, on ? "1" : "0"); } catch (e) { /* private mode */ }
}
/* ----- Theme (Appearance): 148 named themes + System. Stored as the theme
   name or "system"; applied via the data-theme attribute. ----- */
var THEME_STORAGE = "neutron_theme";
var THEMES = [
  { id: "light", name: "Light", swatch: ["#FFFFFF", "#CC8066", "#191C21"] },
  { id: "dark", name: "Dark", swatch: ["#0E1013", "#CC8066", "#171B21"] },
  { id: "ocean", name: "Ocean", swatch: ["#FFFFFF", "#0891B2", "#0B2A33"] },
  { id: "deep-ocean", name: "Deep Ocean", swatch: ["#060D16", "#38BDF8", "#0D1725"] },
  { id: "sunset", name: "Sunset", swatch: ["#FFFBF6", "#DE6B48", "#2B1C14"] },
  { id: "forest", name: "Forest", swatch: ["#FCFDFC", "#2F9E5F", "#132219"] },
  { id: "lavender", name: "Lavender", swatch: ["#FBFAFF", "#8B5CF6", "#241B3D"] },
  { id: "rose", name: "Rose", swatch: ["#FFFBFC", "#F43F5E", "#2E1420"] },
  { id: "mint", name: "Mint", swatch: ["#FAFEFB", "#10B981", "#0E241C"] },
  { id: "slate", name: "Slate", swatch: ["#F8FAFC", "#475569", "#1E293B"] },
  { id: "midnight", name: "Midnight", swatch: ["#0A0A17", "#818CF8", "#141428"] },
  { id: "crimson", name: "Crimson Night", swatch: ["#120709", "#FB4D6D", "#211016"] },
  { id: "amber", name: "Amber Glow", swatch: ["#100C06", "#F59E0B", "#1E1608"] },
  { id: "grape", name: "Grape", swatch: ["#0F0718", "#A855F7", "#1D0F2E"] },
  { id: "glass-dark", name: "Glass Dark",
    swatch: ["#0A0D13", "#CC8066", "#3A4356"],
    preview: "linear-gradient(135deg,#0A0D13 0%,#121A2B 48%,#1C1428 100%)" },
  { id: "glass-ocean", name: "Glass Ocean",
    swatch: ["#03101D", "#5BC8F5", "#2E4F73"],
    preview: "linear-gradient(135deg,#03101D 0%,#062A44 52%,#0B3F63 100%)" },
  { id: "glass-sunset", name: "Glass Sunset",
    swatch: ["#221004", "#FB923C", "#5C2E0C"],
    preview: "linear-gradient(135deg,#221004 0%,#3A1D08 52%,#5C2E0C 100%)" },
  { id: "glass-rose", name: "Glass Rose",
    swatch: ["#20060F", "#F472B6", "#5E1636"],
    preview: "linear-gradient(135deg,#20060F 0%,#3D0E22 52%,#5E1636 100%)" },
  { id: "sky", name: "Sky Blue", swatch: ["#F5FAFD", "#0284C7", "#012538"] },
  { id: "teal", name: "Teal Wave", swatch: ["#F5FBFA", "#0D9488", "#042926"] },
  { id: "lime", name: "Lime Pop", swatch: ["#F9FBF5", "#65A30D", "#1C2E04"] },
  { id: "peach", name: "Peach Sorbet", swatch: ["#FEF8F5", "#EA580C", "#421903"] },
  { id: "blush", name: "Blush", swatch: ["#FEF6FA", "#DB2777", "#3D0B21"] },
  { id: "indigo", name: "Indigo Ink", swatch: ["#F8F8FE", "#4F46E5", "#161440"] },
  { id: "sand", name: "Desert Sand", swatch: ["#FBF7F5", "#92400E", "#291204"] },
  { id: "cyan", name: "Cyan Breeze", swatch: ["#F5FCFD", "#06B6D4", "#02333B"] },
  { id: "berry", name: "Berry", swatch: ["#FBF6F8", "#9D174D", "#2C0616"] },
  { id: "gold", name: "Golden Hour", swatch: ["#FCF8F5", "#B45309", "#321703"] },
  { id: "lilac", name: "Lilac Dream", swatch: ["#FAF7FE", "#7C3AED", "#231042"] },
  { id: "cream", name: "Cream", swatch: ["#FBF9F5", "#A16207", "#2D1B02"] },
  { id: "ice", name: "Ice Blue", swatch: ["#F6F9FE", "#2563EB", "#0A1C42"] },
  { id: "mauve", name: "Mauve", swatch: ["#FBF7FE", "#9333EA", "#290E42"] },
  { id: "olive", name: "Olive Grove", swatch: ["#F8FAF5", "#4D7C0F", "#162304"] },
  { id: "abyss", name: "Abyss", swatch: ["#020F11", "#22D3EE", "#072A30"] },
  { id: "ember", name: "Ember", swatch: ["#110802", "#F97316", "#321704"] },
  { id: "venom", name: "Venom", swatch: ["#0B1004", "#A3E635", "#212E0B"] },
  { id: "phantom", name: "Phantom", swatch: ["#100811", "#E879F9", "#2E1832"] },
  { id: "storm", name: "Storm", swatch: ["#070C12", "#60A5FA", "#132132"] },
  { id: "evergreen", name: "Evergreen", swatch: ["#040F0B", "#34D399", "#0A2A1F"] },
  { id: "wine", name: "Wine Cellar", swatch: ["#120809", "#FB7185", "#32171B"] },
  { id: "copper", name: "Copper", swatch: ["#100601", "#EA580C", "#2F1202"] },
  { id: "frost", name: "Frost", swatch: ["#090F12", "#7DD3FC", "#192A32"] },
  { id: "violet-night", name: "Violet Night", swatch: ["#0C0A12", "#A78BFA", "#211C32"] },
  { id: "magma", name: "Magma", swatch: ["#110505", "#EF4444", "#300E0E"] },
  { id: "deep-teal", name: "Deep Teal", swatch: ["#030F0D", "#2DD4BF", "#092A26"] },
  { id: "ghost", name: "Ghost", swatch: ["#0E0F10", "#CBD5E1", "#292B2D"] },
  { id: "plum-night", name: "Plum Night", swatch: ["#0D0912", "#C084FC", "#261A32"] },
  { id: "forest-night", name: "Forest Night", swatch: ["#051009", "#4ADE80", "#0F2C1A"] },
{ id: "arctic", name: "Arctic", swatch: ["#FFFFFF", "#2563EB", "#1E293B"] },
  { id: "skyline", name: "Skyline", swatch: ["#F5FAFE", "#0284C7", "#0A2A40"] },
  { id: "glacier", name: "Glacier", swatch: ["#F4FAFD", "#0EA5E9", "#0C2B3D"] },
  { id: "powder", name: "Powder Blue", swatch: ["#F8FAFE", "#60A5FA", "#1E2A3D"] },
  { id: "azure", name: "Azure", swatch: ["#F5F9FF", "#1D4ED8", "#1E2A4A"] },
  { id: "mist", name: "Mist", swatch: ["#F7F9FA", "#5B8DB8", "#1E2E3D"] },
  { id: "steel", name: "Steel", swatch: ["#F4F6F8", "#5B7FA6", "#1F2A36"] },
  { id: "seafoam", name: "Seafoam", swatch: ["#F7FDFB", "#0D9488", "#07332D"] },
  { id: "lagoon", name: "Lagoon", swatch: ["#EFFDFB", "#06B6D4", "#083344"] },
  { id: "jade", name: "Jade", swatch: ["#F5FBF8", "#059669", "#07352A"] },
  { id: "mint-chip", name: "Mint Chip", swatch: ["#F7FEFA", "#10B981", "#0B2E22"] },
  { id: "celadon", name: "Celadon", swatch: ["#F7FBF7", "#4FA383", "#1E332A"] },
  { id: "matcha", name: "Matcha", swatch: ["#F9FDF5", "#4D7C0F", "#1C2E06"] },
  { id: "meadow", name: "Meadow", swatch: ["#F6FBF4", "#16A34A", "#0F2E1A"] },
  { id: "kelp", name: "Kelp", swatch: ["#F5F9F3", "#3F6212", "#1E2E0C"] },
  { id: "pistachio", name: "Pistachio", swatch: ["#F8FBF3", "#6C9A0F", "#24330A"] },
  { id: "pine", name: "Pine", swatch: ["#F4F8F5", "#15803D", "#0C2B18"] },
  { id: "moss", name: "Moss", swatch: ["#F6F8F2", "#65A30D", "#232D0C"] },
  { id: "chartreuse", name: "Chartreuse", swatch: ["#FBFDF0", "#8AA30F", "#2E330A"] },
  { id: "lemon", name: "Lemon", swatch: ["#FFFDF5", "#CA8A04", "#3A2703"] },
  { id: "honey", name: "Honey", swatch: ["#FDFBF3", "#B45309", "#3A2403"] },
  { id: "butter", name: "Butter", swatch: ["#FFFDF0", "#B98A0B", "#3A2E02"] },
  { id: "vanilla", name: "Vanilla", swatch: ["#FDFBF7", "#A16207", "#2E1F04"] },
  { id: "dune", name: "Dune", swatch: ["#FAF6EF", "#92400E", "#33200A"] },
  { id: "sandstone", name: "Sandstone", swatch: ["#F8F4EC", "#A8845A", "#33291A"] },
  { id: "coral", name: "Coral", swatch: ["#FFFBF7", "#EA580C", "#3D1A06"] },
  { id: "apricot", name: "Apricot", swatch: ["#FEF6EF", "#EE7E22", "#3A2008"] },
  { id: "clay", name: "Clay", swatch: ["#FAF5F1", "#C2703D", "#2E1C0E"] },
  { id: "cherry", name: "Cherry", swatch: ["#FDF5F6", "#DC2626", "#3A0D0D"] },
  { id: "brick", name: "Brick", swatch: ["#FAF5F3", "#B91C1C", "#331212"] },
  { id: "blossom", name: "Blossom", swatch: ["#FFFBF5", "#EC4899", "#3A0F24"] },
  { id: "petal", name: "Petal", swatch: ["#FEF5F7", "#DB2777", "#3A0B1E"] },
  { id: "raspberry", name: "Raspberry", swatch: ["#FDF5F8", "#BE185D", "#330A1D"] },
  { id: "periwinkle", name: "Periwinkle", swatch: ["#F7F8FE", "#6366F1", "#1F1F3D"] },
  { id: "wisteria", name: "Wisteria", swatch: ["#F9F6FE", "#A78BFA", "#2A2140"] },
  { id: "iris", name: "Iris", swatch: ["#F6F4FD", "#7C3AED", "#221342"] },
  { id: "orchid", name: "Orchid", swatch: ["#FBF4FC", "#C026D3", "#330A2E"] },
  { id: "lilac-mist", name: "Lilac Mist", swatch: ["#F5F0FE", "#8B5CF6", "#241B3D"] },
  { id: "cotton", name: "Cotton", swatch: ["#FDFDFD", "#64748B", "#2A3442"] },
  { id: "fog", name: "Fog", swatch: ["#F5F7FA", "#7C8DA6", "#232D3A"] },
  { id: "stone", name: "Stone", swatch: ["#FAFAF9", "#78716C", "#292524"] },
  { id: "paper", name: "Paper", swatch: ["#FDFCF8", "#8A7E6B", "#2B2620"] },
  { id: "linen", name: "Linen", swatch: ["#FDFBF6", "#9A8C6E", "#2E2A22"] },
  { id: "alabaster", name: "Alabaster", swatch: ["#FCFCFA", "#8C8C94", "#26262B"] },
  { id: "eucalyptus", name: "Eucalyptus", swatch: ["#F4F9F6", "#5B9A8B", "#1E332C"] },
  { id: "marigold", name: "Marigold", swatch: ["#FFFBEB", "#C77E0A", "#3A2803"] },
  { id: "thistle", name: "Thistle", swatch: ["#FAF5FA", "#B794C7", "#2E2133"] },
  { id: "denim", name: "Denim", swatch: ["#F5F7FA", "#3B5BFD", "#1B2450"] },
  { id: "verdigris", name: "Verdigris", swatch: ["#F2FAF7", "#43B3A2", "#0E2E28"] },
  { id: "trench", name: "Trench", swatch: ["#020A12", "#22D3EE", "#072A33"] },
  { id: "nebula", name: "Nebula", swatch: ["#0A0A1A", "#818CF8", "#1A1A2E"] },
  { id: "sapphire", name: "Sapphire", swatch: ["#060B16", "#3B82F6", "#0D1B33"] },
  { id: "cobalt", name: "Cobalt", swatch: ["#080D18", "#60A5FA", "#12233D"] },
  { id: "twilight", name: "Twilight", swatch: ["#0D0D1A", "#6366F1", "#1C1C33"] },
  { id: "midnight-blue", name: "Midnight Blue", swatch: ["#060816", "#4F46E5", "#101230"] },
  { id: "tokyo", name: "Tokyo Night", swatch: ["#0A0A12", "#7AA2F7", "#14141F"] },
  { id: "night-owl", name: "Night Owl", swatch: ["#060814", "#82AAFF", "#0D1226"] },
  { id: "github-dark", name: "GitHub Dark", swatch: ["#0A0C10", "#58A6FF", "#12161C"] },
  { id: "one-dark", name: "One Dark", swatch: ["#0B0D12", "#61AFEF", "#12151C"] },
  { id: "glacier-night", name: "Glacier Night", swatch: ["#04101A", "#38BDF8", "#0B2233"] },
  { id: "frost-night", name: "Frost Night", swatch: ["#060E14", "#7DD3FC", "#10222E"] },
  { id: "lagoon-night", name: "Lagoon Night", swatch: ["#03120F", "#2DD4BF", "#0A2926"] },
  { id: "abyssal", name: "Abyssal", swatch: ["#02100E", "#14B8A6", "#072A26"] },
  { id: "solarized", name: "Solarized Dark", swatch: ["#001A1E", "#2AA198", "#07333A"] },
  { id: "nord", name: "Nord", swatch: ["#0B0E14", "#88C0D0", "#11161D"] },
  { id: "toxic", name: "Toxic", swatch: ["#0A0F04", "#A3E635", "#1E2A0C"] },
  { id: "jungle", name: "Jungle", swatch: ["#04120A", "#4ADE80", "#0D2B1A"] },
  { id: "moss-night", name: "Moss Night", swatch: ["#0A0F08", "#84CC16", "#1E2A10"] },
  { id: "monokai", name: "Monokai", swatch: ["#0A0A08", "#A6E22E", "#1A1A12"] },
  { id: "everforest", name: "Everforest", swatch: ["#0C0E0C", "#A7C080", "#161816"] },
  { id: "forest-deep", name: "Forest Deep", swatch: ["#030B06", "#34D399", "#0A241A"] },
  { id: "carbon", name: "Carbon", swatch: ["#0B0B0C", "#8E8E96", "#17171A"] },
  { id: "aubergine", name: "Aubergine", swatch: ["#0E0810", "#9D4EDD", "#200F2E"] },
  { id: "deep-space", name: "Deep Space", swatch: ["#04060E", "#00D4FF", "#0A1A2E"] },
  { id: "gold-night", name: "Gold Night", swatch: ["#100C04", "#FBBF24", "#2A2008"] },
  { id: "brass", name: "Brass", swatch: ["#0E0B05", "#D4A017", "#26200A"] },
  { id: "gruvbox", name: "Gruvbox", swatch: ["#0D0C0A", "#FABD2F", "#1D1A14"] },
  { id: "forge", name: "Forge", swatch: ["#100802", "#FB923C", "#2E1C0A"] },
  { id: "inferno", name: "Inferno", swatch: ["#120603", "#F97316", "#331505"] },
  { id: "blood", name: "Blood", swatch: ["#100505", "#EF4444", "#2E0E0E"] },
  { id: "maroon", name: "Maroon", swatch: ["#0E0608", "#F43F5E", "#2A0F16"] },
  { id: "ruby", name: "Ruby", swatch: ["#120609", "#FB7185", "#331019"] },
  { id: "synthwave", name: "Synthwave", swatch: ["#0F0520", "#FB7185", "#2A0A25"] },
  { id: "magenta", name: "Magenta", swatch: ["#10060E", "#F0ABFC", "#2E1030"] },
  { id: "plum-dark", name: "Plum Dark", swatch: ["#0D0810", "#E879F9", "#220F26"] },
  { id: "cyberpunk", name: "Cyberpunk", swatch: ["#0A0118", "#E879F9", "#1E0A33"] },
  { id: "ultraviolet", name: "Ultraviolet", swatch: ["#0C0716", "#A855F7", "#1E0F33"] },
  { id: "amethyst", name: "Amethyst", swatch: ["#0E0A14", "#C084FC", "#241A33"] },
  { id: "dracula", name: "Dracula", swatch: ["#0B0B12", "#BD93F9", "#1A1A26"] },
  { id: "catppuccin", name: "Catppuccin", swatch: ["#0B0B14", "#CBA6F7", "#15151F"] },
  { id: "palenight", name: "Pale Night", swatch: ["#0A0A12", "#C792EA", "#16161F"] },
  { id: "rose-pine", name: "Rosé Pine", swatch: ["#0E0C12", "#EBBCBA", "#1C1820"] },
  { id: "void", name: "Void", swatch: ["#050508", "#8A8AB8", "#14141C"] },
  { id: "kanagawa", name: "Kanagawa", swatch: ["#0A0A0E", "#7E9CD8", "#121218"] },
  { id: "obsidian", name: "Obsidian", swatch: ["#0A0A0B", "#71717A", "#18181B"] },
  { id: "charcoal", name: "Charcoal", swatch: ["#0C0C0D", "#A1A1AA", "#1C1C1F"] },
  { id: "onyx", name: "Onyx", swatch: ["#08080A", "#52525B", "#131316"] },
  { id: "espresso", name: "Espresso", swatch: ["#0C0906", "#A0785A", "#1E150E"] },
  { id: "slate-night", name: "Slate Night", swatch: ["#0A0E14", "#7C8DA6", "#141C28"] },
  { id: "ink", name: "Ink", swatch: ["#07090C", "#94A3B8", "#11161D"] },
];
var THEME_IDS = THEMES.map(function (t) { return t.id; });
function storedTheme() {
  try {
    var t = localStorage.getItem(THEME_STORAGE) || "system";
    return (t === "system" || THEME_IDS.indexOf(t) !== -1) ? t : "system";
  } catch (e) { return "system"; }
}
function setStoredTheme(t) {
  try {
    if (t && t !== "system") localStorage.setItem(THEME_STORAGE, t);
    else localStorage.setItem(THEME_STORAGE, "system");
  } catch (e) { /* private mode */ }
}
/** The concrete theme name to apply: "system" resolves via the OS. */
function resolveTheme(t) {
  if (t !== "system") return t;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch (e) { return "light"; }
}
function applyTheme() {
  try { document.documentElement.setAttribute("data-theme", resolveTheme(storedTheme())); }
  catch (e) { /* head script already set a sane default */ }
}
/* Follow the OS while "System" is selected. */
try {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
    if (storedTheme() === "system") applyTheme();
  });
} catch (e) { /* older browsers */ }
function jobHistory() {
  try {
    var NU = window.NeutronUI;
    var raw = localStorage.getItem(JOB_HISTORY_STORAGE);
    if (NU && NU.parseJobHistory) return NU.parseJobHistory(raw);
    var h = JSON.parse(raw || "[]");
    return Array.isArray(h) ? h : [];
  }
  catch (e) { return []; }
}
function recordJob(entry) {
  try {
    var h = jobHistory();
    h.unshift(entry);
    localStorage.setItem(JOB_HISTORY_STORAGE, JSON.stringify(h.slice(0, 50)));
  } catch (e) { /* private mode */ }
}

/* ----- API inspector: ring buffer of the last 50 calls (client-side only).
   Secrets are redacted before anything is stored for display. ----- */
var API_LOG = [];
var API_LOG_MAX = 50;

function redactSecrets(s) {
  var NU = window.NeutronUI;
  return (NU && NU.redactSecrets) ? NU.redactSecrets(s) : String(s);
}

function pushApiLog(entry) {
  API_LOG.unshift(entry);
  if (API_LOG.length > API_LOG_MAX) API_LOG.length = API_LOG_MAX;
}

/** Recent API calls, newest first. Used by the Developer Mode inspector. */
function apiLog() { return API_LOG.slice(); }

/** Empty the inspector log (e.g. before reproducing an issue). */
function clearApiLog() { API_LOG.length = 0; }

async function api(method, path, body, callOpts) {
  var base = backendBase();
  var url = base + path;
  var t0 = Date.now();
  var opts = { method: method, headers: { "content-type": "application/json" } };
  var key = storedApiKey();
  if (key) opts.headers["x-api-key"] = key;
  /* No default provider: only send the header when a provider is chosen.
     callOpts.provider lets callers (e.g. model comparison) override the
     stored provider per request without touching global state. */
  var prov = (callOpts && callOpts.provider !== undefined) ? callOpts.provider : storedProvider();
  if (prov) opts.headers["x-provider"] = prov;
  if (body !== undefined) opts.body = JSON.stringify(body);
  /* External AbortSignal (user Cancel): fetchWithTimeout aborts on it. */
  if (callOpts && callOpts.signal) opts.signal = callOpts.signal;

  var entry = { method: method, path: path, url: redactSecrets(url), ts: new Date().toISOString(), status: 0, ms: 0 };
  if (body !== undefined) {
    /* Strip base64 attachment blobs before logging — the inspector shows
       name/mime/kind/size, not megabytes of noise. */
    var NU = window.NeutronUI;
    var logBody = (NU && NU.stripAttachmentData) ? NU.stripAttachmentData(body) : body;
    entry.request = redactSecrets(JSON.stringify(logBody)).slice(0, 4000);
  }

  function finish() {
    entry.ms = Date.now() - t0;
    pushApiLog(entry);
    if (isVerbose()) {
      try { console.log("[neutron api]", method, entry.url, entry.status || "ERR", entry.ms + "ms"); }
      catch (e) { /* console unavailable */ }
    }
  }

  var res, text = "", json = {};
  try {
    /* Fail fast when the browser knows it's offline — no point burning
       the 90s timeout in a dead zone. */
    if (typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine) {
      throw new Error("You appear to be offline — check your connection and try again.");
    }
    /* 90s cap: serverless functions top out at 60s, so anything slower is
       a stall. Timeouts surface through the normal error paths (and the
       chat Retry button from the message log). */
    var UI = window.NeutronUI;
    var doFetch = (UI && UI.fetchWithTimeout)
      ? function (u, o) { return UI.fetchWithTimeout(u, o, 90000); }
      : function (u, o) { return fetch(u, o); };
    res = await doFetch(url, opts);
    text = await res.text();
    try { json = text ? JSON.parse(text) : {}; } catch (e) { json = {}; }
  } catch (e) {
    entry.error = redactSecrets(String((e && e.message) || e)).slice(0, 500);
    finish();
    throw e;
  }
  entry.status = res.status;
  entry.response = redactSecrets(text).slice(0, 4000);
  finish();
  if (!res.ok || json.ok === false) {
    var err = new Error(json.error || ("HTTP " + res.status));
    err.status = res.status;
    err.requiresApproval = !!json.requiresApproval;
    throw err;
  }
  return json;
}

function showError(msg) {
  var bar = document.getElementById("error-bar");
  var txt = document.getElementById("error-text");
  if (txt) txt.textContent = msg; else bar.textContent = msg;
  bar.classList.remove("hidden");
}

function clearError() {
  var bar = document.getElementById("error-bar");
  var txt = document.getElementById("error-text");
  if (txt) txt.textContent = ""; else bar.textContent = "";
  bar.classList.add("hidden");
}

/* ----- toast: transient confirmation for successful actions (errors keep
   using the error bar). GPU-friendly entrance via transform/opacity. ----- */
var toastTimers = [];
function toast(msg) {
  var host = document.getElementById("toast-host");
  if (!host) {
    host = el("div", "toast-host");
    host.id = "toast-host";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  var t = el("div", "toast", msg);
  host.appendChild(t);
  /* Single forced reflow outside any loop to trigger the entrance transition. */
  void t.offsetWidth;
  t.classList.add("show");
  var hide = setTimeout(function () {
    t.classList.remove("show");
    var drop = setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 320);
    toastTimers.push(drop);
  }, 2600);
  toastTimers.push(hide);
  /* Keep the stack small on rapid-fire toasts. */
  while (host.children.length > 3) host.removeChild(host.firstChild);
}

function kvGrid(pairs) {
  var g = el("div", "kv-grid");
  pairs.forEach(function (p) {
    var cell = el("div", "kv");
    cell.appendChild(el("div", "k", p[0]));
    cell.appendChild(el("div", "v", p[1]));
    g.appendChild(cell);
  });
  return g;
}

function table(headers, rows) {
  var t = el("table", "tbl");
  var thead = el("thead");
  var hr = el("tr");
  headers.forEach(function (h) { hr.appendChild(el("th", null, h)); });
  thead.appendChild(hr);
  t.appendChild(thead);
  var tb = el("tbody");
  rows.forEach(function (r) {
    var tr = el("tr");
    r.forEach(function (c) {
      var td = el("td", c.mono ? "mono" : null, c.text);
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  return t;
}

function cell(text, mono) { return { text: text, mono: !!mono }; }

function notice(kind, text) {
  return el("div", "notice" + (kind ? " " + kind : ""), text);
}

function dump(title, obj) {
  var d = el("details", "dump");
  d.appendChild(el("summary", null, title));
  var pre = el("pre", null, JSON.stringify(obj, null, 2).slice(0, 20000));
  d.appendChild(pre);
  return d;
}

function field(label, inputEl) {
  var lab = el("label", "field");
  lab.appendChild(el("span", null, label));
  lab.appendChild(inputEl);
  return lab;
}

function selectInput(options, value) {
  var s = el("select", "input");
  options.forEach(function (o) {
    var opt = el("option", null, o.label);
    opt.value = o.value;
    if (o.value === value) opt.selected = true;
    s.appendChild(opt);
  });
  return s;
}

function chips(parent, items, limit) {
  var c = el("div", "chips");
  var list = items || [];
  var shown = (typeof limit === "number" && limit >= 0) ? list.slice(0, limit) : list;
  shown.forEach(function (x) { c.appendChild(el("span", "chip", x)); });
  if (list.length > shown.length) {
    c.appendChild(el("span", "chip chip-more", "+" + (list.length - shown.length) + " more"));
  }
  if (!list.length) c.appendChild(el("span", "muted small", "none detected"));
  parent.appendChild(c);
}

/* ---------- server status ---------- */

/* APK shell version via the native JS bridge (null on plain browsers). */
function apkVersion() {
  try {
    if (window.NeutronApp && typeof window.NeutronApp.getApkVersion === "function") {
      var v = window.NeutronApp.getApkVersion();
      return v && v !== "?" ? v : null;
    }
  } catch (e) {}
  return null;
}

function versionLabel(serverVersion) {
  var av = apkVersion();
  var parts = [];
  if (av) parts.push("App v" + av);
  parts.push("Server v" + (serverVersion || "?"));
  return parts.join(" · ");
}

/* Throttle the /api/health call: it otherwise fires on every route change. */
var PILL_REFRESH_MS = 30000;
var lastPillRefresh = 0;

async function refreshServerPill(force) {
  var pill = document.getElementById("server-pill");
  try {
    var now = Date.now();
    var UI = window.NeutronUI;
    if (!force && UI && !UI.shouldRefreshPill(lastPillRefresh, now, PILL_REFRESH_MS)) return;
    lastPillRefresh = now;
    var h = await api("GET", "/api/health");
    /* Compact and professional: app version only (server version lives
       on the Dashboard Server card). */
    pill.textContent = "ONLINE · v" + (apkVersion() || h.version || "?");
    pill.className = "pill ok";
  } catch (e) {
    pill.textContent = "OFFLINE";
    pill.className = "pill bad";
  }
}

/* ---------- router ---------- */

var ROUTES = {
  dashboard: renderDashboard,
  maintain: renderMaintain,
  repos: renderRepos,
  reports: renderReports,
  chat: renderChat,
  compare: function (view) { return window.NeutronCompare.renderCompare(view); },
  tasks: function (view) { return window.NeutronTasks.renderTasks(view); },
  timeline: function (view) { return window.NeutronTasks.renderTimeline(view); },
  rooms: function (view) { return window.NeutronRooms.renderRooms(view); },
  games: function (view) { return window.NeutronGames.renderGames(view); },
  music: function (view) { return window.NeutronMusic.renderSection(view); },
  skills: function (view) { return window.NeutronSkills.renderSkills(view); },
  agent: function (view) { return window.NeutronAgent.renderAgent(view); },
  terminal: function (view) { return window.NeutronTerminal.renderTerminal(view); },
  testlab: function (view) { return window.NeutronTerminal.renderTestLab(view); },
  security: function (view) { return window.NeutronInsights.renderSecurity(view); },
  deps: function (view) { return window.NeutronInsights.renderDeps(view); },
  health: function (view) { return window.NeutronInsights.renderHealth(view); },
  notifications: function (view) { return window.NeutronTasks.renderNotifications(view); },
  friends: function (view) { return window.NeutronFriends.renderFriends(view); },
  account: function (view) { return window.NeutronAuth.renderAccount(view); },
  settings: renderSettings,
  usage: renderUsage,
};

function currentRoute() {
  var h = location.hash || "";
  /* Deep link into a collaboration room: #room=NEUTRON-XXXXXX */
  var rm = h.match(/^#room=([A-Za-z0-9-]+)/);
  if (rm) {
    window.__neutronPendingRoom = rm[1];
    return "rooms";
  }
  var r = h.replace(/^#\/?/, "").split("/")[0];
  return ROUTES[r] ? r : "dashboard";
}

async function render() {
  /* Tear down chat overlays: menus/dialogs/drawer live on document.body,
     outside the cleared view. */
  try { if (ChatHooks.closeOverlays) ChatHooks.closeOverlays(); } catch (e) {}
  /* Close the notification panel on navigation. */
  try { if (window.NeutronTasks && window.NeutronTasks.closePanel) window.NeutronTasks.closePanel(); } catch (e) {}
  /* Tear down the rooms WebSocket when navigating away from the rooms route. */
  try {
    if (currentRoute() !== "rooms" && window.NeutronRooms && window.NeutronRooms.teardown) {
      window.NeutronRooms.teardown();
    }
  } catch (e) {}
  /* Cancel in-flight comparison requests when leaving the compare route. */
  try {
    if (currentRoute() !== "compare" && window.NeutronCompare && window.NeutronCompare.teardown) {
      window.NeutronCompare.teardown();
    }
  } catch (e) {}
  /* Tear down the games module (animation loops, sockets) on navigation. */
  try {
    if (currentRoute() !== "games" && window.NeutronGames && window.NeutronGames.teardown) {
      window.NeutronGames.teardown();
    }
  } catch (e) {}
  /* Stop agent polling when navigating away from the agent route. */
  try {
    if (currentRoute() !== "agent" && window.NeutronAgent && window.NeutronAgent.teardown) {
      window.NeutronAgent.teardown();
    }
  } catch (e) {}
  /* Stop terminal/test-lab polling when navigating away from those routes. */
  try {
    var cr = currentRoute();
    if (cr !== "terminal" && cr !== "testlab" && window.NeutronTerminal && window.NeutronTerminal.teardown) {
      window.NeutronTerminal.teardown();
    }
  } catch (e) {}
  ChatHooks.newTask = null;
  ChatHooks.toggleHistory = null;
  ChatHooks.focusHistorySearch = null;
  ChatHooks.closeOverlays = null;
  ChatHooks.moveHistSelection = null;
  ChatHooks.outsideClick = null;
  clearError();
  /* A reply being read aloud must not keep talking after navigation —
     stop speech on every route render (leaving chat, switching tasks). */
  try {
    var NSU = window.NeutronUI;
    if (NSU && NSU.stopSpeechSynthesis) NSU.stopSpeechSynthesis();
  } catch (e) {}
  var route = currentRoute();
  /* Chat gets a full-viewport workspace: hide the sidebar and footer. */
  document.body.classList.toggle("chat-full", route === "chat");
  document.querySelectorAll(".sidebar a[data-route]").forEach(function (a) {
    a.classList.toggle("active", a.getAttribute("data-route") === route);
  });
  var view = document.getElementById("view");
  view.innerHTML = "";
  try {
    await ROUTES[route](view);
  } catch (e) {
    showError(e && e.message ? e.message : String(e));
  }
  /* Subtle route transition (GPU-friendly fade+rise; disabled under
     prefers-reduced-motion via CSS). */
  view.classList.remove("view-enter");
  void view.offsetWidth;
  view.classList.add("view-enter");
  refreshServerPill();
  /* Move keyboard/screen-reader focus to the new view's main heading.
     (Chat is skipped: focusing its composer would pop the mobile keyboard
     on entry, and its log is already an aria-live region.) */
  try {
    var target = route === "chat" ? null : view.querySelector("h1");
    if (target) {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
  } catch (e) { /* focus is best-effort */ }
}

window.addEventListener("hashchange", render);

/* ---------- onboarding (Phase 36) ----------
   First-run 3-step flow: welcome + display name → project type →
   provider setup. Device-local only (neutron_onboarding — the same trust
   boundary as the API key). Skippable on every step; replayable from
   Settings. Skip always finishes immediately and never blocks the app. */

var onboardingState = null;

function loadOnboarding() {
  if (onboardingState) return onboardingState;
  var UI = window.NeutronUI;
  try {
    var raw = localStorage.getItem(UI ? UI.ONBOARDING_STORE_KEY : "neutron_onboarding");
    onboardingState = UI ? UI.sanitizeOnboarding(raw ? JSON.parse(raw) : null) : UI.onboardingInitial();
  } catch (e) {
    var U2 = window.NeutronUI;
    onboardingState = U2 ? U2.onboardingInitial() : { version: 1, done: false, step: 0, name: "", projectType: "" };
  }
  return onboardingState;
}

function saveOnboarding() {
  if (!onboardingState) return;
  try {
    var UI = window.NeutronUI;
    localStorage.setItem(UI ? UI.ONBOARDING_STORE_KEY : "neutron_onboarding", JSON.stringify(onboardingState));
  } catch (e) { /* private mode: onboarding simply won't persist */ }
}

/* Build the starter project for onboarding step 2. Returns the id or null. */
function createOnboardingProject(typeId) {
  var UI = window.NeutronUI;
  if (!UI) return null;
  try {
    loadProjectStore();
    var info = null;
    UI.projectTypeList().forEach(function (t) { if (t.id === typeId) info = t; });
    if (!info) return null;
    var pr = UI.newProject(genProjectId(), info.label + " Project", Date.now());
    var tpl = UI.projectTypeTemplate(typeId);
    if (tpl && pr.memory) {
      Object.keys(tpl).forEach(function (k) {
        if (k in pr.memory) pr.memory[k] = tpl[k];
      });
    }
    projectStore.items[pr.id] = pr;
    if (!saveProjectStore()) return null;
    return pr.id;
  } catch (e) { return null; }
}

function closeOnboarding() {
  var back = document.getElementById("onboarding-back");
  if (back && back.parentNode) back.parentNode.removeChild(back);
}

function finishOnboarding() {
  var UI = window.NeutronUI;
  var st = loadOnboarding();
  onboardingState = UI ? UI.onboardingFinish(st) : st;
  if (onboardingState) onboardingState.done = true;
  saveOnboarding();
  closeOnboarding();
}

/* Render the first-run overlay. No-op when already done or helpers missing. */
function showOnboarding() {
  closeOnboarding();
  var UI = window.NeutronUI;
  if (!UI) return;
  var st = loadOnboarding();
  if (st.done) return;

  var back = el("div", "hist-modal-back");
  back.id = "onboarding-back";
  var modal = el("div", "hist-modal");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Welcome to NEUTRON");
  var body = el("div");
  modal.appendChild(body);
  back.appendChild(modal);
  document.body.appendChild(back);

  function sync() { onboardingState = st; saveOnboarding(); }

  /* Nav row builder. Returns {row, next} so painters can enable/disable Next. */
  function navRow(opts) {
    var row = el("div", "row");
    if (opts.back) {
      var b = el("button", "btn ghost", "Back");
      b.type = "button";
      b.onclick = function () { st = UI.onboardingBack(st); sync(); paint(); };
      row.appendChild(b);
    }
    var skip = el("button", "btn ghost", "Skip");
    skip.type = "button";
    skip.title = "Skip setup";
    skip.onclick = function () { st = UI.onboardingSkip(st); sync(); closeOnboarding(); render(); };
    row.appendChild(skip);
    var spacer = el("span");
    spacer.style.flex = "1";
    row.appendChild(spacer);
    var next = el("button", "btn primary", opts.nextLabel || "Next");
    next.type = "button";
    if (opts.nextDisabled) next.disabled = true;
    next.onclick = opts.onNext;
    row.appendChild(next);
    return { row: row, next: next };
  }

  function paint() {
    body.innerHTML = "";
    var prog = el("p", "muted small", "Step " + (st.step + 1) + " of " + UI.ONBOARDING_STEP_COUNT);
    prog.setAttribute("aria-live", "polite");
    body.appendChild(prog);
    if (st.step === 0) paintWelcome();
    else if (st.step === 1) paintProjectType();
    else paintProvider();
    var h = body.querySelector("h2");
    if (h) {
      h.setAttribute("tabindex", "-1");
      try { h.focus({ preventScroll: true }); } catch (e) {}
    }
  }

  function paintWelcome() {
    body.appendChild(el("h2", null, "Welcome to NEUTRON"));
    body.appendChild(el("p", "muted",
      "Your AI-powered development workspace — chat, build, collaborate, and ship from one place. Setup takes under a minute."));
    var lab = el("label", "fld-label", "Display name (optional)");
    lab.setAttribute("for", "ob-name");
    body.appendChild(lab);
    var inp = el("input", "input");
    inp.id = "ob-name";
    inp.placeholder = "e.g. Sunny";
    inp.maxLength = UI.DISPLAY_NAME_MAX || 40;
    inp.setAttribute("autocomplete", "nickname");
    inp.value = st.name || "";
    body.appendChild(inp);
    var nav = navRow({ back: false, nextLabel: "Next", onNext: function () {
      st.name = UI.sanitizeDisplayName(inp.value);
      st = UI.onboardingNext(st); sync(); paint();
    }});
    body.appendChild(nav.row);
    inp.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); nav.next.click(); }
    });
  }

  function paintProjectType() {
    body.appendChild(el("h2", null, "What are you building?"));
    body.appendChild(el("p", "muted",
      "We'll create a starter project with a memory template for it. You can rename it and change everything later."));
    var grid = el("div", "grid cols-2");
    var selected = st.projectType || "";
    var nav = navRow({ back: true, nextLabel: "Create project", nextDisabled: !selected, onNext: function () {
      st.projectType = selected;
      if (createOnboardingProject(selected)) toast("Project created.");
      st = UI.onboardingNext(st); sync(); paint();
    }});
    UI.projectTypeList().forEach(function (t) {
      var b = el("button", "btn type-card" + (selected === t.id ? " active" : ""), "");
      b.type = "button";
      b.setAttribute("aria-pressed", selected === t.id ? "true" : "false");
      b.appendChild(el("div", "type-card-label", t.label));
      b.appendChild(el("div", "muted small", t.hint));
      b.onclick = function () {
        selected = t.id;
        Array.prototype.forEach.call(grid.children, function (c) {
          c.classList.remove("active");
          c.setAttribute("aria-pressed", "false");
        });
        b.classList.add("active");
        b.setAttribute("aria-pressed", "true");
        nav.next.disabled = false;
      };
      grid.appendChild(b);
    });
    body.appendChild(grid);
    body.appendChild(nav.row);
  }

  function paintProvider() {
    body.appendChild(el("h2", null, "Connect your AI provider"));
    body.appendChild(el("p", null,
      "NEUTRON uses your own API key — it's stored only in this browser and sent with your requests, never on a server."));
    body.appendChild(el("p", "muted small",
      "Pick a provider and paste your key in Settings to start chatting with AI."));
    var row = el("div", "row");
    var b = el("button", "btn ghost", "Back");
    b.type = "button";
    b.onclick = function () { st = UI.onboardingBack(st); sync(); paint(); };
    row.appendChild(b);
    var spacer = el("span");
    spacer.style.flex = "1";
    row.appendChild(spacer);
    var go = el("button", "btn", "Open Settings");
    go.type = "button";
    go.onclick = function () { finishOnboarding(); location.hash = "#/settings"; };
    row.appendChild(go);
    var fin = el("button", "btn primary", "Finish");
    fin.type = "button";
    fin.onclick = function () { finishOnboarding(); render(); };
    row.appendChild(fin);
    body.appendChild(row);
  }

  paint();
}

/* ---------- dashboard ---------- */

async function renderDashboard(view) {
  var UI = window.NeutronUI;

  /* Personal greeting — time-aware, with the onboarding display name. */
  var obName = "";
  try { obName = loadOnboarding().name || ""; } catch (e) {}
  view.appendChild(el("h1", null, UI ? UI.dashboardGreeting(obName) : "Dashboard"));
  view.appendChild(el("p", "muted", "Your workspace at a glance — everything below is your real data from this browser."));

  /* Quick actions. */
  var qa = el("div", "row");
  qa.setAttribute("aria-label", "Quick actions");
  var newChat = el("button", "btn primary", "+ New Chat");
  newChat.type = "button";
  newChat.onclick = function () {
    try {
      loadConvStore();
      var id = genConvId();
      var nc = UI.convCreate(convStore, id, Date.now());
      nc.provider = storedProvider();
      nc.model = storedModel();
      convStore.activeId = id;
      saveConvStore();
      location.hash = "#/chat/" + encodeURIComponent(id);
    } catch (e) { location.hash = "#/chat"; }
  };
  qa.appendChild(newChat);
  [["+ New Project", "#/repos"], ["+ New Task", null], ["Join Room", "#/rooms"], ["Open Terminal", "#/terminal"]]
    .forEach(function (pair) {
      var b = pair[1] ? el("a", "btn", pair[0]) : el("button", "btn", pair[0]);
      if (pair[1]) { b.href = pair[1]; }
      else {
        b.type = "button";
        b.onclick = function () {
          if (window.NeutronTasks) window.NeutronTasks.openTaskDialog({});
        };
      }
      qa.appendChild(b);
    });
  view.appendChild(qa);

  /* Continue working — the latest live item of each kind, deep-linked. */
  var rail = el("section", "panel");
  rail.appendChild(el("h2", null, "Continue working"));
  var railGrid = el("div", "grid cols-3");
  var nowMs = Date.now();
  function railCard(kind, title, sub, href) {
    var c = el("div", "rail-card");
    c.appendChild(el("div", "muted small", kind));
    if (href) {
      var a = el("a", null, title);
      a.href = href;
      c.appendChild(a);
    } else {
      c.appendChild(el("div", null, title));
    }
    if (sub) c.appendChild(el("div", "muted small", sub));
    return c;
  }
  try {
    loadConvStore();
    var convs = UI.latestItems(convStore.items, "updatedAt", 10)
      .filter(function (c) { return c && !c.archived; });
    if (convs.length) {
      var c0 = convs[0];
      railGrid.appendChild(railCard("💬 CHAT", UI.convDisplayTitle(c0),
        UI.relativeTime(c0.updatedAt, nowMs), "#/chat/" + encodeURIComponent(c0.id)));
    } else {
      railGrid.appendChild(railCard("💬 CHAT", "No conversations yet", "Start one from + New Chat above.", null));
    }
  } catch (e) {
    railGrid.appendChild(railCard("💬 CHAT", "Couldn't load conversations", null, null));
  }
  try {
    var tstore = window.NeutronTasks ? window.NeutronTasks.loadTaskStore() : null;
    var open = tstore ? UI.latestItems(tstore.items, "updatedAt", 50)
      .filter(function (t) { return t && t.status !== "done"; }) : [];
    if (open.length) {
      var t0 = open[0];
      var tsub = (UI.TASK_STATUS_LABELS && UI.TASK_STATUS_LABELS[t0.status] ? UI.TASK_STATUS_LABELS[t0.status] : t0.status) +
        (t0.updatedAt ? " · " + UI.relativeTime(t0.updatedAt, nowMs) : "");
      railGrid.appendChild(railCard("✓ TASK", String(t0.title || "Untitled task").slice(0, 42), tsub, "#/tasks"));
    } else {
      railGrid.appendChild(railCard("✓ TASK", "No open tasks", "Create one from + New Task above.", null));
    }
  } catch (e) {
    railGrid.appendChild(railCard("✓ TASK", "Couldn't load tasks", null, null));
  }
  var jobs = jobHistory();
  if (jobs.length) {
    var j0 = jobs[0];
    var jwhen = "";
    if (j0.createdAt) { var jt = Date.parse(j0.createdAt); if (!isNaN(jt)) jwhen = UI.relativeTime(jt, nowMs); }
    railGrid.appendChild(railCard("⚙ RUN", String(j0.request || "Untitled run").slice(0, 42), jwhen,
      j0.jobId ? "#/reports/" + encodeURIComponent(j0.jobId) : "#/reports"));
  } else {
    railGrid.appendChild(railCard("⚙ RUN", "No runs yet", "Start one from Maintain.", null));
  }
  rail.appendChild(railGrid);
  view.appendChild(rail);

  /* Status strip — today's usage, open tasks, unread notifications, last run. */
  var strip = el("div", "grid cols-4");
  function miniStat(label, value, href) {
    var s = el("section", "panel mini-stat");
    s.appendChild(el("div", "muted small", label));
    if (href) {
      var a = el("a", "stat-num small-num", String(value));
      a.href = href;
      s.appendChild(a);
    } else {
      s.appendChild(el("div", "stat-num small-num", String(value)));
    }
    return s;
  }
  var todayReq = 0;
  try { todayReq = UI.usageRollup(loadUsageLog(), 1, nowMs).requests; } catch (e) {}
  strip.appendChild(miniStat("AI requests today", todayReq, "#/usage"));
  var openCount = 0;
  try {
    var ts2 = window.NeutronTasks ? window.NeutronTasks.loadTaskStore() : null;
    openCount = ts2 ? UI.countOpenTasks(ts2.items) : 0;
  } catch (e) {}
  strip.appendChild(miniStat("Open tasks", openCount, "#/tasks"));
  var unread = 0;
  try {
    unread = (window.NeutronTasks && UI.notifUnreadCount)
      ? UI.notifUnreadCount(window.NeutronTasks.getNotifications()) : 0;
  } catch (e) {}
  strip.appendChild(miniStat("Unread notifications", unread, "#/timeline"));
  strip.appendChild(miniStat("Last run", jobs.length && jobs[0].request
    ? String(jobs[0].request).slice(0, 24) : "—",
    jobs.length && jobs[0].jobId ? "#/reports/" + encodeURIComponent(jobs[0].jobId) : null));
  view.appendChild(strip);

  /* Skeleton placeholders while the two status calls are in flight. */
  var stats = el("div", "grid cols-3");
  function skeletonCard() {
    var p = el("section", "panel skeleton-card");
    p.setAttribute("aria-busy", "true");
    p.appendChild(el("div", "skeleton sk-line sk-w40"));
    p.appendChild(el("div", "skeleton sk-num"));
    p.appendChild(el("div", "skeleton sk-line"));
    return p;
  }
  for (var i = 0; i < 3; i++) stats.appendChild(skeletonCard());
  view.appendChild(stats);

  var results = await Promise.allSettled([
    api("GET", "/api/health"),
    api("GET", "/api/demo/status"),
  ]);
  var health = results[0].status === "fulfilled" ? results[0].value : null;
  var demo = results[1].status === "fulfilled" ? results[1].value : null;
  var keySet = !!storedApiKey();

  stats.innerHTML = "";
  function statCard(title, big, sub) {
    var p = el("section", "panel");
    p.appendChild(el("h2", null, title));
    p.appendChild(el("div", "stat-num", big));
    if (sub) p.appendChild(el("div", "muted small", sub));
    return p;
  }
  stats.appendChild(statCard("Server", health ? "ONLINE" : "OFFLINE",
    health ? versionLabel(health.version) : "could not reach /api/health"));
  stats.appendChild(statCard("Demo repository", demo ? demo.demoRepository : "—",
    demo ? demo.demoDescription : "could not reach /api/demo/status"));
  stats.appendChild(statCard("API key", keySet ? "SET" : "NOT SET",
    keySet ? "sent with your requests only" : "add one in Settings"));

  var mid = el("div", "grid cols-2");

  var llm = el("section", "panel");
  llm.appendChild(el("h2", null, "LLM provider"));
  if (demo) {
    llm.appendChild(el("p", null, demo.providerConfigured ? "CONFIGURED" : "NOT CONFIGURED"));
    llm.appendChild(el("p", "muted small", demo.llmNote || ""));
  } else {
    llm.appendChild(el("p", "muted", "Status unavailable."));
  }
  mid.appendChild(llm);

  var how = el("section", "panel");
  how.appendChild(el("h2", null, "How NEUTRON works"));
  var ol = el("ol", "small");
  ["Understand the repository", "Analyze impact", "Build an explicit plan",
   "Human approves the plan", "Execute the change", "Run tests",
   "Security review", "Final report"].forEach(function (s) {
    ol.appendChild(el("li", null, s));
  });
  how.appendChild(ol);
  mid.appendChild(how);
  view.appendChild(mid);

  /* Recent activity — real data from this browser: latest conversations
     and maintain runs. Gives the dashboard depth beyond server status. */
  var UI0 = window.NeutronUI;
  var act = el("section", "panel");
  act.appendChild(el("h2", null, "Recent activity"));
  var actGrid = el("div", "grid cols-2");
  var nowMs = Date.now();

  var convCol = el("div", null);
  convCol.appendChild(el("h3", null, "CONVERSATIONS"));
  try {
    loadConvStore();
    var convs = Object.keys(convStore.items || {})
      .map(function (id) { return convStore.items[id]; })
      .filter(function (c) { return c && !c.archived; })
      .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); })
      .slice(0, 4);
    if (!convs.length) {
      convCol.appendChild(el("p", "muted small", "No conversations yet."));
    } else {
      var cl = el("ul", "act-list");
      convs.forEach(function (c) {
        var li = el("li", null);
        var a = el("a", null, UI0 ? UI0.convDisplayTitle(c) : (c.title || "Untitled"));
        a.href = "#/chat/" + encodeURIComponent(c.id);
        li.appendChild(a);
        li.appendChild(el("span", "muted small", " · " + (UI0 ? UI0.relativeTime(c.updatedAt, nowMs) : "")));
        cl.appendChild(li);
      });
      convCol.appendChild(cl);
    }
  } catch (e) {
    convCol.appendChild(el("p", "muted small", "Could not load conversations."));
  }
  actGrid.appendChild(convCol);

  var runCol = el("div", null);
  runCol.appendChild(el("h3", null, "MAINTAIN RUNS"));
  var runs = jobHistory().slice(0, 4);
  if (!runs.length) {
    runCol.appendChild(el("p", "muted small", "No runs recorded yet."));
  } else {
    var rl = el("ul", "act-list");
    runs.forEach(function (x) {
      var li = el("li", null);
      var a = el("a", null, (x.request || "Untitled run").slice(0, 42));
      a.href = "#/reports/" + encodeURIComponent(x.jobId || "");
      li.appendChild(a);
      var when = "";
      if (UI0 && x.createdAt) {
        var t = Date.parse(x.createdAt);
        if (!isNaN(t)) when = UI0.relativeTime(t, nowMs);
      }
      li.appendChild(el("span", "muted small", " · " + when));
      rl.appendChild(li);
    });
    runCol.appendChild(rl);
  }
  actGrid.appendChild(runCol);
  act.appendChild(actGrid);
  view.appendChild(act);
}

/* ---------- projects (project brain) ---------- */

/* Standalone modal (the history modal lives inside renderChat's closure). */
function openProjModal(title, bodyEl, actions, invoker) {
  closeProjModal();
  var back = el("div", "hist-modal-back");
  var modal = el("div", "hist-modal");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", title);
  modal.appendChild(el("div", "hist-modal-title", title));
  modal.appendChild(bodyEl);
  var row = el("div", "hist-modal-actions");
  function close() {
    closeProjModal();
    if (invoker && invoker.focus) { try { invoker.focus(); } catch (e) {} }
  }
  actions.forEach(function (a) {
    var b = el("button", "btn " + (a.kind || "ghost"), a.label);
    b.onclick = function () {
      var keep = a.onClick ? a.onClick() : undefined;
      if (keep !== false) close();
    };
    row.appendChild(b);
  });
  modal.appendChild(row);
  back.appendChild(modal);
  back.addEventListener("mousedown", function (ev) { if (ev.target === back) close(); });
  back.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.stopPropagation(); close(); } });
  document.body.appendChild(back);
  window.__projModal = { el: back, close: close };
  var focusable = bodyEl.querySelector("input, textarea, select") || row.querySelector("button");
  if (focusable) { try { focusable.focus(); } catch (e) {} }
  return close;
}
function closeProjModal() {
  var m = window.__projModal;
  if (m) {
    if (m.el.parentNode) m.el.parentNode.removeChild(m.el);
    window.__projModal = null;
  }
}

function projGo(id) { location.hash = "#/repos/project/" + encodeURIComponent(id); }

function renderProjectsSection(view) {
  var UI = window.NeutronUI;
  var sec = el("section", "panel");
  sec.appendChild(el("h2", null, "Projects"));
  sec.appendChild(el("p", "muted small",
    "Project memory: architecture, conventions, decisions, and notes the AI should know. Stored only in this browser. Attach a project to any chat and its memory rides along as context."));
  var body = el("div", null);
  sec.appendChild(body);

  function paint() {
    body.innerHTML = "";
    var warn = el("div", null);
    projectSecretWarnings.forEach(function (w) {
      var n = el("div", "notice warn");
      n.appendChild(el("strong", null, "⚠ Possible secret in project \"" + w.name + "\": "));
      n.appendChild(document.createTextNode(
        w.findings.map(function (f) { return f.section + " (" + f.pattern + ")"; }).join("; ") +
        ". Review and remove it — secrets must never live in project memory."));
      var open = el("button", "btn ghost sm", "Review");
      open.onclick = function () { projGo(w.id); };
      n.appendChild(open);
      warn.appendChild(n);
    });
    body.appendChild(warn);

    var ids = Object.keys(projectStore.items);
    if (!ids.length) {
      body.appendChild(el("p", "muted", "No projects yet. Create one to give the AI lasting context about your work."));
    } else {
      ids.sort(function (a, b) {
        return (projectStore.items[b].updatedAt || 0) - (projectStore.items[a].updatedAt || 0);
      });
      var ul = el("ul", "list");
      ids.forEach(function (id) {
        var pr = projectStore.items[id];
        var li = el("li");
        var btn = el("button", "linklike proj-open");
        var mem = UI.projectMemory(pr);
        var filled = UI.PROJECT_TEXT_SECTIONS.filter(function (k) { return mem[k] && mem[k].trim(); }).length +
          UI.PROJECT_LIST_SECTIONS.filter(function (k) { return mem[k] && mem[k].length; }).length;
        btn.innerHTML = "";
        btn.appendChild(el("span", "mono", pr.name || "(untitled)"));
        btn.appendChild(el("span", "muted small",
          " · " + UI.relativeTime(pr.updatedAt, Date.now()) +
          " · " + filled + " memory sections" +
          (pr.linkedConversationIds.length ? " · " + pr.linkedConversationIds.length + " chats" : "")));
        btn.setAttribute("aria-label", "Open project " + (pr.name || "untitled"));
        btn.onclick = function () { projGo(id); };
        li.appendChild(btn);
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }

    var row = el("div", "row");
    var nameIn = el("input", "input");
    nameIn.placeholder = "New project name…";
    nameIn.maxLength = 120;
    nameIn.setAttribute("aria-label", "New project name");
    var add = el("button", "btn primary", "+ New project");
    function create() {
      var name = nameIn.value.trim();
      if (!name) { showError("Give the project a name first."); nameIn.focus(); return; }
      var pr = UI.newProject(genProjectId(), name, Date.now());
      projectStore.items[pr.id] = pr;
      saveProjectStore();
      toast("Project created.");
      projGo(pr.id);
    }
    add.onclick = create;
    nameIn.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); create(); } });
    row.appendChild(nameIn);
    row.appendChild(add);
    body.appendChild(row);
  }

  try {
    loadProjectStore();
  } catch (e) {
    body.appendChild(el("p", "muted", "Could not load projects."));
    return;
  }
  paint();
  view.appendChild(sec);
}

/* ----- project detail ----- */

function projSecretGuardedSave(value, saveFn) {
  if (!guardProjectSecret(value)) return false;
  saveFn();
  return true;
}

function renderProjectDetail(view, id) {
  var UI = window.NeutronUI;
  try { loadProjectStore(); } catch (e) {
    view.appendChild(el("p", "muted", "Could not load projects."));
    return;
  }
  var pr = UI.projectGet(projectStore, id);
  if (!pr) {
    view.appendChild(el("h1", null, "Project not found"));
    var back = el("a", "linklike", "\u2190 Repositories");
    back.href = "#/repos";
    view.appendChild(back);
    return;
  }

  var backLink = el("a", "linklike", "\u2190 Repositories");
  backLink.href = "#/repos";
  view.appendChild(backLink);

  var headRow = el("div", "row proj-head");
  headRow.appendChild(el("h1", null, pr.name || "(untitled)"));
  var renameBtn = el("button", "btn ghost sm", "Rename");
  renameBtn.onclick = function () {
    var input = document.createElement("input");
    input.type = "text"; input.className = "input"; input.value = pr.name || "";
    input.maxLength = 120; input.setAttribute("aria-label", "Project name");
    var wrap = el("div", "hist-modal-body"); wrap.appendChild(input);
    openProjModal("Rename project", wrap, [
      { label: "Cancel", kind: "ghost" },
      { label: "Save", kind: "primary", onClick: function () {
          if (!guardProjectSecret(input.value)) return false;
          if (!UI.projectRename(projectStore, id, input.value)) { showError("Project name can't be empty."); return false; }
          saveProjectStore(); toast("Project renamed."); render();
        } },
    ], renameBtn);
  };
  var chatBtn = el("button", "btn primary sm", "🧠 Chat with this project");
  chatBtn.title = "Open chat with this project's memory attached as context";
  chatBtn.onclick = function () {
    window.__neutronPendingProject = id;
    location.hash = "#/chat";
  };
  var delBtn = el("button", "btn danger sm", "Delete");
  delBtn.onclick = function () {
    var wrap = el("div", "hist-modal-body");
    wrap.appendChild(el("p", null, "Delete this project?"));
    wrap.appendChild(el("p", "hist-del-name", "\u201C" + pr.name + "\u201D"));
    wrap.appendChild(el("p", "muted small", "Its memory, links, and auto-detected data are removed from this browser. Chats are kept."));
    openProjModal("Delete project", wrap, [
      { label: "Cancel", kind: "ghost" },
      { label: "Delete", kind: "danger", onClick: function () {
          UI.projectDelete(projectStore, id);
          saveProjectStore(); toast("Project deleted.");
          location.hash = "#/repos";
        } },
    ], delBtn);
  };
  headRow.appendChild(renameBtn);
  headRow.appendChild(chatBtn);
  headRow.appendChild(delBtn);
  view.appendChild(headRow);

  /* Secret findings for this project. */
  var findings = UI.scanProjectSecrets(pr);
  if (findings.length) {
    var w = el("div", "notice warn");
    w.appendChild(el("strong", null, "⚠ Possible secret(s) detected: "));
    w.appendChild(document.createTextNode(findings.map(function (f) {
      return f.section + (f.index === null ? "" : "[" + f.index + "]") + " (" + f.pattern + ")";
    }).join("; ") + ". Remove them — project memory must never hold secrets."));
    view.appendChild(w);
  }

  /* Description. */
  var descCard = el("section", "panel");
  descCard.appendChild(el("h2", null, "Description"));
  var descTa = document.createElement("textarea");
  descTa.className = "input"; descTa.rows = 2; descTa.maxLength = 2000;
  descTa.value = pr.description || "";
  descTa.setAttribute("aria-label", "Project description");
  var descSave = el("button", "btn sm", "Save description");
  descSave.onclick = function () {
    if (!projSecretGuardedSave(descTa.value, function () {
      pr.description = descTa.value.trim();
      UI.projectTouch(projectStore, id, Date.now());
      saveProjectStore();
    })) return;
    toast("Description saved.");
  };
  descCard.appendChild(descTa);
  descCard.appendChild(descSave);
  view.appendChild(descCard);

  /* Free-text memory cards. */
  var TEXT_LABELS = { architecture: "Architecture", framework: "Framework", database: "Database", deployment: "Deployment", docs: "Notes / docs" };
  UI.PROJECT_TEXT_SECTIONS.forEach(function (section) {
    var card = el("section", "panel");
    card.appendChild(el("h2", null, TEXT_LABELS[section] || section));
    var ta = document.createElement("textarea");
    ta.className = "input"; ta.rows = 3; ta.maxLength = 2000;
    ta.value = UI.projectMemory(pr)[section] || "";
    ta.setAttribute("aria-label", TEXT_LABELS[section] || section);
    var save = el("button", "btn sm", "Save");
    save.onclick = function () {
      if (!projSecretGuardedSave(ta.value, function () {
        UI.projectMemorySetText(pr, section, ta.value);
        saveProjectStore();
      })) return;
      toast("Saved.");
    };
    card.appendChild(ta);
    card.appendChild(save);
    view.appendChild(card);
  });

  /* List memory cards with add / inline-edit / remove. */
  var LIST_LABELS = { languages: "Languages", conventions: "Conventions", decisions: "Decisions", knownBugs: "Known bugs", importantFiles: "Important files", apis: "APIs", tasks: "Tasks" };
  UI.PROJECT_LIST_SECTIONS.forEach(function (section) {
    view.appendChild(projListCard(pr, id, section, LIST_LABELS[section] || section));
  });

  /* Dependencies card. */
  view.appendChild(projDepsCard(pr, id));

  /* Auto-detect card. */
  view.appendChild(projDetectCard(pr, id));

  /* Links card. */
  view.appendChild(projLinksCard(pr, id));
}

/* Editable string-list card. */
function projListCard(pr, id, section, label) {
  var UI = window.NeutronUI;
  var card = el("section", "panel");
  card.appendChild(el("h2", null, label));
  var listBox = el("div", null);
  card.appendChild(listBox);

  function paint() {
    listBox.innerHTML = "";
    var items = UI.projectMemory(pr)[section] || [];
    if (!items.length) listBox.appendChild(el("p", "muted small", "Nothing here yet."));
    items.forEach(function (text, i) {
      var row = el("div", "row proj-item");
      var span = el("span", "proj-item-text", text);
      span.title = "Click to edit";
      span.setAttribute("role", "button");
      span.setAttribute("tabindex", "0");
      span.setAttribute("aria-label", "Edit " + label + " entry");
      function startEdit() {
        row.innerHTML = "";
        var inp = document.createElement("input");
        inp.type = "text"; inp.className = "input"; inp.value = text; inp.maxLength = 1000;
        inp.setAttribute("aria-label", "Edit entry");
        var ok = el("button", "btn sm primary", "Save");
        var cancel = el("button", "btn sm ghost", "Cancel");
        function finish(saveIt) {
          if (saveIt) {
            if (!guardProjectSecret(inp.value)) { inp.focus(); return; }
            if (!UI.projectMemoryUpdate(pr, section, i, inp.value)) { showError("Entry can't be empty."); return; }
            saveProjectStore();
          }
          paint();
        }
        ok.onclick = function () { finish(true); };
        cancel.onclick = function () { finish(false); };
        inp.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
          else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
        });
        row.appendChild(inp); row.appendChild(ok); row.appendChild(cancel);
        inp.focus(); inp.select();
      }
      span.onclick = startEdit;
      span.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); startEdit(); }
      });
      var del = el("button", "icon-btn", "\u00D7");
      del.setAttribute("aria-label", "Remove entry");
      del.title = "Remove";
      del.onclick = function () {
        UI.projectMemoryRemove(pr, section, i);
        saveProjectStore();
        paint();
      };
      row.appendChild(span); row.appendChild(del);
      listBox.appendChild(row);
    });
  }

  var addRow = el("div", "row");
  var inp = document.createElement("input");
  inp.type = "text"; inp.className = "input"; inp.maxLength = 1000;
  inp.placeholder = "Add " + label.toLowerCase() + "…";
  inp.setAttribute("aria-label", "Add " + label);
  var addBtn = el("button", "btn sm", "Add");
  function add() {
    if (!guardProjectSecret(inp.value)) { inp.focus(); return; }
    if (UI.projectMemoryAdd(pr, section, inp.value) === -1) { showError("Entry can't be empty."); inp.focus(); return; }
    saveProjectStore();
    inp.value = "";
    paint();
  }
  addBtn.onclick = add;
  inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); add(); } });
  addRow.appendChild(inp); addRow.appendChild(addBtn);
  card.appendChild(addRow);
  paint();
  return card;
}

/* Dependencies card: name@version — note, with add / edit / remove. */
function projDepsCard(pr, id) {
  var UI = window.NeutronUI;
  var card = el("section", "panel");
  card.appendChild(el("h2", null, "Dependencies"));
  var box = el("div", null);
  card.appendChild(box);

  function depRow(d, i) {
    var row = el("div", "row proj-item");
    row.appendChild(el("span", "mono", d.name + (d.version ? "@" + d.version : "")));
    if (d.note) row.appendChild(el("span", "muted small", " — " + d.note));
    var edit = el("button", "icon-btn", "\u270E");
    edit.setAttribute("aria-label", "Edit dependency " + d.name);
    edit.title = "Edit";
    edit.onclick = function () { openDepDialog(d, i, edit); };
    var del = el("button", "icon-btn", "\u00D7");
    del.setAttribute("aria-label", "Remove dependency " + d.name);
    del.title = "Remove";
    del.onclick = function () {
      UI.projectMemoryRemove(pr, "dependencies", i);
      saveProjectStore(); paint();
    };
    row.appendChild(edit); row.appendChild(del);
    return row;
  }

  function openDepDialog(existing, index, invoker) {
    var nameIn = document.createElement("input");
    nameIn.className = "input"; nameIn.maxLength = 200;
    nameIn.setAttribute("aria-label", "Dependency name");
    nameIn.placeholder = "name";
    var verIn = document.createElement("input");
    verIn.className = "input"; verIn.maxLength = 100;
    verIn.setAttribute("aria-label", "Version");
    verIn.placeholder = "version (optional)";
    var noteIn = document.createElement("input");
    noteIn.className = "input"; noteIn.maxLength = 1000;
    noteIn.setAttribute("aria-label", "Note");
    noteIn.placeholder = "note (optional)";
    if (existing) { nameIn.value = existing.name; verIn.value = existing.version || ""; noteIn.value = existing.note || ""; }
    var wrap = el("div", "hist-modal-body");
    wrap.appendChild(field("NAME", nameIn));
    wrap.appendChild(field("VERSION", verIn));
    wrap.appendChild(field("NOTE", noteIn));
    openProjModal(existing ? "Edit dependency" : "Add dependency", wrap, [
      { label: "Cancel", kind: "ghost" },
      { label: "Save", kind: "primary", onClick: function () {
          var v = { name: nameIn.value, version: verIn.value, note: noteIn.value };
          if (!guardProjectSecret(v.name + " " + v.version + " " + v.note)) return false;
          if (existing) {
            if (!UI.projectMemoryUpdate(pr, "dependencies", index, v)) { showError("Name can't be empty."); return false; }
          } else {
            if (UI.projectMemoryAdd(pr, "dependencies", v) === -1) { showError("Name can't be empty."); return false; }
          }
          saveProjectStore(); paint(); toast("Saved.");
        } },
    ], invoker);
  }

  function paint() {
    box.innerHTML = "";
    var deps = UI.projectMemory(pr).dependencies || [];
    if (!deps.length) box.appendChild(el("p", "muted small", "No dependencies recorded."));
    deps.forEach(function (d, i) { box.appendChild(depRow(d, i)); });
  }
  var addBtn = el("button", "btn sm", "+ Add dependency");
  addBtn.onclick = function () { openDepDialog(null, -1, addBtn); };
  card.appendChild(addBtn);
  paint();
  return card;
}

/* Auto-detect card: pick a workspace repo, preview the detected stack, apply. */
function projDetectCard(pr, id) {
  var UI = window.NeutronUI;
  var card = el("section", "panel");
  card.appendChild(el("h2", null, "Auto-detect from repository"));
  card.appendChild(el("p", "muted small",
    "Reads a real workspace repository (file list + package.json) and suggests framework, languages, key files, and dependencies. Every suggestion is marked as detected — review before keeping."));
  var row = el("div", "row");
  var sel = document.createElement("select");
  sel.className = "input";
  sel.setAttribute("aria-label", "Repository to analyze");
  var preview = el("div", null);
  card.appendChild(row); card.appendChild(preview);

  function loadRepos() {
    row.innerHTML = "";
    row.appendChild(sel);
    api("GET", "/api/demo/repos").then(function (rr) {
      var repos = (rr && Array.isArray(rr.repos) ? rr.repos : []).map(function (r) { return r && r.name; }).filter(Boolean);
      sel.innerHTML = "";
      if (!repos.length) {
        var o = document.createElement("option");
        o.textContent = "No workspace repositories";
        sel.appendChild(o); sel.disabled = true;
        return;
      }
      repos.forEach(function (n) {
        var o = document.createElement("option");
        o.value = n; o.textContent = n;
        if (pr.linkedRepoNames.indexOf(n) !== -1) o.textContent += " (linked)";
        sel.appendChild(o);
      });
      /* Prefer the first linked repo. */
      for (var i = 0; i < repos.length; i++) {
        if (pr.linkedRepoNames.indexOf(repos[i]) !== -1) { sel.value = repos[i]; break; }
      }
    }).catch(function () {
      sel.innerHTML = "";
      var o = document.createElement("option");
      o.textContent = "Could not list repositories";
      sel.appendChild(o); sel.disabled = true;
    });
    var go = el("button", "btn sm primary", "Detect");
    go.onclick = runDetect;
    row.appendChild(go);
  }

  function runDetect() {
    var repo = sel.value;
    if (!repo || sel.disabled) return;
    preview.innerHTML = "";
    var sk = el("div", "skeleton sk-line");
    sk.setAttribute("aria-busy", "true");
    preview.appendChild(sk);
    api("GET", "/api/demo/repo-files?repo=" + encodeURIComponent(repo)).then(function (r) {
      preview.innerHTML = "";
      var contents = {};
      if (r.requirementsTxt) contents["requirements.txt"] = String(r.requirementsTxt).slice(0, 20000);
      var det = UI.detectProjectStack(r.files || [], r.packageJson || null, contents);
      var box = el("div", "notice");
      box.appendChild(el("strong", null, "Detected from \"" + repo + "\" (review before keeping):"));
      var ul = el("ul", "list");
      function li(label, value) {
        var item = el("li");
        item.appendChild(el("span", null, label + ": "));
        item.appendChild(el("strong", null, value));
        ul.appendChild(item);
      }
      li("Framework", det.framework ? det.framework.name + " (" + det.framework.confidence + " confidence)" : "unknown");
      li("Languages", det.languages.length ? det.languages.map(function (l) { return l.lang + " " + l.pct + "%"; }).join(", ") : "unknown");
      li("Key files", det.importantFiles.length ? det.importantFiles.slice(0, 8).join(", ") + (det.importantFiles.length > 8 ? " (+" + (det.importantFiles.length - 8) + " more)" : "") : "none found");
      li("Dependencies", det.dependencies.length ? det.dependencies.length + " found" : "none found");
      box.appendChild(ul);
      preview.appendChild(box);
      var apply = el("button", "btn primary sm", "Apply detected stack");
      apply.onclick = function () {
        var applied = [];
        if (det.framework) {
          UI.projectMemorySetText(pr, "framework", det.framework.name + " (auto-detected)");
          applied.push("framework: " + det.framework.name);
        }
        det.languages.forEach(function (l) {
          var mem = UI.projectMemory(pr);
          if (mem.languages.indexOf(l.lang) === -1 && UI.projectMemoryAdd(pr, "languages", l.lang) !== -1) applied.push("language: " + l.lang);
        });
        det.importantFiles.forEach(function (f) {
          var mem = UI.projectMemory(pr);
          if (mem.importantFiles.indexOf(f) === -1 && UI.projectMemoryAdd(pr, "importantFiles", f) !== -1) applied.push("file: " + f);
        });
        det.dependencies.forEach(function (d) {
          var mem = UI.projectMemory(pr);
          var dup = mem.dependencies.some(function (e) { return e.name === d.name; });
          if (!dup && UI.projectMemoryAdd(pr, "dependencies", { name: d.name, version: d.version, note: "auto-detected" }) !== -1) applied.push("dependency: " + d.name);
        });
        if (!pr.linkedRepoNames.length) UI.linkRepo(pr, repo);
        saveProjectStore();
        toast(applied.length ? "Applied " + applied.length + " detected item(s) — review and edit as needed." : "Nothing new to apply.");
        announce("Auto-detect applied " + applied.length + " items from " + repo + ".");
        render();
      };
      preview.appendChild(apply);
      announce("Detection complete for " + repo + ".");
    }).catch(function (e) {
      preview.innerHTML = "";
      var msg = (e && e.message ? e.message : String(e));
      if (e && e.status === 404) {
        preview.appendChild(el("p", "muted",
          "Auto-detect needs the Node server — this deployment can't read the workspace repository. Run the app with \u2018node dist/cli-entry.js web\u2019 for full project features."));
      } else {
        preview.appendChild(el("p", "muted", "Detection failed: " + msg));
      }
    });
  }

  loadRepos();
  return card;
}

/* Links card: conversations + workspace repos. */
function projLinksCard(pr, id) {
  var UI = window.NeutronUI;
  var card = el("section", "panel");
  card.appendChild(el("h2", null, "Links"));

  /* Conversations. */
  card.appendChild(el("h3", null, "Conversations"));
  var convBox = el("div", null);
  card.appendChild(convBox);
  function paintConvs() {
    convBox.innerHTML = "";
    try { loadConvStore(); } catch (e) { /* history unavailable */ }
    var linked = pr.linkedConversationIds || [];
    if (!linked.length) convBox.appendChild(el("p", "muted small", "No linked conversations."));
    linked.forEach(function (cid) {
      var row = el("div", "row proj-item");
      var c = convStore && convStore.items[cid];
      var open = el("button", "linklike", c ? UI.convDisplayTitle(c) : "(deleted conversation)");
      if (c) open.onclick = function () { location.hash = "#/chat/" + encodeURIComponent(cid); };
      else open.disabled = true;
      var del = el("button", "icon-btn", "\u00D7");
      del.setAttribute("aria-label", "Unlink conversation");
      del.onclick = function () { UI.unlinkConversation(pr, cid); saveProjectStore(); paintConvs(); };
      row.appendChild(open); row.appendChild(del);
      convBox.appendChild(row);
    });
    /* Link picker. */
    if (convStore) {
      var others = Object.keys(convStore.items).filter(function (cid) {
        return linked.indexOf(cid) === -1 && !convStore.items[cid].archived;
      });
      if (others.length) {
        var r2 = el("div", "row");
        var sel = document.createElement("select");
        sel.className = "input"; sel.setAttribute("aria-label", "Conversation to link");
        others.forEach(function (cid) {
          var o = document.createElement("option");
          o.value = cid; o.textContent = UI.convDisplayTitle(convStore.items[cid]);
          sel.appendChild(o);
        });
        var link = el("button", "btn sm", "Link");
        link.onclick = function () {
          UI.linkConversation(pr, sel.value);
          saveProjectStore(); paintConvs(); toast("Conversation linked.");
        };
        r2.appendChild(sel); r2.appendChild(link);
        convBox.appendChild(r2);
      }
    }
  }
  paintConvs();

  /* Repos. */
  card.appendChild(el("h3", null, "Workspace repositories"));
  var repoBox = el("div", null);
  card.appendChild(repoBox);
  function paintRepos() {
    repoBox.innerHTML = "";
    (pr.linkedRepoNames || []).forEach(function (n) {
      var row = el("div", "row proj-item");
      row.appendChild(el("span", "mono", n));
      var del = el("button", "icon-btn", "\u00D7");
      del.setAttribute("aria-label", "Unlink repository " + n);
      del.onclick = function () { UI.unlinkRepo(pr, n); saveProjectStore(); paintRepos(); };
      row.appendChild(del);
      repoBox.appendChild(row);
    });
    var r3 = el("div", "row");
    var nameIn = el("input", "input");
    nameIn.placeholder = "Repository name…";
    nameIn.maxLength = 200;
    nameIn.setAttribute("aria-label", "Repository name to link");
    var linkBtn = el("button", "btn sm", "Link");
    function doLink() {
      if (!nameIn.value.trim()) { showError("Enter a repository name."); return; }
      UI.linkRepo(pr, nameIn.value);
      saveProjectStore(); nameIn.value = ""; paintRepos(); toast("Repository linked.");
    }
    linkBtn.onclick = doLink;
    nameIn.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); doLink(); } });
    r3.appendChild(nameIn); r3.appendChild(linkBtn);
    repoBox.appendChild(r3);
    repoBox.appendChild(el("p", "muted small", "Tip: use the exact workspace name from \u201CWorkspace repositories\u201D below so auto-detect can read it."));
  }
  paintRepos();
  return card;
}

/* ---------- repositories ---------- */

async function renderRepos(view) {
  /* Sub-route: #/repos/project/<id> shows the project detail view. */
  var sub = (location.hash || "").replace(/^#\/?/, "").split("/");
  if (sub.length >= 3 && sub[1] === "project" && sub[2]) {
    try { renderProjectDetail(view, decodeURIComponent(sub[2])); }
    catch (e) { view.appendChild(el("p", "muted", "Could not open the project.")); }
    return;
  }
  view.appendChild(el("h1", null, "Repositories"));
  try { renderProjectsSection(view); }
  catch (e) { /* projects are additive — never break the repos view */ }
  try {
    if (window.NeutronCheckpoints) {
      var cpWrap = el("div", "repos-checkpoints");
      view.appendChild(cpWrap);
      window.NeutronCheckpoints.renderPanel(cpWrap);
    }
  } catch (e) { /* checkpoints are additive — never break the repos view */ }
  try {
    if (window.NeutronGit) {
      var gitWrap = el("div", "repos-git");
      view.appendChild(gitWrap);
      window.NeutronGit.renderPanel(gitWrap);
    }
  } catch (e) { /* git panel is additive — never break the repos view */ }
  try {
    if (window.NeutronGitHub) {
      var ghWrap = el("div", "repos-github");
      view.appendChild(ghWrap);
      window.NeutronGitHub.renderPanel(ghWrap);
    }
  } catch (e) { /* github panel is additive — never break the repos view */ }
  /* Skeleton while the status call is in flight — no blank screen. */
  var sk = el("section", "panel skeleton-card");
  sk.setAttribute("aria-busy", "true");
  sk.appendChild(el("div", "skeleton sk-line sk-w40"));
  sk.appendChild(el("div", "skeleton sk-line"));
  sk.appendChild(el("div", "skeleton sk-line sk-w60"));
  view.appendChild(sk);

  var st;
  try {
    st = await api("GET", "/api/demo/status");
  } catch (e) {
    sk.innerHTML = "";
    sk.appendChild(el("p", "muted", "Could not reach the server. Check your connection and try again."));
    return;
  }
  sk.parentNode.removeChild(sk);

  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Demo repository"));
  p.appendChild(kvGrid([
    ["Name", st.demoRepository],
    ["Description", st.demoDescription],
    ["Workspace ready", st.workspaceReady ? "yes" : "no"],
    ["Cloning", st.cloneEnabled ? "enabled" : "disabled"],
  ]));
  p.appendChild(el("p", "muted small",
    "The demo repository is a small scaffolded project the real pipeline analyzes in milliseconds. You can also clone any public GitHub repository and maintain it the same way."));
  view.appendChild(p);

  var c = el("section", "panel");
  c.appendChild(el("h2", null, "Clone a repository"));
  var urlIn = el("input", "input");
  urlIn.placeholder = "https://github.com/owner/repo";
  urlIn.setAttribute("aria-label", "Repository URL");
  c.appendChild(field("PUBLIC GIT URL", urlIn));
  var row = el("div", "row");
  var go = el("button", "btn primary", "Clone");
  go.onclick = async function () {
    var url = urlIn.value.trim();
    if (!url) { showError("Enter a repository URL first."); return; }
    clearError();
    go.disabled = true; go.textContent = "Cloning…";
    try {
      var r = await api("POST", "/api/demo/repos", { url: url });
      c.appendChild(notice("", "Cloned as \"" + r.repository + "\". Use that name as the repository in Maintain."));
      paintRepoList();
    } catch (e) {
      showError(e && e.message ? e.message : String(e));
    }
    go.disabled = false; go.textContent = "Clone";
  };
  row.appendChild(go);
  c.appendChild(row);
  view.appendChild(c);

  /* Repositories actually present in the workspace (demo + clones). */
  var rl = el("section", "panel");
  rl.appendChild(el("h2", null, "Workspace repositories"));
  var rlBody = el("div", null);
  rl.appendChild(rlBody);
  rl.appendChild(el("p", "muted small",
    "On serverless deployments the workspace is per-instance, so clones made here may not be visible after a redeploy — the persistent Node host keeps them."));
  view.appendChild(rl);
  async function paintRepoList() {
    rlBody.innerHTML = "";
    var sk2 = el("div", "skeleton sk-line");
    sk2.setAttribute("aria-busy", "true");
    rlBody.appendChild(sk2);
    try {
      var rr = await api("GET", "/api/demo/repos");
      rlBody.innerHTML = "";
      var repos = (rr && Array.isArray(rr.repos)) ? rr.repos : [];
      if (!repos.length) {
        rlBody.appendChild(el("p", "muted", "No repositories in the workspace yet. Clone one above."));
        return;
      }
      var ul = el("ul", "list");
      repos.forEach(function (rp) {
        var li = el("li");
        li.appendChild(el("span", "mono", (rp && rp.name) || "—"));
        li.appendChild(el("span", "muted small",
          " · " + (rp && typeof rp.files === "number" ? rp.files + " files" : "—") +
          " · use \"" + ((rp && rp.name) || "") + "\" as the repository in Maintain"));
        ul.appendChild(li);
      });
      rlBody.appendChild(ul);
    } catch (e) {
      rlBody.innerHTML = "";
      rlBody.appendChild(el("p", "muted", "Could not list workspace repositories."));
    }
  }
  paintRepoList();
}

/* ---------- maintain wizard (on /api/demo/*) ---------- */

var WIZARD_STEPS = ["REQUEST", "ANALYSIS", "IMPACT", "PLAN", "APPROVAL", "EXECUTE", "RESULT"];

var mz = null; // wizard state, reset on each entry to #/maintain

var WIZARD_STORAGE = "neutron_maintain_wizard";

/* Persist the wizard after every step so a reload or accidental
   navigation never loses analysis/plan/approval progress.
   Quota errors are swallowed — persistence is best-effort. */
function persistWizard() {
  try {
    var UI = window.NeutronUI;
    if (!UI || !mz) return;
    var clean = UI.sanitizeWizard(mz);
    if (!clean) return;
    localStorage.setItem(WIZARD_STORAGE, JSON.stringify(clean));
  } catch (e) { /* private mode or quota — not fatal */ }
}

function restoreWizard() {
  try {
    var UI = window.NeutronUI;
    if (!UI) return null;
    var raw = localStorage.getItem(WIZARD_STORAGE);
    if (!raw) return null;
    var obj = JSON.parse(raw);
    if (!UI.isValidWizardState(obj, WIZARD_STEPS)) return null;
    return obj;
  } catch (e) { return null; }
}

function clearWizard() {
  try { localStorage.removeItem(WIZARD_STORAGE); } catch (e) {}
}

function stepsBar(current) {
  var bar = el("div", "steps");
  WIZARD_STEPS.forEach(function (s) {
    var cls = "step";
    var idx = WIZARD_STEPS.indexOf(s), cur = WIZARD_STEPS.indexOf(current);
    if (idx < cur) cls += " done";
    if (idx === cur) cls += " current";
    bar.appendChild(el("div", cls, (idx < cur ? "✓ " : "") + s));
  });
  return bar;
}

function freshWizard() {
  return {
    step: "REQUEST",
    form: { repo: "demo", request: "", riskTolerance: "balanced" },
    analysisId: null, approvalToken: null,
    analysis: null, impact: null, plan: null,
    approved: false, rejected: false,
    jobId: null, job: null, result: null, unsupported: null,
  };
}

async function renderMaintain(view) {
  var saved = restoreWizard();
  view.appendChild(el("h1", null, "Maintain"));
  var body = el("div", null);
  view.appendChild(body);
  if (saved && saved.step && saved.step !== "REQUEST") {
    /* Offer to resume where the user left off. */
    var p = el("section", "panel");
    p.appendChild(el("h2", null, "Resume maintenance?"));
    p.appendChild(el("p", "muted",
      "You left off at step " + saved.step + " (repository: " +
      ((saved.form && saved.form.repo) || "demo") + "). Resume, or start over."));
    var row = el("div", "row");
    var resume = el("button", "btn primary", "Resume");
    resume.onclick = function () { mz = saved; persistWizard(); maintainRender(body); };
    var over = el("button", "btn ghost", "Start over");
    over.onclick = function () { clearWizard(); mz = freshWizard(); maintainRender(body); };
    row.appendChild(resume);
    row.appendChild(over);
    p.appendChild(row);
    body.appendChild(p);
    return;
  }
  mz = freshWizard();
  await maintainRender(body);
}

async function maintainRender(body) {
  persistWizard();
  body.innerHTML = "";
  body.appendChild(stepsBar(mz.step));
  var fn = {
    REQUEST: mzRequest, ANALYSIS: mzAnalysis, IMPACT: mzImpact, PLAN: mzPlan,
    APPROVAL: mzApproval, EXECUTE: mzExecute, RESULT: mzResult,
  }[mz.step];
  try {
    await fn(body);
  } catch (e) {
    showError(e && e.message ? e.message : String(e));
  }
}

function mzStartOver(body) {
  var row = el("div", "row");
  var b = el("button", "btn ghost", "Start over");
  b.onclick = function () { clearWizard(); renderMaintain(document.getElementById("view")); };
  row.appendChild(b);
  body.appendChild(row);
}

async function mzRequest(body) {
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "New maintenance request"));

  var repoIn = el("input", "input");
  repoIn.value = mz.form.repo;
  repoIn.placeholder = "demo — or a cloned repo name, or a GitHub URL to clone";
  var reqIn = el("textarea", "input");
  reqIn.placeholder = "e.g. Fix the login redirect loop on the settings page";
  reqIn.value = mz.form.request;
  var riskSel = selectInput(
    [{ label: "safe", value: "safe" }, { label: "balanced", value: "balanced" }, { label: "aggressive", value: "aggressive" }],
    mz.form.riskTolerance);

  p.appendChild(field("REPOSITORY", repoIn));
  p.appendChild(field("MAINTENANCE REQUEST", reqIn));
  p.appendChild(field("RISK TOLERANCE", riskSel));
  p.appendChild(el("p", "muted small",
    "Use \"demo\" for the scaffolded project, a cloned repository name, or paste a public GitHub URL — it will be cloned first. Analysis and planning run now; code only changes after you explicitly approve the plan."));

  var row = el("div", "row");
  var go = el("button", "btn primary", "Analyze repository");
  go.onclick = async function () {
    var repo = repoIn.value.trim() || "demo";
    mz.form.repo = repo;
    mz.form.request = reqIn.value.trim();
    mz.form.riskTolerance = riskSel.value;
    if (!mz.form.request) { showError("Describe the maintenance request first."); return; }
    clearError();
    go.disabled = true; go.textContent = "Analyzing…";
    try {
      if (/^https?:\/\//i.test(repo)) {
        go.textContent = "Cloning…";
        var cl = await api("POST", "/api/demo/repos", { url: repo });
        repo = cl.repository;
        mz.form.repo = repo;
        go.textContent = "Analyzing…";
      }
      var res = await api("POST", "/api/demo/analyze", {
        repo: repo, request: mz.form.request, riskTolerance: mz.form.riskTolerance,
      });
      mz.analysisId = res.analysisId;
      mz.analysis = res.analysis; mz.impact = res.impact; mz.plan = res.plan;
      mz.step = "ANALYSIS";
      await maintainRender(body);
    } catch (e) {
      showError(e && e.message ? e.message : String(e));
      go.disabled = false; go.textContent = "Analyze repository";
    }
  };
  row.appendChild(go);
  p.appendChild(row);
  body.appendChild(p);
}

async function mzAnalysis(body) {
  var a = mz.analysis;
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Repository analysis"));
  p.appendChild(kvGrid([
    ["Analysis ID", (mz.analysisId || "").slice(0, 18) + "…"],
    ["Health", a.health + "%"],
    ["Files analyzed", a.filesAnalyzed],
    ["Nodes", a.nodeCount],
    ["Analyzed at", (a.analyzedAt || "").slice(0, 19).replace("T", " ")],
  ]));
  p.appendChild(el("h3", null, "LANGUAGES")); chips(p, a.languages);
  p.appendChild(el("h3", null, "FRAMEWORKS")); chips(p, a.frameworks);
  p.appendChild(el("h3", null, "PACKAGE MANAGERS")); chips(p, a.packageManagers);
  p.appendChild(el("h3", null, "ENTRY POINTS")); chips(p, a.entryPoints);
  if (a.warnings && a.warnings.length) {
    p.appendChild(el("h3", null, "WARNINGS"));
    var ul = el("ul", "list");
    a.warnings.forEach(function (w) { ul.appendChild(el("li", "warn", w)); });
    p.appendChild(ul);
  }
  var row = el("div", "row");
  var next = el("button", "btn primary", "Continue to impact analysis");
  next.onclick = function () { mz.step = "IMPACT"; maintainRender(body); };
  row.appendChild(next);
  p.appendChild(row);
  body.appendChild(p);
  mzStartOver(body);
}

async function mzImpact(body) {
  var g = mz.impact;
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Impact analysis"));
  p.appendChild(kvGrid(Object.keys(g.summary || {}).map(function (k) { return [k, g.summary[k]]; })));
  if (g.whatCouldBreak && g.whatCouldBreak.length) {
    p.appendChild(el("h3", null, "WHAT COULD BREAK"));
    var ul = el("ul", "list");
    g.whatCouldBreak.forEach(function (w) { ul.appendChild(el("li", "warn", w)); });
    p.appendChild(ul);
  }
  var nodes = (g.nodes || []).slice(0, 40);
  if (nodes.length) {
    p.appendChild(el("h3", null, "IMPACTED NODES (SHOWING " + nodes.length + " OF " + g.nodes.length + ")"));
    p.appendChild(table(["Path", "Category", "Impact", "Confidence"],
      nodes.map(function (n) {
        return [cell(n.path, true), cell(n.category), cell(n.impact),
                cell(Math.round((n.confidence || 0) * 100) + "%")];
      })));
  }
  var row = el("div", "row");
  var next = el("button", "btn primary", "Continue to plan review");
  next.onclick = function () { mz.step = "PLAN"; maintainRender(body); };
  row.appendChild(next);
  p.appendChild(row);
  body.appendChild(p);
  mzStartOver(body);
}

async function mzPlan(body) {
  var plan = mz.plan;
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Maintenance plan — review required"));
  p.appendChild(el("p", null, plan.summary || ""));
  p.appendChild(kvGrid([
    ["Overall risk", plan.overallRisk], ["Tasks", (plan.tasks || []).length],
    ["Affected files", (plan.affectedFiles || []).length],
    ["Database migrations", plan.databaseMigrations],
  ]));
  if (plan.tasks && plan.tasks.length) {
    p.appendChild(el("h3", null, "TASKS"));
    var ul = el("ul", "list");
    plan.tasks.forEach(function (t, i) {
      var li = el("li");
      li.appendChild(el("div", "mono", (i + 1) + ". " + t.label));
      var fileBits = "";
      if (t.files && t.files.length) {
        fileBits = " · files: " + t.files.slice(0, 4).join(", ") +
          (t.files.length > 4 ? " (+" + (t.files.length - 4) + " more)" : "");
      }
      li.appendChild(el("div", "muted small",
        "agent: " + (t.agent || "—") + " · risk: " + (t.risk || "—") + fileBits));
      ul.appendChild(li);
    });
    p.appendChild(ul);
  }
  ["affectedFiles", "affectedServices", "affectedTests"].forEach(function (k) {
    if (plan[k] && plan[k].length) {
      p.appendChild(el("h3", null, k.replace(/([A-Z])/g, " $1").toUpperCase()));
      chips(p, plan[k], 12);
    }
  });
  var row = el("div", "row");
  var cont = el("button", "btn primary", "Continue to approval gate");
  cont.onclick = function () { mz.step = "APPROVAL"; maintainRender(body); };
  row.appendChild(cont);
  p.appendChild(row);
  body.appendChild(p);
  mzStartOver(body);
}

async function mzApproval(body) {
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Human approval gate"));
  p.appendChild(notice("", "Fail-closed: nothing executes unless you explicitly approve this exact plan. The approval is single-use."));
  p.appendChild(el("p", "mono small", "Request: " + mz.form.request));

  var row = el("div", "row");
  var approveBtn = el("button", "btn primary", "Approve plan");
  var rejectBtn = el("button", "btn danger", "Reject plan");
  approveBtn.onclick = async function () {
    approveBtn.disabled = true; rejectBtn.disabled = true;
    approveBtn.textContent = "Approving…";
    try {
      var r = await api("POST", "/api/demo/approve", { analysisId: mz.analysisId });
      mz.approved = true; mz.rejected = false;
      mz.approvalToken = r.approvalToken || null; // serverless deployments issue a signed token
      mz.step = "EXECUTE";
      await maintainRender(body);
    } catch (e) {
      showError(e && e.message ? e.message : String(e));
      approveBtn.disabled = false; rejectBtn.disabled = false;
      approveBtn.textContent = "Approve plan";
    }
  };
  rejectBtn.onclick = async function () {
    rejectBtn.disabled = true;
    try { await api("POST", "/api/demo/reject", { analysisId: mz.analysisId }); } catch (e) { /* best effort */ }
    mz.approved = false; mz.rejected = true;
    mz.step = "EXECUTE";
    maintainRender(body);
  };
  row.appendChild(approveBtn);
  row.appendChild(rejectBtn);
  p.appendChild(row);
  body.appendChild(p);
  mzStartOver(body);
}

async function mzExecute(body) {
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Execute"));

  if (mz.rejected) {
    p.appendChild(el("div", "rejected-stamp", "PLAN REJECTED"));
    p.appendChild(el("p", null, "The approval gate stays closed. Nothing will be executed."));
    body.appendChild(p);
    mzStartOver(body);
    return;
  }

  p.appendChild(el("div", "approved-stamp", "PLAN APPROVED"));
  p.appendChild(el("p", "muted small",
    "Single-use approval recorded for this exact plan." +
    (storedApiKey() ? " Your saved API key will be sent with the execution request." :
      " No API key is set in Settings — the run will report honestly if no provider is configured.")));

  var row = el("div", "row");
  var go = el("button", "btn primary", "Execute maintenance");
  var live = el("div", null);
  go.onclick = async function () {
    go.disabled = true; go.textContent = "Starting…";
    clearError();
    try {
      var reqBody = { analysisId: mz.analysisId };
      if (mz.approvalToken) reqBody.approvalToken = mz.approvalToken;
      var res = await api("POST", "/api/demo/execute", reqBody);
      if (res.executionUnsupported) {
        // Honest serverless limit — surfaced exactly as the API reports it.
        mz.unsupported = res.message;
        mz.step = "RESULT";
        await maintainRender(body);
        return;
      }
      mz.jobId = res.jobId;
      recordJob({ jobId: res.jobId, request: mz.form.request, repository: res.repository, createdAt: res.createdAt });
      go.textContent = "Running…";
      var job = await pollJob(res.jobId, function (j) { paintLiveJob(live, j); });
      mz.job = job;
      try {
        var r = await api("GET", "/api/demo/jobs/" + encodeURIComponent(res.jobId) + "/result");
        mz.result = r.result;
      } catch (e) {
        mz.result = null;
      }
      mz.step = "RESULT";
      await maintainRender(body);
    } catch (e) {
      go.disabled = false; go.textContent = "Execute maintenance";
      if (e && e.requiresApproval) {
        /* The single-use approval is gone (consumed, expired, or the wizard
           was restored without one). Don't dead-end: send them back to the
           approval step with a clear explanation. */
        showError("That approval is no longer valid — approvals are single-use. Review the plan and approve it again, then execute.");
        var old = p.querySelector(".approval-back-row");
        if (old) old.parentNode.removeChild(old);
        var backRow = el("div", "row approval-back-row");
        var backBtn = el("button", "btn primary", "← Back to approval");
        backBtn.onclick = async function () {
          clearError();
          mz.step = "APPROVAL";
          persistWizard();
          await maintainRender(body);
        };
        backRow.appendChild(backBtn);
        p.appendChild(backRow);
      } else {
        showError(e && e.message ? e.message : String(e));
      }
    }
  };
  row.appendChild(go);
  p.appendChild(row);
  p.appendChild(live);
  body.appendChild(p);
  mzStartOver(body);
}

async function pollJob(jobId, onUpdate, maxWaitMs) {
  /* A stuck job must never poll forever (battery/data on mobile).
     10 minutes comfortably covers real runs; the api() timeout also
     breaks the loop on network stalls. */
  var maxWait = (typeof maxWaitMs === "number" && maxWaitMs > 0) ? maxWaitMs : 10 * 60 * 1000;
  var start = Date.now();
  for (;;) {
    var r = await api("GET", "/api/demo/jobs/" + encodeURIComponent(jobId));
    var job = r.job;
    onUpdate(job);
    if (job.status === "completed" || job.status === "failed" || job.status === "denied") return job;
    if (Date.now() - start >= maxWait) {
      throw new Error("Timed out waiting for the job to finish — check Reports for its latest state.");
    }
    await sleep(2500);
  }
}

function paintLiveJob(container, job) {
  container.innerHTML = "";
  container.appendChild(el("h3", null, "LIVE — " + String(job.status).toUpperCase()));
  if (job.stages && job.stages.length) {
    container.appendChild(table(["Stage", "Status", "Detail"],
      job.stages.map(function (s) {
        return [cell(s.label || s.key), cell(s.status), cell((s.detail || "").slice(0, 120))];
      })));
  }
  var tail = (job.events || []).slice(-6);
  if (tail.length) {
    var ul = el("ul", "list");
    tail.forEach(function (ev) { ul.appendChild(el("li", "mono small", ev.message || "")); });
    container.appendChild(ul);
  }
}

async function mzResult(body) {
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Result"));

  if (mz.unsupported) {
    p.appendChild(notice("warn", "EXECUTION NOT AVAILABLE ON THIS SERVER"));
    p.appendChild(el("p", null, mz.unsupported));
    p.appendChild(el("p", "muted small",
      "Everything up to this point — repository analysis, impact analysis, implementation plan, and your approval — ran for real. Full agent execution needs the persistent Node server (it cannot fit serverless function limits)."));
    body.appendChild(p);
    mzStartOver(body);
    return;
  }

  var job = mz.job || {};
  p.appendChild(kvGrid([
    ["Job ID", (mz.jobId || "").slice(0, 20) + "…"],
    ["Status", job.status || "—"],
    ["No-LLM mode", job.noLlm ? "yes — implementation honestly skipped" : "no"],
    ["Finished", (job.finishedAt || "").slice(0, 19).replace("T", " ")],
  ]));
  if (job.error) p.appendChild(el("p", "warn", "Error: " + job.error));
  if (job.stages && job.stages.length) {
    p.appendChild(el("h3", null, "STAGES"));
    p.appendChild(table(["Stage", "Status", "Detail"],
      job.stages.map(function (s) {
        return [cell(s.label || s.key), cell(s.status), cell((s.detail || "").slice(0, 160))];
      })));
  }
  var res = mz.result || {};
  [["Test result", res.testResult], ["Security review", res.security],
   ["Code review", res.codeReview], ["Release gate", res.release]].forEach(function (pair) {
    if (pair[1]) {
      p.appendChild(el("h3", null, pair[0].toUpperCase()));
      p.appendChild(el("p", "small mono", JSON.stringify(pair[1]).slice(0, 600)));
    }
  });
  ["deviations", "errors"].forEach(function (k) {
    if (res[k] && res[k].length) {
      p.appendChild(el("h3", null, k.toUpperCase()));
      var ul = el("ul", "list");
      res[k].forEach(function (x) { ul.appendChild(el("li", "warn", x)); });
      p.appendChild(ul);
    }
  });
  if (mz.result) p.appendChild(dump("FULL RESULT JSON", mz.result));
  body.appendChild(p);
  var row = el("div", "row");
  var rep = el("a", "btn", "Open in Reports");
  rep.href = "#/reports";
  row.appendChild(rep);
  p.appendChild(row);
  mzStartOver(body);
}

/* ---------- reports (local job history; server memory on Node) ---------- */

async function renderReports(view) {
  view.appendChild(el("h1", null, "Reports"));
  var sub = (location.hash.split("/")[1] || "");
  if (sub) { await renderJobDetail(view, sub); return; }

  var runs = jobHistory();
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Past runs (" + runs.length + ")"));
  if (!runs.length) {
    p.appendChild(el("p", "muted", "No runs recorded yet. Run the Maintain flow to create one."));
  } else {
    p.appendChild(table(["Job", "Request", "Repository", "Started"],
      runs.map(function (x) {
        return [cell((x.jobId || "").slice(0, 16) + "…", true),
                cell((x.request || "").slice(0, 50)),
                cell(x.repository || "—"),
                cell((x.createdAt || "").slice(0, 19).replace("T", " "))];
      })));
    var list = el("div", "chips");
    runs.slice(0, 20).forEach(function (x) {
      var a = el("a", "chip", (x.jobId || "").slice(0, 16) + "…");
      a.href = "#/reports/" + encodeURIComponent(x.jobId);
      list.appendChild(a);
    });
    p.appendChild(list);
  }
  p.appendChild(el("p", "muted small",
    "This list lives in this browser. Full job records live in the server's memory on the persistent Node host; on serverless deployments they are honestly unavailable."));
  view.appendChild(p);
}

async function renderJobDetail(view, id) {
  var back = el("a", "btn ghost", "← All reports");
  back.href = "#/reports";
  view.appendChild(back);
  view.appendChild(el("p", null, ""));
  try {
    var r = await api("GET", "/api/demo/jobs/" + encodeURIComponent(id));
    var job = r.job;
    view.appendChild(el("h1", "mono", (job.jobId || id).slice(0, 24) + "…"));
    var p = el("section", "panel");
    p.appendChild(el("h2", null, "Job"));
    p.appendChild(kvGrid([
      ["Status", job.status || "—"],
      ["Request", (job.request || "").slice(0, 80)],
      ["Repository", job.repository || "—"],
      ["No-LLM mode", job.noLlm ? "yes" : "no"],
      ["Events", String(job.eventCount != null ? job.eventCount : (job.events || []).length)],
    ]));
    if (job.error) p.appendChild(el("p", "warn", "Error: " + job.error));
    if (job.stages && job.stages.length) {
      p.appendChild(el("h3", null, "STAGES"));
      p.appendChild(table(["Stage", "Status", "Detail"],
        job.stages.map(function (s) {
          return [cell(s.label || s.key), cell(s.status), cell((s.detail || "").slice(0, 160))];
        })));
    }
    view.appendChild(p);
    try {
      var rr = await api("GET", "/api/demo/jobs/" + encodeURIComponent(id) + "/result");
      if (rr.result) {
        var q = el("section", "panel");
        q.appendChild(el("h2", null, "Result"));
        /* Human-readable summary first — the raw JSON stays available
           underneath for auditing. */
        var NUS = window.NeutronUI;
        var summ = (NUS && NUS.summarizeJobResult) ? NUS.summarizeJobResult(rr.result) : null;
        if (summ) {
          if (summ.execution) {
            var ex = summ.execution;
            q.appendChild(el("h3", null, "EXECUTION"));
            q.appendChild(kvGrid([
              ["Completed", String(ex.completed)],
              ["Failed", String(ex.failed)],
              ["Blocked", String(ex.blocked)],
              ["No-LLM mode", ex.noLlm ? "yes" : "no"],
            ]));
            if (ex.changes.length) {
              q.appendChild(el("p", "muted small",
                "Showing " + ex.changes.length + " of " + ex.changeCount + " file changes."));
              q.appendChild(table(["Path", "Kind", "+/−", "Agent", "Risk"],
                ex.changes.map(function (c) {
                  return [cell(c.path, true), cell(c.kind),
                          cell("+" + c.added + " / −" + c.removed),
                          cell(c.agent), cell(c.risk)];
                })));
            }
          }
          if (summ.tests) {
            var ts = summ.tests;
            q.appendChild(el("h3", null, "TESTS"));
            var tRows = [["Command", ts.command || "—"]];
            if (ts.hasAfter) {
              tRows.push(["Passed", ts.passed + " / " + ts.total]);
              tRows.push(["Failed", String(ts.failed)]);
            }
            tRows.push(["Regression", ts.regression ? "yes" : "no"]);
            q.appendChild(kvGrid(tRows));
            if (ts.failedTests.length) {
              q.appendChild(el("p", "warn",
                "Failed tests (" + ts.failedTestCount + "): " + ts.failedTests.join(", ") +
                (ts.failedTestCount > ts.failedTests.length ? " (+" + (ts.failedTestCount - ts.failedTests.length) + " more)" : "")));
            }
          }
          if (summ.security) {
            var sec = summ.security;
            q.appendChild(el("h3", null, "SECURITY"));
            q.appendChild(el("p", sec.blocked ? "warn" : null,
              (sec.blocked ? "BLOCKED — " : "") + (sec.summary || "No summary.")));
            if (sec.findings.length) {
              q.appendChild(table(["Severity", "Finding", "File", "Category"],
                sec.findings.map(function (f) {
                  return [cell(f.severity), cell(f.title), cell(f.file, true), cell(f.category)];
                })));
              if (sec.truncated || sec.findingCount > sec.findings.length) {
                q.appendChild(el("p", "muted small",
                  "Showing " + sec.findings.length + " of " + sec.findingCount + " findings."));
              }
            }
          }
          if (summ.review) {
            var cr = summ.review;
            q.appendChild(el("h3", null, "CODE REVIEW"));
            q.appendChild(kvGrid([
              ["Score", String(cr.score)],
              ["Passed", cr.passed ? "yes" : "no"],
            ]));
            if (cr.summary) q.appendChild(el("p", "muted", cr.summary));
            if (cr.findings.length) {
              q.appendChild(table(["Severity", "Finding", "File"],
                cr.findings.map(function (f) {
                  return [cell(f.severity), cell(f.title), cell(f.file, true)];
                })));
            }
          }
          if (summ.release) {
            var rel = summ.release;
            q.appendChild(el("h3", null, "RELEASE"));
            q.appendChild(kvGrid([["Status", rel.status || "—"]]));
            if (rel.checks.length) {
              q.appendChild(table(["Check", "Result", "Detail"],
                rel.checks.map(function (c) {
                  return [cell(c.name), cell(c.ok ? "✓ pass" : "✗ fail"), cell(c.detail)];
                })));
            }
            if (rel.blockedBy.length) {
              q.appendChild(el("p", "warn", "Blocked by: " + rel.blockedBy.join(", ")));
            }
          }
          if (summ.deviations.length) {
            q.appendChild(el("h3", null, "DEVIATIONS"));
            var du = el("ul", "list");
            summ.deviations.forEach(function (d) { du.appendChild(el("li", "warn", d)); });
            q.appendChild(du);
          }
          if (summ.errors.length) {
            q.appendChild(el("h3", null, "ERRORS"));
            var eu = el("ul", "list");
            summ.errors.forEach(function (d) { eu.appendChild(el("li", "warn", d)); });
            q.appendChild(eu);
          }
        }
        q.appendChild(dump("FULL RESULT JSON", rr.result));
        view.appendChild(q);
      }
    } catch (e) { /* result may not be ready */ }
  } catch (e) {
    view.appendChild(notice("warn", "JOB NOT FOUND"));
    view.appendChild(el("p", "muted",
      "Job records live in the server's memory and do not survive restarts; on serverless deployments they never exist. " +
      "Detail: " + (e && e.message ? e.message : String(e))));
  }
}

/* ---------- chat (stateless /api/chat, history kept client-side) ---------- */

/* ---------- chat workspace (full-screen, attachments, voice, artifacts) ----------
   Chat is stateless: history lives in this browser (chatState). The API key
   goes as x-api-key, the provider as x-provider; neither is stored server-side.
   There is NO default provider: chat refuses to send until one is chosen.
   Attachments ride inside the JSON body as base64 (WebView-simple):
     attachments: [{ name, mime, kind: "image"|"text"|"zip", data: "<base64>" }]
   Server limits: 5 files, 100 KB per file, 512 KB total (said in the UI).
   Voice is client-side only: Web Speech API for input, speechSynthesis for
   output. No audio leaves the device except via the OS speech recognizer.
   File artifacts come back as res.artifacts and render as download cards.
   Honest limit: files are generated for DOWNLOAD — the app cannot write to
   the phone's folders or execute code on the serverless backend. */

/* ---------- conversation workspace (multi-conversation history) ----------
   BYOK has no accounts: this browser IS the user. Conversations live in
   localStorage under neutron_conversations — the same trust boundary as the
   API key. No server, no auth, no mock. The legacy single-chat key
   (neutron_chat_history) is migrated once into the new store, then removed. */

var chatState = { messages: [] }; /* live alias of the active conversation's messages */

var CHAT_STORAGE = "neutron_chat_history"; /* legacy key: read once for migration */
var CONV_STORAGE = "neutron_conversations";

function genConvId() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

var convStore = null;
var convSaveErrorShown = false;

/* Write the whole store (sanitized). Quota/private-mode failures surface an
   honest error instead of silently losing data. */
function saveConvStore() {
  if (!convStore) return true;
  try {
    var UI = window.NeutronUI;
    if (!UI) return false;
    var items = {};
    Object.keys(convStore.items).forEach(function (id) {
      var clean = UI.sanitizeConversation(convStore.items[id]);
      /* Never silently drop a conversation: if sanitize rejects it,
         keep the raw (JSON-safe) item so nothing is lost. */
      items[id] = (clean && clean.id) ? clean : convStore.items[id];
    });
    localStorage.setItem(CONV_STORAGE, JSON.stringify({
      version: UI.CONV_STORE_VERSION || 1,
      activeId: convStore.activeId,
      items: items,
    }));
    convSaveErrorShown = false;
    return true;
  } catch (e) {
    if (!convSaveErrorShown) {
      convSaveErrorShown = true;
      showError("Changes couldn't be saved — browser storage may be full. Your work is safe in memory for this session.");
    }
    return false;
  }
}

function loadConvStore() {
  if (convStore) return convStore;
  var UI = window.NeutronUI;
  if (!UI) throw new Error("UI utilities failed to load.");
  try {
    var raw = localStorage.getItem(CONV_STORAGE);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.version === UI.CONV_STORE_VERSION &&
          parsed.items && typeof parsed.items === "object") {
        convStore = parsed;
        if (!convStore.items[convStore.activeId]) {
          convStore.activeId = UI.mostRecentConvId(convStore, null);
        }
        if (!convStore.activeId) UI.convCreate(convStore, genConvId(), Date.now());
        return convStore;
      }
    }
  } catch (e) { /* corrupt → migrate fresh below */ }
  /* First run (or corrupt store): migrate the legacy single chat so the
     user's current conversation is never lost. */
  var legacy = null;
  try {
    var lraw = localStorage.getItem(CHAT_STORAGE);
    if (lraw) {
      var larr = JSON.parse(lraw);
      if (Array.isArray(larr)) legacy = larr;
    }
  } catch (e) { /* ignore */ }
  convStore = UI.migrateLegacyChat(legacy || [], storedProvider(), storedModel(),
    Date.now(), genConvId());
  try { localStorage.removeItem(CHAT_STORAGE); } catch (e) { /* best-effort */ }
  saveConvStore();
  return convStore;
}

/* The active conversation; always guarantees one exists. */
function activeConv() {
  loadConvStore();
  var UI = window.NeutronUI;
  var c = convStore.items[convStore.activeId];
  if (!c || c.archived) {
    var id = UI.mostRecentConvId(convStore, null);
    if (!id || !convStore.items[id]) {
      id = genConvId();
      var nc = UI.convCreate(convStore, id, Date.now());
      nc.provider = storedProvider();
      nc.model = storedModel();
      saveConvStore();
    }
    convStore.activeId = id;
    c = convStore.items[id];
  }
  return c;
}

/* Called after message mutations (paint/appendMsg). Auto-saves; updatedAt is
   bumped by convTouch at send time, not here. */
function persistChat() {
  saveConvStore();
}

/* ---------- project brain (device-local project intelligence) ----------
   BYOK has no accounts: this browser IS the user. Projects live in
   localStorage under neutron_projects — the same trust boundary as the API
   key. No server, no auth, no mock. Secrets are NEVER stored: saves are
   guarded by looksLikeSecret() and existing stores are scanned on load. */

var PROJECT_STORAGE = "neutron_projects";
var projectStore = null;
/* [{id, name, findings}] — populated by loadProjectStore; the Projects UI
   shows a warning banner. Flagged entries are never silently deleted. */
var projectSecretWarnings = [];

function genProjectId() {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function saveProjectStore() {
  if (!projectStore) return true;
  try {
    var UI = window.NeutronUI;
    if (!UI) return false;
    var items = {};
    Object.keys(projectStore.items).forEach(function (id) {
      var clean = UI.sanitizeProject(projectStore.items[id]);
      /* Never silently drop a project: keep the raw item if sanitize
         rejects it, so nothing is lost. */
      items[id] = (clean && clean.id) ? clean : projectStore.items[id];
    });
    localStorage.setItem(PROJECT_STORAGE, JSON.stringify({
      version: UI.PROJECT_STORE_VERSION || 1,
      items: items,
    }));
    return true;
  } catch (e) {
    showError("Project changes couldn't be saved — browser storage may be full.");
    return false;
  }
}

function loadProjectStore() {
  if (projectStore) return projectStore;
  var UI = window.NeutronUI;
  if (!UI) throw new Error("UI utilities failed to load.");
  projectStore = { version: UI.PROJECT_STORE_VERSION || 1, items: {} };
  projectSecretWarnings = [];
  try {
    var raw = localStorage.getItem(PROJECT_STORAGE);
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.items && typeof parsed.items === "object") {
        Object.keys(parsed.items).forEach(function (id) {
          var clean = UI.sanitizeProject(parsed.items[id]);
          if (clean && clean.id) projectStore.items[id] = clean;
        });
      }
    }
  } catch (e) { /* corrupt → start fresh; nothing else to recover from */ }
  /* Scan on load and flag — never silently delete the user's data. */
  try {
    Object.keys(projectStore.items).forEach(function (id) {
      var findings = UI.scanProjectSecrets(projectStore.items[id]);
      if (findings.length) {
        projectSecretWarnings.push({ id: id, name: projectStore.items[id].name, findings: findings });
      }
    });
  } catch (e) { /* scanning is best-effort */ }
  return projectStore;
}

/* Guard helper for project-memory saves. Returns true when the value is
   safe to store; shows an honest error naming the detected pattern. */
function guardProjectSecret(value) {
  var UI = window.NeutronUI;
  var label = UI && UI.looksLikeSecret ? UI.looksLikeSecret(value) : null;
  if (label) {
    showError("Not saved — that looks like a " + label + ". Never store secrets in project memory.");
    return false;
  }
  return true;
}

/* Screen-reader announcements for workspace actions. */
function announce(msg) {
  try {
    var s = document.getElementById("sr-status");
    if (!s) {
      s = document.createElement("div");
      s.id = "sr-status";
      s.className = "sr-only";
      s.setAttribute("role", "status");
      s.setAttribute("aria-live", "polite");
      document.body.appendChild(s);
    }
    s.textContent = "";
    setTimeout(function () { s.textContent = msg; }, 30);
  } catch (e) { /* best-effort */ }
}

/* Hooks the chat view registers so global shortcuts and route changes can
   reach it. Reset on every render(); only the chat route sets them. */
var ChatHooks = {
  newTask: null,
  toggleHistory: null,
  focusHistorySearch: null,
  closeOverlays: null,
  moveHistSelection: null,
  outsideClick: null,
};

function b64decode(s) {
  var bin = atob(s);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function downloadAttachment(a) {
  try {
    if (!a || !a.data) throw new Error("no data");
    var blob = new Blob([b64decode(a.data)], { type: a.mime || "application/octet-stream" });
    downloadBlob(blob, a.name || "file");
  } catch (e) {
    showError("Could not download \"" + (a && a.name ? a.name : "file") + "\".");
  }
}

var VOICE_SPEAK_STORAGE = "neutron_voice_speak";
function voiceSpeakEnabled() {
  try { return localStorage.getItem(VOICE_SPEAK_STORAGE) === "1"; } catch (e) { return false; }
}
function setVoiceSpeakEnabled(on) {
  try { localStorage.setItem(VOICE_SPEAK_STORAGE, on ? "1" : "0"); } catch (e) { /* private mode */ }
}

function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function downloadBlob(blob, name) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = name || "download";
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} a.remove(); }, 4000);
}

function b64encode(buf) {
  var bytes = new Uint8Array(buf);
  var s = "";
  for (var i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function utf8Decode(buf) {
  try {
    var dec = new TextDecoder("utf-8", { fatal: true });
    return dec.decode(buf);
  } catch (e) {
    return null;
  }
}

async function renderChat(view) {
  /* Conversation workspace: load the store (migrating the legacy single
     chat once), then alias the live message buffer to the active
     conversation. Everything below mutates through the store. */
  try {
    loadConvStore();
  } catch (e) {
    view.appendChild(el("h1", null, "Chat"));
    var errBox = el("div", "panel");
    errBox.appendChild(el("p", null, "Unable to load history."));
    errBox.appendChild(el("p", "muted small", e && e.message ? e.message : String(e)));
    var retryBtn = el("button", "btn primary", "Retry");
    retryBtn.onclick = function () { render(); };
    errBox.appendChild(retryBtn);
    view.appendChild(errBox);
    return;
  }
  chatState.messages = activeConv().messages;
  /* Deep link: #/chat/<conversationId> opens that conversation
     (e.g. from the dashboard's recent activity). Unknown or archived
     ids are ignored — the active conversation stays. */
  try {
    var UIdeep = window.NeutronUI;
    var sub = (location.hash || "").replace(/^#\/?/, "").split("/");
    if (sub.length > 1 && sub[1] && UIdeep && UIdeep.convSetActive(convStore, decodeURIComponent(sub[1]))) {
      saveConvStore();
      chatState.messages = activeConv().messages;
    }
  } catch (e) { /* malformed hash — ignore */ }
  /* Project deep link: set from a project's "Chat with this project" button.
     Attaches the project to this conversation and links the two. */
  try {
    var pendPid = window.__neutronPendingProject;
    window.__neutronPendingProject = null;
    if (pendPid) {
      loadProjectStore();
      var UIpp = window.NeutronUI;
      var pendProj = UIpp && UIpp.projectGet(projectStore, String(pendPid));
      if (pendProj) {
        var pc = activeConv();
        pc.projectId = pendProj.id;
        pc.projectContextOn = true;
        UIpp.linkConversation(pendProj, pc.id);
        saveConvStore();
        saveProjectStore();
        chatState.messages = pc.messages;
        toast("Project \"" + pendProj.name + "\" attached — its memory rides along as context.");
      }
    }
  } catch (e) { /* best-effort */ }
  /* A linked project may have been deleted elsewhere: clear the stale link. */
  try {
    var _c = activeConv();
    if (_c.projectId) {
      loadProjectStore();
      var _UI = window.NeutronUI;
      if (_UI && !_UI.projectGet(projectStore, _c.projectId)) {
        _c.projectId = ""; saveConvStore();
      }
    }
  } catch (e) { /* best-effort */ }
  var providers = await fetchProviders();
  var byId = {};
  providers.forEach(function (pr) { byId[pr.id] = pr; });

  var root = el("div", "chat-root has-history");
  var main = el("div", "chat-main");

  /* ================= conversation history workspace ================= */
  var histOpen = false;
  try { histOpen = window.innerWidth > 900; } catch (e) { histOpen = false; }
  var histMode = "list"; /* list | archived */
  var histQuery = "";
  var histSearchTimer = null;
  var histItemMenu = null; /* { id, el, invoker } */
  var histModal = null;   /* { el, invoker, close } */

  var histBackdrop = el("div", "hist-backdrop hidden");
  histBackdrop.setAttribute("aria-hidden", "true");
  histBackdrop.onclick = function () { setHistOpen(false); };

  var histPanel = el("aside", "history-panel");
  histPanel.setAttribute("aria-label", "Conversation history");

  function setHistOpen(open) {
    histOpen = !!open;
    histPanel.classList.toggle("open", histOpen);
    histPanel.setAttribute("aria-hidden", histOpen ? "false" : "true");
    histBackdrop.classList.toggle("hidden", !histOpen);
    try { histBtn.setAttribute("aria-expanded", histOpen ? "true" : "false"); } catch (e) {}
  }

  var histHead = el("div", "hist-head");
  histHead.appendChild(el("div", "hist-title", "History"));
  var histClose = el("button", "icon-btn hist-close", "×");
  histClose.setAttribute("aria-label", "Close history panel");
  histClose.onclick = function () { setHistOpen(false); };
  histHead.appendChild(histClose);
  histPanel.appendChild(histHead);

  var histSearch = document.createElement("input");
  histSearch.type = "search";
  histSearch.className = "input hist-search";
  histSearch.placeholder = "Search history…";
  histSearch.setAttribute("aria-label", "Search conversation history");
  histSearch.autocomplete = "off";
  histSearch.addEventListener("input", function () {
    if (histSearchTimer) clearTimeout(histSearchTimer);
    histSearchTimer = setTimeout(function () {
      histQuery = histSearch.value;
      paintHistory();
    }, 200);
  });
  histPanel.appendChild(histSearch);

  var histNewBtn = el("button", "btn primary hist-new", "+ New task");
  histNewBtn.setAttribute("aria-label", "Start a new task");
  histNewBtn.onclick = function () { newTask(); };
  histPanel.appendChild(histNewBtn);

  var histList = el("div", "hist-list");
  histList.setAttribute("aria-label", "Conversations");
  histPanel.appendChild(histList);

  var histFoot = el("div", "hist-foot");
  var histArchBtn = el("button", "btn ghost sm", "Archived");
  histArchBtn.onclick = function () {
    histMode = histMode === "archived" ? "list" : "archived";
    paintHistory();
  };
  histFoot.appendChild(histArchBtn);
  histPanel.appendChild(histFoot);

  /* Re-sync the whole chat column to the store's active conversation. */
  function syncChatToActive(opts) {
    opts = opts || {};
    var c = activeConv();
    chatState.messages = c.messages;
    renderAll = false;
    lastFailedBody = null;
    syncPickersFromConv();
    try {
      var UI = window.NeutronUI;
      if (UI && chatTitleEl) chatTitleEl.textContent = UI.convDisplayTitle(c);
    } catch (e) {}
    try { projBtnLabel(); paintProjChip(); } catch (e) {}
    paint();
    if (opts.focus) {
      try { input.focus({ preventScroll: true }); }
      catch (e) { try { input.focus(); } catch (e2) {} }
    }
  }

  function openConversation(id, opts) {
    opts = opts || {};
    var c = convStore.items[id];
    if (!c || c.archived) return;
    if (convStore.activeId !== id) {
      convStore.activeId = id;
      saveConvStore();
    }
    syncChatToActive(opts);
    paintHistory();
    announce("Opened " + window.NeutronUI.convDisplayTitle(c) + ".");
    if (window.innerWidth <= 900) setHistOpen(false);
  }

  function newTask() {
    var UI = window.NeutronUI;
    var id = genConvId();
    var item = UI.convCreate(convStore, id, Date.now());
    if (!item) return;
    /* New tasks inherit the current provider/model choice. */
    item.provider = storedProvider();
    item.model = storedModel();
    saveConvStore();
    var NSU2 = window.NeutronUI;
    if (NSU2 && NSU2.stopSpeechSynthesis) NSU2.stopSpeechSynthesis();
    syncChatToActive({ focus: true });
    paintHistory();
    announce("New task started.");
    toast("New task started.");
    if (window.innerWidth <= 900) setHistOpen(false);
  }

  function duplicateTask(id) {
    var UI = window.NeutronUI;
    var copy = UI.convDuplicate(convStore, id, genConvId(), Date.now());
    if (!copy) { showError("Could not duplicate this task."); return; }
    saveConvStore();
    openConversation(copy.id, { focus: true });
    toast("Duplicated as a new task.");
  }

  function histGroupLabel(text) {
    return el("div", "hist-group", text);
  }

  function histItemEl(meta, now) {
    var UI = window.NeutronUI;
    var item = el("div", "hist-item" + (meta.id === convStore.activeId ? " active" : ""));
    var openBtn = el("button", "hist-open");
    openBtn.setAttribute("aria-label", "Open task: " + meta.title);
    var titleRow = el("div", "hist-item-title");
    titleRow.appendChild(el("span", null, meta.title));
    if (meta.pinned) {
      var pin = el("span", "hist-pin", "📌");
      pin.setAttribute("role", "img");
      pin.setAttribute("aria-label", "Pinned");
      titleRow.appendChild(pin);
    }
    openBtn.appendChild(titleRow);
    openBtn.appendChild(el("div", "hist-item-sub", UI.relativeTime(meta.updatedAt, now)));
    openBtn.onclick = function () { openConversation(meta.id, { focus: true }); };
    var kebab = el("button", "icon-btn hist-kebab", "⋮");
    kebab.setAttribute("aria-label", "Task actions for " + meta.title);
    kebab.setAttribute("aria-haspopup", "menu");
    kebab.setAttribute("aria-expanded", "false");
    kebab.onclick = function (ev) {
      ev.stopPropagation();
      toggleHistMenu(meta.id, kebab);
    };
    item.appendChild(openBtn);
    item.appendChild(kebab);
    return item;
  }

  function paintHistory() {
    var UI = window.NeutronUI;
    if (!UI) return;
    histList.innerHTML = "";
    closeHistMenu();
    var archCount = UI.archivedConversations(convStore.items).length;
    histArchBtn.textContent = histMode === "archived"
      ? "← Back to history"
      : "Archived" + (archCount ? " (" + archCount + ")" : "");
    if (histMode === "archived") { paintArchivedList(); return; }
    if (histQuery.trim()) { paintSearchList(); return; }
    var now = Date.now();
    var g = UI.groupConversations(convStore.items, now);
    if (!g.pinned.length && !g.groups.length) {
      var empty = el("div", "hist-empty");
      empty.appendChild(el("p", "hist-empty-title", "No tasks yet"));
      empty.appendChild(el("p", "muted small", "Start your first task and it will appear here."));
      var b = el("button", "btn primary sm", "+ New task");
      b.onclick = function () { newTask(); };
      empty.appendChild(b);
      histList.appendChild(empty);
      return;
    }
    if (g.pinned.length) {
      histList.appendChild(histGroupLabel("📌 Pinned"));
      g.pinned.forEach(function (meta) { histList.appendChild(histItemEl(meta, now)); });
    }
    g.groups.forEach(function (grp) {
      histList.appendChild(histGroupLabel(grp.label));
      grp.items.forEach(function (meta) { histList.appendChild(histItemEl(meta, now)); });
    });
  }

  function paintSearchList() {
    var UI = window.NeutronUI;
    var metas = UI.searchConversations(convStore.items, histQuery);
    var now = Date.now();
    if (!metas.length) {
      var empty = el("div", "hist-empty");
      empty.appendChild(el("p", "hist-empty-title", "No matching tasks"));
      empty.appendChild(el("p", "muted small", "Try another search term."));
      histList.appendChild(empty);
      return;
    }
    histList.appendChild(histGroupLabel(metas.length + (metas.length === 1 ? " result" : " results")));
    metas.forEach(function (meta) { histList.appendChild(histItemEl(meta, now)); });
  }

  function paintArchivedList() {
    var UI = window.NeutronUI;
    var metas = UI.archivedConversations(convStore.items);
    if (!metas.length) {
      var empty = el("div", "hist-empty");
      empty.appendChild(el("p", "hist-empty-title", "No archived tasks"));
      histList.appendChild(empty);
      return;
    }
    metas.forEach(function (meta) {
      var item = el("div", "hist-item");
      var openBtn = el("button", "hist-open");
      openBtn.setAttribute("aria-label", "Restore and open task: " + meta.title);
      openBtn.appendChild(el("div", "hist-item-title", meta.title));
      openBtn.appendChild(el("div", "hist-item-sub", UI.relativeTime(meta.updatedAt, Date.now())));
      openBtn.onclick = function () {
        UI.convSetArchived(convStore, meta.id, false, Date.now());
        saveConvStore();
        histMode = "list";
        announce("Task restored.");
        openConversation(meta.id, { focus: true });
      };
      var del = el("button", "btn ghost sm hist-del", "Delete");
      del.setAttribute("aria-label", "Delete permanently: " + meta.title);
      del.onclick = function (ev) {
        ev.stopPropagation();
        openDeleteDialog(meta.id, del);
      };
      item.appendChild(openBtn);
      item.appendChild(del);
      histList.appendChild(item);
    });
  }

  function paintHistoryLoading() {
    histList.innerHTML = "";
    for (var i = 0; i < 6; i++) {
      var sk = el("div", "hist-sk");
      sk.appendChild(el("div", "skeleton sk-line sk-w60"));
      sk.appendChild(el("div", "skeleton sk-line sk-w40"));
      histList.appendChild(sk);
    }
  }

  /* ----- item ⋮ menu ----- */
  function closeHistMenu() {
    if (histItemMenu) {
      if (histItemMenu.el.parentNode) histItemMenu.el.parentNode.removeChild(histItemMenu.el);
      try { histItemMenu.invoker.setAttribute("aria-expanded", "false"); } catch (e) {}
      histItemMenu = null;
    }
  }

  function toggleHistMenu(id, invoker) {
    if (histItemMenu && histItemMenu.id === id) { closeHistMenu(); return; }
    closeHistMenu();
    var UI = window.NeutronUI;
    var item = convStore.items[id];
    if (!item) return;
    var menu = el("div", "hist-menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Task actions");
    function addMi(label, fn, danger) {
      var b = el("button", "hist-menu-item" + (danger ? " danger" : ""));
      b.setAttribute("role", "menuitem");
      b.textContent = label;
      b.onclick = function () { closeHistMenu(); fn(); };
      menu.appendChild(b);
      return b;
    }
    addMi(item.pinned ? "Unpin" : "Pin", function () {
      UI.convSetPinned(convStore, id, !item.pinned);
      saveConvStore();
      paintHistory();
      announce(item.pinned ? "Task unpinned." : "Task pinned.");
      toast(item.pinned ? "Unpinned." : "Pinned to the top.");
      try { invoker.focus(); } catch (e) {}
    });
    addMi("Rename", function () { openRenameDialog(id, invoker); });
    addMi("Duplicate", function () { duplicateTask(id); });
    addMi("Archive", function () {
      UI.convSetArchived(convStore, id, true, Date.now());
      saveConvStore();
      syncChatToActive();
      paintHistory();
      announce("Task archived.");
      toast("Task archived.");
      try { invoker.focus(); } catch (e) {}
    });
    addMi("Delete", function () { openDeleteDialog(id, invoker); }, true);
    document.body.appendChild(menu);
    /* Position under the kebab, clamped to the viewport. */
    var r = invoker.getBoundingClientRect();
    var mw = 200;
    menu.style.top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 240)) + "px";
    menu.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + "px";
    histItemMenu = { id: id, el: menu, invoker: invoker };
    invoker.setAttribute("aria-expanded", "true");
    menu.addEventListener("keydown", function (ev) {
      if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
      ev.preventDefault();
      var btns = Array.prototype.slice.call(menu.querySelectorAll("button"));
      var i = btns.indexOf(document.activeElement);
      var n = ev.key === "ArrowDown" ? i + 1 : i - 1;
      if (n < 0) n = btns.length - 1;
      if (n >= btns.length) n = 0;
      btns[n].focus();
    });
    var first = menu.querySelector("button");
    if (first) { try { first.focus(); } catch (e) {} }
  }

  /* ----- modal dialogs (rename / delete confirm) ----- */
  function openHistModal(title, bodyEl, actions, invoker) {
    closeHistModal();
    var back = el("div", "hist-modal-back");
    var modal = el("div", "hist-modal");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", title);
    modal.appendChild(el("div", "hist-modal-title", title));
    modal.appendChild(bodyEl);
    var row = el("div", "hist-modal-actions");
    function close() {
      closeHistModal();
      if (invoker && invoker.focus) { try { invoker.focus(); } catch (e) {} }
    }
    actions.forEach(function (a) {
      var b = el("button", "btn " + (a.kind || "ghost"), a.label);
      b.onclick = function () {
        var keep = a.onClick ? a.onClick() : undefined;
        if (keep !== false) close();
      };
      row.appendChild(b);
    });
    modal.appendChild(row);
    back.appendChild(modal);
    back.addEventListener("mousedown", function (ev) {
      if (ev.target === back) close();
    });
    document.body.appendChild(back);
    histModal = { el: back, invoker: invoker, close: close };
    var focusable = bodyEl.querySelector("input") || row.querySelector("button");
    if (focusable) { try { focusable.focus(); } catch (e) {} }
    return close;
  }

  function closeHistModal() {
    if (histModal) {
      if (histModal.el.parentNode) histModal.el.parentNode.removeChild(histModal.el);
      histModal = null;
    }
  }

  function openRenameDialog(id, invoker) {
    var UI = window.NeutronUI;
    var item = convStore.items[id];
    if (!item) return;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "input";
    input.value = item.title || "";
    input.maxLength = 200;
    input.setAttribute("aria-label", "Task name");
    input.autocomplete = "off";
    var wrap = el("div", "hist-modal-body");
    wrap.appendChild(input);
    function doSave() {
      if (!input.value.trim()) {
        showError("Task name can't be empty.");
        input.focus();
        return false;
      }
      UI.convRename(convStore, id, input.value, Date.now());
      saveConvStore();
      paintHistory();
      try {
        if (chatTitleEl) chatTitleEl.textContent = UI.convDisplayTitle(activeConv());
      } catch (e) {}
      announce("Task renamed to " + input.value.trim() + ".");
      toast("Task renamed.");
      return true;
    }
    openHistModal("Rename task", wrap, [
      { label: "Cancel", kind: "ghost" },
      { label: "Save", kind: "primary", onClick: doSave },
    ], invoker);
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); if (doSave() !== false && histModal) histModal.close(); }
    });
    try { input.select(); } catch (e) {}
  }

  function openDeleteDialog(id, invoker) {
    var UI = window.NeutronUI;
    var item = convStore.items[id];
    if (!item) return;
    var wrap = el("div", "hist-modal-body");
    wrap.appendChild(el("p", null, "Delete this task?"));
    wrap.appendChild(el("p", "hist-del-name", "\u201C" + UI.convDisplayTitle(item) + "\u201D"));
    wrap.appendChild(el("p", "muted small",
      "This will permanently remove this task and its conversation."));
    openHistModal("Delete task", wrap, [
      { label: "Cancel", kind: "ghost" },
      { label: "Delete", kind: "danger", onClick: function () {
          var wasActive = convStore.activeId === id;
          UI.convDelete(convStore, id);
          saveConvStore();
          if (wasActive) syncChatToActive();
          paintHistory();
          announce("Task deleted.");
          toast("Task deleted.");
        } },
    ], invoker);
  }

  /* ----- keyboard selection across history items ----- */
  function moveHistSelection(dir) {
    var btns = Array.prototype.slice.call(histList.querySelectorAll(".hist-open"));
    if (!btns.length) return;
    var i = btns.indexOf(document.activeElement);
    var n = i === -1 ? (dir > 0 ? 0 : btns.length - 1) : i + dir;
    if (n < 0) n = 0;
    if (n >= btns.length) n = btns.length - 1;
    btns[n].focus();
  }

  /* Register global hooks for shortcuts and route teardown. */
  ChatHooks.newTask = newTask;
  ChatHooks.toggleHistory = function () { setHistOpen(!histOpen); if (histOpen) paintHistory(); };
  ChatHooks.focusHistorySearch = function () {
    if (!histOpen) setHistOpen(true);
    try { histSearch.focus(); } catch (e) {}
  };
  ChatHooks.focusComposer = function () {
    try {
      var ta = document.querySelector(".composer-input");
      if (ta) ta.focus();
    } catch (e) {}
  };
  ChatHooks.closeOverlays = function () {
    if (histModal) { histModal.close(); return; }
    if (histItemMenu) { closeHistMenu(); return; }
    if (histOpen && window.innerWidth <= 900) setHistOpen(false);
  };
  ChatHooks.moveHistSelection = moveHistSelection;
  ChatHooks.outsideClick = function (ev) {
    if (histItemMenu && !histItemMenu.el.contains(ev.target)) closeHistMenu();
  };

  paintHistoryLoading();
  setHistOpen(histOpen);
  requestAnimationFrame(function () { paintHistory(); });
  /* Palette deep actions: focus the composer or the history search when the
     palette navigated here with a pending focus request. */
  try {
    if (window.__neutronFocusComposer) {
      window.__neutronFocusComposer = null;
      setTimeout(function () { if (ChatHooks.focusComposer) ChatHooks.focusComposer(); }, 60);
    }
    if (window.__neutronFocusHistSearch) {
      window.__neutronFocusHistSearch = null;
      setTimeout(function () { if (ChatHooks.focusHistorySearch) ChatHooks.focusHistorySearch(); }, 60);
    }
  } catch (e) { /* best-effort */ }
  /* ================= end history workspace ================= */


  /* ----- header: title + provider/model pickers + toggles ----- */
  var head = el("div", "chat-head");
  var backBtn = el("button", "btn ghost sm", "←");
  backBtn.setAttribute("aria-label", "Back to dashboard");
  backBtn.title = "Back to dashboard";
  backBtn.onclick = function () { location.hash = "#/dashboard"; };
  var histBtn = el("button", "icon-btn hist-toggle", "\u2630");
  histBtn.setAttribute("aria-label", "Toggle conversation history");
  histBtn.setAttribute("aria-expanded", "false");
  histBtn.title = "Conversation history (Ctrl+K to search)";
  histBtn.onclick = function () { setHistOpen(!histOpen); if (histOpen) paintHistory(); };
  try { histBtn.setAttribute("aria-expanded", histOpen ? "true" : "false"); } catch (e) {}
  head.appendChild(backBtn);
  head.appendChild(histBtn);
  var chatTitleEl = el("div", "chat-title", "Chat");
  head.appendChild(chatTitleEl);
  /* Create a task from this conversation (linked, prefilled with the title). */
  var chatTaskBtn = el("button", "btn ghost sm", "+ Task");
  chatTaskBtn.type = "button";
  chatTaskBtn.title = "Create a task from this conversation";
  chatTaskBtn.setAttribute("aria-label", "Create a task from this conversation");
  chatTaskBtn.onclick = function () {
    if (!window.NeutronTasks) return;
    var c = activeConv();
    window.NeutronTasks.openTaskDialog({
      title: (window.NeutronUI && window.NeutronUI.convDisplayTitle(c)) || "Chat task",
      conversationId: c.id,
      projectId: c.projectId || "",
    });
  };
  head.appendChild(chatTaskBtn);

  var provSel = el("select", "input chat-pick");
  provSel.setAttribute("aria-label", "Provider");
  var ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Select a provider…";
  provSel.appendChild(ph);
  providers.forEach(function (pr) {
    var o = document.createElement("option");
    o.value = pr.id;
    o.textContent = pr.displayName;
    provSel.appendChild(o);
  });
  /* This conversation's provider/model win; the globals are the fallback.
     The choice is synced back to the globals so /api/chat sends it. */
  function syncPickersFromConv() {
    var c = activeConv();
    var p = c.provider || "";
    setStoredProvider(byId[p] ? p : "");
    setStoredModel(c.model || "");
    provSel.value = byId[p] ? p : "";
    paintModelOptions();
    paintPanel();
    try {
      var UI0 = window.NeutronUI;
      if (UI0 && chatTitleEl) chatTitleEl.textContent = UI0.convDisplayTitle(c);
    } catch (e) {}
  }

  var modelSel = el("select", "input chat-pick");
  modelSel.setAttribute("aria-label", "Model");
  function paintModelOptions() {
    var pr = byId[provSel.value];
    var defs = (pr && Array.isArray(pr.defaultModels) ? pr.defaultModels : []).slice();
    while (modelSel.firstChild) modelSel.removeChild(modelSel.firstChild);
    var auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Model: auto";
    modelSel.appendChild(auto);
    defs.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      modelSel.appendChild(o);
    });
    var cur = storedModel();
    if (cur && defs.indexOf(cur) === -1) {
      var o2 = document.createElement("option");
      o2.value = cur;
      o2.textContent = cur + " (custom)";
      modelSel.appendChild(o2);
    }
    modelSel.value = defs.indexOf(cur) !== -1 || (cur && defs.indexOf(cur) === -1) ? cur : "";
    if (!cur) modelSel.value = "";
  }
  /* Provider details panel (declared early: paintPanel() runs during the
     initial picker sync below, before the panel is attached to the layout). */
  var panel = el("div", "prov-panel hidden");

  syncPickersFromConv();

  provSel.onchange = function () {
    setStoredProvider(provSel.value);
    activeConv().provider = provSel.value;
    paintModelOptions();
    paintPanel();
    clearError();
    saveConvStore();
  };
  modelSel.onchange = function () {
    setStoredModel(modelSel.value);
    activeConv().model = modelSel.value;
    paintPanel();
    clearError();
    saveConvStore();
  };

  /* Model router status bar (declared early: paintRouterBar(null) runs during
     initial render, before the bar is attached to the layout). */
  var routerBar = el("div", "router-bar");
  routerBar.setAttribute("aria-live", "polite");

  /* ---------- model router (Phase 21) ---------- */
  function paintRouterBar(info) {
    routerBar.innerHTML = "";
    var mode = routerMode();
    var tag = el("span", "router-tag", "Router: " + mode);
    routerBar.appendChild(tag);
    function note(t) { routerBar.appendChild(el("span", "router-note", t)); }
    if (!info) {
      note(mode === "locked" ? "your model choice is never changed"
        : mode === "manual" ? "suggests a model per message — you apply it"
        : "picks a model per message and shows why");
      return;
    }
    if (info.suggestion) {
      note("Suggestion: " + info.suggestion.modelId + " — " + info.suggestion.reason + " ");
      var applyBtn = el("button", "btn ghost sm", "Apply");
      applyBtn.type = "button";
      applyBtn.onclick = function () {
        setStoredModel(info.suggestion.modelId);
        activeConv().model = info.suggestion.modelId;
        paintModelOptions();
        paintPanel();
        clearError();
        saveConvStore();
        paintRouterBar({ applied: info.suggestion.modelId });
        toast("Model set to " + info.suggestion.modelId + ".");
      };
      routerBar.appendChild(applyBtn);
      return;
    }
    if (info.applied) { note("now using " + info.applied + " — " + (info.reason || "")); return; }
    note(info.note || "");
  }
  paintRouterBar(null);

  /**
   * Maybe route the model for this send. Auto: applies the routed model
   * only when the user left the picker on "auto" — an explicit model choice
   * is never overridden (Locked additionally never even suggests).
   */
  function applyRouter(text, files) {
    var UI = window.NeutronUI;
    var mode = routerMode();
    if (!UI || mode === "locked") { paintRouterBar({ note: "your model choice is never changed" }); return; }
    var prov = storedProvider();
    if (!prov || !byId[prov]) return; /* no-default policy: router needs a provider */
    var defs = (byId[prov].defaultModels || []).slice();
    var models = defs.map(function (id) { return { id: id, providerId: prov }; });
    var hasImages = files.some(function (f) { return f && f.kind === "image"; });
    var cls = UI.classifyTask({ text: text, hasImages: hasImages });
    var res = UI.routeModel({ kind: cls.kind, models: models });
    if (!res) { paintRouterBar({ note: "no models listed for this provider" }); return; }
    var explicit = storedModel();
    if (mode === "auto") {
      if (!explicit) {
        setStoredModel(res.modelId);
        activeConv().model = res.modelId;
        paintModelOptions();
        try { modelSel.value = res.modelId; } catch (e) {}
        paintPanel();
        saveConvStore();
        paintRouterBar({ applied: res.modelId, reason: res.reason + " (heuristic)" });
      } else {
        paintRouterBar({ note: "keeping your explicit model choice (" + explicit + ")" });
      }
    } else {
      if (res.modelId !== explicit) paintRouterBar({ suggestion: res });
      else paintRouterBar({ note: "current model matches the router suggestion" });
    }
  }

  var detailsBtn = el("button", "btn ghost sm", "Provider info");
  var voiceBtn = el("button", "btn ghost sm", voiceSpeakEnabled() ? "Voice: on" : "Voice: off");
  var newBtn = el("button", "btn ghost sm", "+ New");
  newBtn.setAttribute("aria-label", "Start a new task");
  newBtn.title = "Start a new task (Ctrl+Shift+N)";
  head.appendChild(provSel);
  head.appendChild(modelSel);
  var hbtns = el("div", "chat-hbtns");
  hbtns.appendChild(detailsBtn);
  hbtns.appendChild(voiceBtn);
  /* ----- project brain: attach project memory to this chat ----- */
  var projBtn = el("button", "btn ghost sm", "🧠");
  projBtn.setAttribute("aria-label", "Attach project memory");
  projBtn.title = "Attach a project's memory as AI context";
  function projBtnLabel() {
    if (typeof projBtn === "undefined" || !projBtn) return;
    try {
      loadProjectStore();
      var UIpb = window.NeutronUI;
      var c = activeConv();
      var pr = c.projectId && UIpb ? UIpb.projectGet(projectStore, c.projectId) : null;
      projBtn.textContent = pr ? ("🧠 " + pr.name) : "🧠";
      projBtn.classList.toggle("on", !!pr);
      projBtn.title = pr ? ("Project: " + pr.name + (c.projectContextOn === false ? " (context off)" : " (context on)"))
        : "Attach a project's memory as AI context";
    } catch (e) { /* header not built yet */ }
  }
  projBtn.onclick = function () { openProjectPicker(projBtn); };
  hbtns.appendChild(projBtn);
  hbtns.appendChild(newBtn);
  head.appendChild(hbtns);
  projBtnLabel();

  /* Project picker: choose a project (or none) + context on/off toggle. */
  function openProjectPicker(invoker) {
    var UIpk = window.NeutronUI;
    try { loadProjectStore(); } catch (e) {
      showError("Could not load projects."); return;
    }
    var wrap = el("div", "hist-modal-body");
    var ids = Object.keys(projectStore.items);
    if (!ids.length) {
      wrap.appendChild(el("p", "muted", "No projects yet — create one under Repositories \u2192 Projects first."));
    }
    var c = activeConv();
    ids.forEach(function (id) {
      var pr = projectStore.items[id];
      var b = el("button", "btn ghost proj-pick" + (c.projectId === id ? " on" : ""), (c.projectId === id ? "\u2713 " : "") + (pr.name || "(untitled)"));
      b.setAttribute("aria-label", "Attach project " + (pr.name || "untitled"));
      b.onclick = function () {
        c.projectId = id;
        c.projectContextOn = true;
        UIpk.linkConversation(pr, c.id);
        saveConvStore(); saveProjectStore();
        projBtnLabel(); paintProjChip();
        toast("Project \"" + pr.name + "\" attached.");
        if (window.__projModal) window.__projModal.close();
      };
      wrap.appendChild(b);
    });
    var none = el("button", "btn ghost proj-pick", c.projectId ? "No project" : "\u2713 No project");
    none.onclick = function () {
      c.projectId = "";
      saveConvStore();
      projBtnLabel(); paintProjChip();
      if (window.__projModal) window.__projModal.close();
    };
    wrap.appendChild(none);
    if (c.projectId) {
      var trow = el("label", "row proj-toggle");
      var tgl = document.createElement("input");
      tgl.type = "checkbox";
      tgl.checked = c.projectContextOn !== false;
      tgl.setAttribute("aria-label", "Attach project context to AI requests");
      tgl.onchange = function () {
        c.projectContextOn = tgl.checked;
        saveConvStore();
        projBtnLabel(); paintProjChip();
        toast(tgl.checked ? "Project context on." : "Project context off for this chat.");
      };
      trow.appendChild(tgl);
      trow.appendChild(document.createTextNode(" Attach project context to AI requests"));
      wrap.appendChild(trow);
    }
    openProjModal("Project memory", wrap, [{ label: "Done", kind: "primary" }], invoker);
  }

  /* Indicator chip above the composer: what project context rides along.
     Tapping it shows the exact text sent to the model — no hidden context. */
  var lastProjectBlock = "";
  var projChipWrap = el("div", "proj-chip-wrap");
  function currentProjectBlock() {
    try {
      loadProjectStore();
      var UIcb = window.NeutronUI;
      var c = activeConv();
      var pr = c.projectId && UIcb ? UIcb.projectGet(projectStore, c.projectId) : null;
      if (!pr || c.projectContextOn === false) return { project: null, block: "" };
      return { project: pr, block: UIcb.buildProjectContextBlock(pr) };
    } catch (e) { return { project: null, block: "" }; }
  }
  function paintProjChip() {
    projChipWrap.innerHTML = "";
    var cb = currentProjectBlock();
    if (!cb.project) return;
    var chip = el("button", "chip proj-chip", "🧠 " + cb.project.name + " context attached");
    chip.setAttribute("aria-label", "Project context attached. Activate to view exactly what is sent to the AI.");
    chip.title = "Tap to see exactly what project context is sent";
    chip.onclick = function () { openProjectContextDialog(chip); };
    projChipWrap.appendChild(chip);
  }
  function openProjectContextDialog(invoker) {
    var cb = currentProjectBlock();
    if (!cb.project) return;
    var wrap = el("div", "hist-modal-body");
    var shown = lastProjectBlock || cb.block;
    var pre = el("pre", "mono proj-context-pre", shown || "(empty)");
    wrap.appendChild(pre);
    wrap.appendChild(el("p", "muted small",
      lastProjectBlock ? "This exact text was attached to your last send."
        : "This exact text will be attached to your next send (condensed project memory, capped)."));
    openProjModal("Project context sent", wrap, [{ label: "Close", kind: "primary" }], invoker);
  }
  main.appendChild(head);
  /* Model router status bar (Phase 21): visible routing reasoning. */
  main.appendChild(routerBar);

  /* ----- provider details panel ----- */
  function kv(k, v) {
    var row = el("div", "kv");
    row.appendChild(el("span", "k", k));
    var vv = el("span", "v mono small", v);
    row.appendChild(vv);
    return row;
  }
  function paintPanel() {
    panel.innerHTML = "";
    var id = storedProvider();
    var pr = byId[id];
    if (!pr) {
      panel.appendChild(el("p", "muted small",
        "Select a provider above to see its endpoint, models, and key status. Your key is never shown here."));
      return;
    }
    panel.appendChild(el("div", "prov-name", pr.displayName + "  (" + pr.id + ")"));
    if (pr.description) panel.appendChild(el("p", "muted small", pr.description));
    panel.appendChild(kv("Endpoint", pr.baseUrl || "—"));
    panel.appendChild(kv("API key", storedApiKey() ? "SET" : "NOT SET"));
    panel.appendChild(kv("Model", storedModel() || "Auto (provider default)"));
    var mrow = el("div", "kv");
    mrow.appendChild(el("span", "k", "Models"));
    var mc = el("span", "v");
    var defs = Array.isArray(pr.defaultModels) ? pr.defaultModels : [];
    if (!defs.length) {
      mc.appendChild(el("span", "muted small", "provider default"));
    } else {
      var c = el("div", "chips");
      defs.forEach(function (m) { c.appendChild(el("span", "chip", m)); });
      mc.appendChild(c);
    }
    mrow.appendChild(mc);
    panel.appendChild(mrow);
  }
  paintPanel();
  detailsBtn.onclick = function () { panel.classList.toggle("hidden"); };
  main.appendChild(panel);

  /* ----- message log ----- */
  var log = el("div", "chat-log full");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-label", "Chat messages");

  function artifactCards(artifacts) {
    var wrap = el("div", "artifact-list");
    wrap.appendChild(el("div", "artifact-head", "FILE ARTIFACTS"));
    artifacts.forEach(function (a) {
      var card = el("div", "artifact-card");
      var meta = el("div", "artifact-meta");
      meta.appendChild(el("div", "artifact-name mono", a.path));
      meta.appendChild(el("div", "muted small", fmtSize(a.size)));
      card.appendChild(meta);
      var dl = el("button", "btn ghost sm", "Download");
      dl.onclick = function () {
        downloadBlob(new Blob([a.content], { type: "application/octet-stream" }),
          String(a.path).split("/").pop() || "file");
      };
      card.appendChild(dl);
      wrap.appendChild(card);
    });
    var all = el("button", "btn primary sm", "Download all as .zip");
    all.onclick = function () {
      try {
        if (!window.NeutronZip) throw new Error("zip engine missing");
        var zip = window.NeutronZip.createStoredZip(artifacts.map(function (a) {
          return { name: a.path, data: a.content };
        }));
        downloadBlob(zip, "neutron-files.zip");
      } catch (e) {
        showError("Could not build the zip: " + (e && e.message ? e.message : e));
      }
    };
    wrap.appendChild(all);
    wrap.appendChild(el("p", "muted small",
      "Files are generated for download — the app cannot write to your phone's folders or run code on the server."));
    return wrap;
  }

  /* ----- message rendering: buildMsgEl constructs one message element;
     appendMsg adds just the new one (no full re-render per message);
     paint() does a full render with a cap for very long histories. ----- */
  function buildMsgEl(m) {
    var wrap = el("div", "msg " + m.role);
    var whoRow = el("div", "who-row");
    whoRow.appendChild(el("span", "who", m.role === "user" ? "YOU" : "NEUTRON"));
    var UI = window.NeutronUI;
    var tstr = (UI && UI.fmtTime) ? UI.fmtTime(m.ts) : "";
    if (tstr) whoRow.appendChild(el("span", "msg-ts", tstr));
    wrap.appendChild(whoRow);
    var bubble = el("div", "bubble");
    /* Assistant messages render safe markdown (escaped first, tiny subset);
       user messages stay plain text. Copy always uses the raw text. */
    if (m.role === "assistant" && UI && UI.renderMarkdown) {
      bubble.innerHTML = UI.renderMarkdown(m.text);
    } else {
      /* Textless attachment sends show a display-only label; the raw
         text stays "" so no placeholder leaks into the LLM context. */
      var displayText = m.text;
      if (!displayText && m.role === "user" && m.files && m.files.length) {
        displayText = "(sent with attachments)";
      }
      bubble.textContent = displayText;
    }
    var atts = m.attachments || m.files || [];
    if (m.role === "user" && atts.length) {
      atts.forEach(function (a) {
        var line = el("div", "attach-line mono small",
          "file: " + (a.name || "?") + " (" + fmtSize(a.size) + ")");
        if (a.data) {
          var dl = el("button", "attach-dl", "Download");
          dl.setAttribute("aria-label", "Download " + (a.name || "file"));
          dl.onclick = (function (att) {
            return function () { downloadAttachment(att); };
          })(a);
          line.appendChild(dl);
        } else if (a.unavailable) {
          line.appendChild(el("span", "attach-warn", " \u2014 \u26a0 no longer available"));
        }
        bubble.appendChild(line);
      });
    }
    wrap.appendChild(bubble);
    if (m.role === "assistant" && m.text) {
      var copyBtn = el("button", "btn ghost sm msg-copy", "Copy");
      copyBtn.setAttribute("aria-label", "Copy message to clipboard");
      copyBtn.onclick = function () {
        var UI = window.NeutronUI;
        var btn = copyBtn;
        function done(ok) {
          btn.textContent = ok ? "Copied ✓" : "Copy failed";
          setTimeout(function () { btn.textContent = "Copy"; }, 1500);
        }
        if (UI && UI.copyText) {
          UI.copyText(m.text).then(done, function () { done(false); });
        } else {
          done(false);
        }
      };
      wrap.appendChild(copyBtn);
    }
    if (m.role === "assistant" && m.artifacts && m.artifacts.length) {
      wrap.appendChild(artifactCards(m.artifacts));
    }
    if (m.failed) {
      var retry = el("button", "btn ghost sm retry-btn", "Retry");
      retry.setAttribute("aria-label", "Retry failed message");
      retry.onclick = function () { retryLast(); };
      wrap.appendChild(retry);
    }
    return wrap;
  }

  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) { return false; }
  }

  function scrollLog() {
    try {
      log.scrollTo({ top: log.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    } catch (e) {
      log.scrollTop = log.scrollHeight;
    }
  }

  var renderAll = false;
  function paint() {
    persistChat();
    log.innerHTML = "";
    var UI = window.NeutronUI;
    var cap = UI ? UI.CHAT_RENDER_CAP : 120;
    var msgs = chatState.messages;
    if (!renderAll && UI && msgs.length > cap) {
      var hidden = msgs.length - cap;
      var more = el("button", "btn ghost sm load-more",
        "Show earlier messages (" + hidden + " more)");
      more.onclick = function () { renderAll = true; paint(); };
      log.appendChild(more);
      msgs = UI.cappedSlice(msgs, cap);
    }
    if (!chatState.messages.length) {
      log.appendChild(el("p", "muted",
        "No messages yet. Ask about your codebase, attach files, or ask the assistant to generate files for download."));
    }
    msgs.forEach(function (m) {
      log.appendChild(buildMsgEl(m));
    });
    scrollLog();
  }

  /** Append a single message efficiently; animates entry via .msg-enter. */
  function appendMsg(m) {
    persistChat();
    var UI = window.NeutronUI;
    var cap = UI ? UI.CHAT_RENDER_CAP : 120;
    if (chatState.messages.length === 1 ||
        (!renderAll && chatState.messages.length > cap)) {
      /* First message (drops the empty state) or over the render cap:
         do a full paint to keep the log consistent. */
      paint();
      return;
    }
    var w = buildMsgEl(m);
    w.classList.add("msg-enter");
    log.appendChild(w);
    scrollLog();
  }

  /* ----- typing indicator while the reply is in flight ----- */
  var typingEl = null;
  function showTyping() {
    hideTyping();
    typingEl = el("div", "msg assistant typing");
    var bubble = el("div", "bubble typing-dots");
    bubble.setAttribute("aria-label", "NEUTRON is typing");
    for (var i = 0; i < 3; i++) bubble.appendChild(el("span", "dot"));
    typingEl.appendChild(bubble);
    log.appendChild(typingEl);
    scrollLog();
  }
  function hideTyping() {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    typingEl = null;
  }

  paint();

  /* ----- attachments ----- */
  var MAX_ATTACH_FILES = 5;
  var MAX_ATTACH_BYTES = 100 * 1024;
  var staged = [];
  var pendingReads = 0;
  var chips = el("div", "attach-chips");
  var KIND_GLYPH = { image: "🖼", zip: "🗜", text: "📄" };
  function paintChips() {
    chips.innerHTML = "";
    staged.forEach(function (f, i) {
      var chip = el("span", "chip attach-chip");
      var glyph = el("span", "attach-kind", KIND_GLYPH[f.kind] || "📄");
      glyph.setAttribute("aria-hidden", "true");
      glyph.title = f.kind === "image" ? "Image" : f.kind === "zip" ? "ZIP archive" : "Text file";
      chip.appendChild(glyph);
      chip.appendChild(el("span", null, f.name + " (" + fmtSize(f.size) + ")"));
      var x = el("button", "chip-x", "×");
      x.setAttribute("aria-label", "Remove " + f.name);
      x.onclick = function () { staged.splice(i, 1); paintChips(); };
      chip.appendChild(x);
      chips.appendChild(chip);
    });
    if (pendingReads > 0) {
      var r = el("span", "chip attach-chip reading");
      r.textContent = "Reading " + pendingReads + " file" + (pendingReads === 1 ? "" : "s") + "…";
      chips.appendChild(r);
    }
    if (staged.length > 1) {
      var total = staged.reduce(function (n, f) { return n + (Number(f.size) || 0); }, 0);
      var t = el("span", "chip attach-total");
      t.textContent = staged.length + "/" + MAX_ATTACH_FILES + " files · " + fmtSize(total) + " total";
      t.setAttribute("aria-label", staged.length + " of " + MAX_ATTACH_FILES + " files staged, " + fmtSize(total) + " total");
      chips.appendChild(t);
    }
    chips.classList.toggle("hidden", !staged.length && !pendingReads);
  }
  paintChips();

  var fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = "image/*,.zip,.txt,.md,.js,.jsx,.ts,.tsx,.py,.json,.yaml,.yml,.toml,.css,.html,.xml,.csv,.sh,.java,.c,.h,.cpp,.go,.rs,.php,.swift,.kt,.sql,.log,.ini,.cfg,.diff,.patch";
  fileInput.className = "hidden";
  function classifyClient(name, mime) {
    var m = (mime || "").toLowerCase();
    var n = (name || "").toLowerCase();
    if (m.indexOf("image/") === 0) return "image";
    if (m === "application/zip" || m === "application/x-zip-compressed" || n.slice(-4) === ".zip") return "zip";
    return "text";
  }
  fileInput.onchange = function () {
    var files = Array.prototype.slice.call(fileInput.files || []);
    (function next(i) {
      if (i >= files.length) { fileInput.value = ""; return; }
      var f = files[i];
      if (staged.length >= MAX_ATTACH_FILES) {
        showError("At most " + MAX_ATTACH_FILES + " files per message.");
        fileInput.value = "";
        return;
      }
      if (f.size > MAX_ATTACH_BYTES) {
        showError("\"" + f.name + "\" is " + fmtSize(f.size) + "; the per-file limit is " + fmtSize(MAX_ATTACH_BYTES) + ".");
        return next(i + 1);
      }
      var rd = new FileReader();
      pendingReads++;
      paintChips();
      rd.onload = function () {
        pendingReads = Math.max(0, pendingReads - 1);
        var buf = rd.result;
        var kind = classifyClient(f.name, f.type);
        if (kind === "text") {
          var dec = utf8Decode(new Uint8Array(buf));
          if (dec === null || dec.indexOf("\0") !== -1) {
            showError("\"" + f.name + "\" is not a text file, image, or zip — binary files are not accepted.");
            paintChips();
            return next(i + 1);
          }
        }
        staged.push({ name: f.name, mime: f.type || "application/octet-stream", kind: kind, data: b64encode(buf), size: f.size });
        clearError();
        paintChips();
        next(i + 1);
      };
      rd.onerror = function () {
        pendingReads = Math.max(0, pendingReads - 1);
        showError("Could not read \"" + f.name + "\".");
        paintChips();
        next(i + 1);
      };
      rd.readAsArrayBuffer(f);
    })(0);
  };

  /* ----- composer ----- */
  var composer = el("div", "composer");
  var attachBtn = el("button", "icon-btn", "+");
  attachBtn.title = "Attach images, zip, or text files (max 5, 100 KB each)";
  attachBtn.setAttribute("aria-label", "Attach files");
  attachBtn.onclick = function () { fileInput.click(); };

  var micBtn = el("button", "icon-btn", "mic");
  micBtn.setAttribute("aria-label", "Voice input");
  var RecCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!RecCtor) {
    micBtn.disabled = true;
    micBtn.title = "Voice input isn't supported in this browser";
    micBtn.classList.add("off");
  } else {
    micBtn.title = "Voice input (transcript stays editable before sending)";
    micBtn.onclick = function () {
      if (micBtn.classList.contains("listening")) return;
      var rec;
      try { rec = new RecCtor(); } catch (e) { showError("Could not start voice input."); return; }
      rec.lang = (navigator.language || "en-US");
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      var startText = input.value;
      var finalText = "";
      micBtn.classList.add("listening");
      micBtn.title = "Listening… tap Send or wait";
      rec.onresult = function (ev) {
        var interim = "";
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var t = ev.results[i][0].transcript;
          if (ev.results[i].isFinal) finalText += t;
          else interim += t;
        }
        input.value = (startText ? startText + " " : "") + finalText + interim;
        autoGrow();
      };
      var done = function () {
        micBtn.classList.remove("listening");
        micBtn.title = "Voice input (transcript stays editable before sending)";
        input.value = ((startText ? startText + " " : "") + finalText).trim();
        autoGrow();
        try { rec.stop(); } catch (e) {}
      };
      rec.onend = done;
      rec.onerror = function (ev) {
        done();
        if (ev && ev.error === "not-allowed") showError("Microphone blocked — allow it in the browser settings to use voice input.");
        else if (ev && ev.error !== "aborted") showError("Voice input error: " + ev.error);
      };
      try { rec.start(); } catch (e) { done(); showError("Could not start voice input."); }
    };
  }

  var input = document.createElement("textarea");
  input.className = "input composer-input";
  input.rows = 1;
  input.placeholder = "Type a message… (Enter to send, Shift+Enter for newline)";
  input.setAttribute("aria-label", "Chat message");
  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  }
  input.addEventListener("input", autoGrow);

  var sendBtn = el("button", "btn primary", "Send");

  /* ----- voice output (speaker toggle) ----- */
  var synthSupported = ("speechSynthesis" in window);
  function paintVoiceBtn() {
    voiceBtn.textContent = voiceSpeakEnabled() ? "Voice: on" : "Voice: off";
    voiceBtn.classList.toggle("on", voiceSpeakEnabled());
  }
  paintVoiceBtn();
  voiceBtn.onclick = function () {
    var next = !voiceSpeakEnabled();
    if (next && !synthSupported) {
      showError("Voice output isn't supported in this browser.");
      return;
    }
    setVoiceSpeakEnabled(next);
    if (!next) {
      var NSU3 = window.NeutronUI;
      if (NSU3 && NSU3.stopSpeechSynthesis) NSU3.stopSpeechSynthesis();
    }
    paintVoiceBtn();
    clearError();
    toast(next ? "Voice output on — replies will be read aloud." : "Voice output off.");
  };
  function speak(text) {
    if (!voiceSpeakEnabled() || !synthSupported) return;
    try {
      var NSU4 = window.NeutronUI;
      if (NSU4 && NSU4.stopSpeechSynthesis) NSU4.stopSpeechSynthesis();
      /* Read words, not markdown syntax. */
      var UI = window.NeutronUI;
      var plain = (UI && UI.stripMarkdownForSpeech) ? UI.stripMarkdownForSpeech(text) : String(text || "");
      var u = new SpeechSynthesisUtterance(plain.slice(0, 1200));
      window.speechSynthesis.speak(u);
    } catch (e) { /* unsupported voice */ }
  }

  async function doSend() {
    var text = input.value.trim();
    var files = staged.slice();
    if (!text && !files.length) return;
    /* Never send while files are still being read — they'd be silently dropped. */
    if (pendingReads > 0) {
      showError("Still reading " + pendingReads + " file" + (pendingReads === 1 ? "" : "s") + " — wait a moment, then send.");
      return;
    }
    /* No silent default: chat needs an explicit provider choice. */
    if (!storedProvider()) {
      var hint = "Please select a provider in Settings first — NEUTRON never picks one for you.";
      chatState.messages.push({ role: "user", text: text, ts: Date.now(), local: true });
      appendMsg(chatState.messages[chatState.messages.length - 1]);
      chatState.messages.push({ role: "assistant", text: hint, ts: Date.now(), local: true });
      appendMsg(chatState.messages[chatState.messages.length - 1]);
      showError(hint);
      return;
    }
    /* Cost control: warn at 80% of budget, confirm every send at 100%. */
    if (!budgetCheck()) return;
    /* Model router: classify + maybe pick a model before the send. */
    try { applyRouter(text, files); } catch (e) { /* router never breaks a send */ }
    var umsg = { role: "user", text: text, ts: Date.now() };
    if (files.length) {
      /* Keep bytes only for small text files; anything larger restores
         honestly as unavailable after a reload. */
      umsg.attachments = files.map(function (f) {
        var a = { name: f.name, mime: f.mime, kind: f.kind, size: f.size };
        if (f.kind === "text" && f.data && f.data.length <= 10240) a.data = f.data;
        return a;
      });
    }
    chatState.messages.push(umsg);
    var UI2 = window.NeutronUI;
    var wasUntitled = !!(UI2 && !activeConv().title);
    if (UI2) UI2.convTouch(convStore, activeConv().id, Date.now(), text, files);
    if (wasUntitled) {
      /* First message just auto-titled the task: refresh the header
         and the history list so the new title shows immediately. */
      paintHistory();
      try { chatTitleEl.textContent = UI2.convDisplayTitle(activeConv()); } catch (e) {}
    }
    appendMsg(umsg);
    /* Failed sends and local-only hints are display-only: never let the
       model see "Error: ..." as if it were its own prior reply.
       Textless attachment sends keep text "" here — the "(sent with
       attachments)" label is display-only (buildMsgEl). History turns
       get an honest file list instead of a fake placeholder. */
    var chatBody = {
      messages: chatState.messages
        .filter(function (m) { return !m.failed && !m.local; })
        .map(function (m) {
          var content = m.text;
          var matts = m.attachments || m.files;
          if (!content && matts && matts.length) {
            content = "[attached files: " + matts.map(function (f) { return f.name; }).join(", ") + "]";
          }
          return { role: m.role, content: content };
        }),
    };
    var cm = storedModel();
    if (cm) chatBody.model = cm;
    /* Cost control: user-configured max output tokens, when supported. */
    try {
      var mt = loadMaxTokens();
      if (mt) chatBody.maxTokens = mt;
    } catch (e) { /* never break a send */ }
    /* Project brain: condensed project memory rides along as system
       context (server merges it with the artifact nudge). Additive —
       a failure here must never break the send. */
    try {
      var UIpc3 = window.NeutronUI;
      var cb2 = currentProjectBlock();
      if (cb2.project && cb2.block && UIpc3) {
        lastProjectBlock = cb2.block;
        chatBody.projectContext = cb2.block;
      }
    } catch (e) { /* ignore */ }
    if (files.length) {
      chatBody.attachments = files.map(function (f) {
        return { name: f.name, mime: f.mime, kind: f.kind, data: f.data };
      });
    }
    staged = [];
    paintChips();
    input.value = "";
    autoGrow();
    sendOnce(chatBody);
  }

  /* The request body of the last failed send (attachments included),
     so a retry never forces the user to retype or re-attach. */
  var lastFailedBody = null;

  async function sendOnce(chatBody) {
    sendBtn.disabled = true;
    sendBtn.classList.add("sending");
    showTyping();
    var t0 = Date.now();
    try {
      var res = await api("POST", "/api/chat", chatBody);
      /* Usage dashboard: log provider-reported tokens only — never invented. */
      try {
        recordUsage({
          ts: Date.now(),
          provider: res.provider || storedProvider(),
          model: res.model || chatBody.model || "",
          inTok: res.usage ? res.usage.input_tokens : null,
          outTok: res.usage ? res.usage.output_tokens : null,
          latencyMs: Date.now() - t0,
          ok: true,
        });
      } catch (e) { /* logging never breaks chat */ }
      var amsg = { role: "assistant", text: res.text || "(empty reply)", ts: Date.now() };
      if (res.artifacts && res.artifacts.length) amsg.artifacts = res.artifacts;
      chatState.messages.push(amsg);
      var UI3 = window.NeutronUI;
      if (UI3) UI3.convTouch(convStore, activeConv().id, Date.now());
      clearError();
      lastFailedBody = null;
      speak(amsg.text);
    } catch (e) {
      /* Friendly message for the user; the raw detail stays in the API
         inspector and verbose log via api(). */
      try {
        recordUsage({
          ts: Date.now(),
          provider: storedProvider(),
          model: chatBody.model || "",
          inTok: null, outTok: null,
          latencyMs: Date.now() - t0,
          ok: false,
        });
      } catch (e2) { /* logging never breaks chat */ }
      var UI5 = window.NeutronUI;
      var msg = (UI5 && UI5.friendlyChatError) ? UI5.friendlyChatError(e)
        : (e && e.message ? e.message : String(e));
      chatState.messages.push({ role: "assistant", text: "Error: " + msg, failed: true, ts: Date.now() });
      var UI4 = window.NeutronUI;
      if (UI4) UI4.convTouch(convStore, activeConv().id, Date.now());
      showError(msg);
      lastFailedBody = chatBody;
      /* Never read error text aloud — only real replies get spoken. */
    }
    hideTyping();
    appendMsg(chatState.messages[chatState.messages.length - 1]);
    sendBtn.disabled = false;
    sendBtn.classList.remove("sending");
  }

  function retryLast() {
    if (!lastFailedBody || sendBtn.disabled) return;
    var tail = chatState.messages[chatState.messages.length - 1];
    if (tail && tail.failed) chatState.messages.pop();
    var body = lastFailedBody;
    lastFailedBody = null;
    clearError();
    paint();
    sendOnce(body);
  }
  sendBtn.onclick = doSend;
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      doSend();
    }
  });

  composer.appendChild(attachBtn);
  composer.appendChild(micBtn);
  composer.appendChild(input);
  composer.appendChild(sendBtn);
  main.appendChild(log);
  main.appendChild(chips);
  main.appendChild(projChipWrap);
  paintProjChip();
  main.appendChild(fileInput);
  main.appendChild(composer);
  main.appendChild(el("p", "muted small chat-fine",
    "Conversations auto-save to History (\u2630) in this browser. Attachments: images, .zip, text/code files (max 5, 100 KB each). " +
    "Voice input/output never leaves your device except via the OS speech recognizer. " +
    "Without a provider you get an honest error — never a fabricated reply."));
  root.appendChild(histBackdrop);
  root.appendChild(histPanel);
  root.appendChild(main);
  view.appendChild(root);

  /* "+ New" is non-destructive now: the current task stays in History. */
  newBtn.onclick = function () { newTask(); };
}


/* ---------- usage dashboard (Phase 23) ----------
   Device-local request log. Token counts come only from provider API
   responses; entries without them are marked "not reported", never estimated. */
async function renderUsage(view) {
  var UI = window.NeutronUI;
  view.appendChild(el("h1", null, "Usage"));
  view.appendChild(el("p", "muted small",
    "Requests from this browser only. Costs are estimated from YOUR rates in Settings — " +
    "models without a rate show \u2014, never a guessed price."));
  if (!UI) { view.appendChild(el("p", "muted", "UI helpers unavailable.")); return; }

  var log = loadUsageLog();
  var rates = loadRates();
  var days = 1;
  var tabs = el("div", "tabs");
  var body = el("div");
  function fmtN(n) { return Number(n || 0).toLocaleString("en-US"); }
  function fmtMoney(n) { return "$" + n.toFixed(2); }
  function dayLabel(ts) { var d = new Date(ts); return (d.getMonth() + 1) + "/" + d.getDate(); }

  [["Today", 1], ["7 days", 7], ["30 days", 30]].forEach(function (pair) {
    var b = el("button", "tab" + (pair[1] === days ? " active" : ""));
    b.type = "button";
    b.textContent = pair[0];
    b.setAttribute("aria-pressed", pair[1] === days ? "true" : "false");
    b.onclick = function () {
      days = pair[1];
      Array.prototype.forEach.call(tabs.children, function (t, i) {
        t.classList.toggle("active", i === [["Today", 1], ["7 days", 7], ["30 days", 30]][i][1] === days);
        t.setAttribute("aria-pressed", t.classList.contains("active") ? "true" : "false");
      });
      paint();
    };
    tabs.appendChild(b);
  });
  view.appendChild(tabs);
  view.appendChild(body);

  function spendInPeriod() {
    var now = Date.now();
    var d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    var cutoff = d0.getTime() - (days - 1) * 86400000;
    return UI.sumEstimatedSpend(log.filter(function (e) { return e && e.ts >= cutoff; }), rates);
  }

  function statCard(title, big, sub) {
    var c = el("section", "panel");
    c.appendChild(el("h2", null, title));
    var n = el("div", "stat-num", big);
    c.appendChild(n);
    if (sub) c.appendChild(el("p", "muted small", sub));
    return c;
  }

  function paint() {
    body.innerHTML = "";
    if (!log.length) {
      var empty = el("section", "panel");
      empty.appendChild(el("p", null, "No requests logged yet."));
      empty.appendChild(el("p", "muted small", "Send a chat message and it will appear here with token usage when your provider reports it."));
      body.appendChild(empty);
      return;
    }
    var r = UI.usageRollup(log, days, Date.now());
    var spend = spendInPeriod();
    var grid = el("div", "grid cols-3");
    grid.appendChild(statCard("Requests", fmtN(r.requests), r.succeeded + " ok · " + r.failed + " failed"));
    grid.appendChild(statCard("Input tokens", fmtN(r.inTok), null));
    grid.appendChild(statCard("Output tokens", fmtN(r.outTok), null));
    body.appendChild(grid);
    var grid2 = el("div", "grid cols-3");
    grid2.appendChild(statCard("Est. cost",
      spend.costed ? fmtMoney(spend.dollars) : "\u2014",
      spend.costed ? "estimated from your rates (" + spend.costed + " requests)" : "set rates in Settings to estimate"));
    grid2.appendChild(statCard("Unreported", fmtN(r.unreported),
      r.unreported ? "provider did not return token usage" : "all requests reported tokens"));
    var b = loadBudget();
    var btxt = (!b.daily && !b.monthly) ? "no budget set"
      : "daily " + (b.daily == null ? "\u2014" : fmtMoney(b.daily)) +
        " · monthly " + (b.monthly == null ? "\u2014" : fmtMoney(b.monthly));
    grid2.appendChild(statCard("Budget", btxt, "manage in Settings → Budget"));
    body.appendChild(grid2);

    /* per-day bars (CSS only) */
    if (r.perDay.length > 1 || (r.perDay.length === 1 && days > 1)) {
      var chartP = el("section", "panel");
      chartP.appendChild(el("h2", null, "Requests per day"));
      var chart = el("div", "usage-bars");
      var max = 0;
      r.perDay.forEach(function (dy) { if (dy.requests > max) max = dy.requests; });
      r.perDay.forEach(function (dy) {
        var wrap = el("div", "usage-bar");
        var fill = el("div", "usage-bar-fill");
        fill.style.height = (max ? Math.max(4, Math.round(dy.requests / max * 100)) : 0) + "%";
        fill.title = dayLabel(dy.dayStart) + ": " + dy.requests + " requests";
        wrap.appendChild(fill);
        wrap.appendChild(el("div", "usage-bar-label", dayLabel(dy.dayStart)));
        chart.appendChild(wrap);
      });
      chartP.appendChild(chart);
      body.appendChild(chartP);
    }

    function costForModel(bkt) {
      if (bkt.unreported === bkt.requests) return null;
      return UI.estimateCost(bkt.inTok || null, bkt.outTok || null, rates[bkt.label]);
    }
    function costForProvider(bkt) {
      var now = Date.now();
      var d0 = new Date(now); d0.setHours(0, 0, 0, 0);
      var cutoff = d0.getTime() - (days - 1) * 86400000;
      var entries = log.filter(function (e) { return e && e.ts >= cutoff && e.provider === bkt.label; });
      var ssum = UI.sumEstimatedSpend(entries, rates);
      return ssum.costed ? ssum.dollars : null;
    }
    function bucketTable(title, buckets, costFor) {
      var keys = Object.keys(buckets).sort(function (a, k) { return buckets[k].requests - buckets[a].requests; });
      if (!keys.length) return;
      var psec = el("section", "panel");
      psec.appendChild(el("h2", null, title));
      var t = document.createElement("table");
      t.className = "tbl";
      var thead = document.createElement("thead");
      var hr = document.createElement("tr");
      ["Name", "Requests", "In", "Out", "Est. cost"].forEach(function (h) {
        var th = document.createElement("th"); th.textContent = h; hr.appendChild(th);
      });
      thead.appendChild(hr); t.appendChild(thead);
      var tb = document.createElement("tbody");
      keys.slice(0, 20).forEach(function (k) {
        var bkt = buckets[k];
        var tr = document.createElement("tr");
        function td(txt) { var c = document.createElement("td"); c.textContent = txt; tr.appendChild(c); }
        td(bkt.label);
        td(String(bkt.requests));
        td(bkt.unreported === bkt.requests ? "not reported" : fmtN(bkt.inTok));
        td(bkt.unreported === bkt.requests ? "not reported" : fmtN(bkt.outTok));
        var c = costFor(bkt);
        td(c == null ? "\u2014" : fmtMoney(c));
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      psec.appendChild(t);
      body.appendChild(psec);
    }
    bucketTable("By model", r.perModel, costForModel);
    bucketTable("By provider", r.perProvider, costForProvider);
  }
  paint();
}

/* ---------- settings (BYOK + provider/model choice) ---------- */

var PROVIDER_FALLBACK = [
  { id: "nvidia", displayName: "NVIDIA", description: "", defaultModels: [] },
  { id: "agentrouter", displayName: "AgentRouter", description: "", defaultModels: [] },
  { id: "openrouter", displayName: "OpenRouter", description: "", defaultModels: [] },
  { id: "nous", displayName: "NousResearch", description: "", defaultModels: [] },
];

async function fetchProviders() {
  try {
    var res = await api("GET", "/api/providers");
    if (res && Array.isArray(res.providers) && res.providers.length) return res.providers;
  } catch (e) { /* offline — fall back to the static list */ }
  return PROVIDER_FALLBACK;
}

async function renderSettings(view) {
  view.appendChild(el("h1", null, "Settings"));
  var providers = await fetchProviders();
  var byId = {};
  providers.forEach(function (pr) { byId[pr.id] = pr; });

  /* ----- provider choice ----- */
  var pp = el("section", "panel");
  pp.appendChild(el("h2", null, "Provider"));
  pp.appendChild(el("p", "muted small",
    "Which provider your API key is for. Sent as the x-provider header with your requests; the backend builds a request-scoped provider entry for it. Your key is never stored on the server."));

  var provSel = el("select", "input");
  provSel.setAttribute("aria-label", "Provider");
  /* No default provider: the first option is an unselected placeholder. */
  var placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a provider…";
  provSel.appendChild(placeholder);
  providers.forEach(function (pr) {
    var o = document.createElement("option");
    o.value = pr.id;
    o.textContent = pr.displayName + "  (" + pr.id + ")";
    provSel.appendChild(o);
  });
  var savedProv = storedProvider();
  provSel.value = byId[savedProv] ? savedProv : "";
  pp.appendChild(field("PROVIDER", provSel));

  var provNote = el("p", "mono small", "");
  function paintProvNote() {
    var pr = byId[provSel.value];
    provNote.textContent = pr && pr.description ? "NOTE: " + pr.description : "";
  }
  paintProvNote();
  pp.appendChild(provNote);

  /* ----- model choice ----- */
  var modelSel = el("select", "input");
  modelSel.setAttribute("aria-label", "Model");
  var modelCustom = el("input", "input");
  modelCustom.type = "text";
  modelCustom.placeholder = "Custom model id (overrides the dropdown)";
  modelCustom.setAttribute("aria-label", "Custom model id");
  modelCustom.autocomplete = "off";
  modelCustom.value = storedModel();

  function paintModels() {
    var pr = byId[provSel.value];
    var UI2 = window.NeutronUI;
    /* Pure, unit-tested option builder: a stored model missing from the new
       provider's list stays visible as a "(saved)" option AND stays selected,
       so switching providers never silently discards the user's choice. */
    var built = (UI2 && UI2.buildModelOptions)
      ? UI2.buildModelOptions(pr && pr.defaultModels, modelCustom.value, storedModel())
      : { options: [{ value: "", label: "Auto (provider default)" }], selected: "" };
    while (modelSel.firstChild) modelSel.removeChild(modelSel.firstChild);
    built.options.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      modelSel.appendChild(opt);
    });
    modelSel.value = built.selected;
  }
  paintModels();
  pp.appendChild(field("MODEL", modelSel));
  pp.appendChild(field("CUSTOM MODEL", modelCustom));

  var modelStatus = el("p", "mono small", "");
  function paintModelStatus() {
    var eff = modelCustom.value.trim() || (modelSel.value || "");
    modelStatus.textContent = eff
      ? "STATUS: model \"" + eff + "\" will be requested."
      : "STATUS: no model override — the provider default is used.";
  }
  paintModelStatus();

  function persistChoice() {
    setStoredProvider(provSel.value);
    var eff = modelCustom.value.trim() || modelSel.value;
    setStoredModel(eff);
    paintProvNote();
    paintModels();
    paintModelStatus();
    clearError();
    toast("Provider & model saved.");
  }
  provSel.onchange = persistChoice;
  modelSel.onchange = function () { modelCustom.value = ""; persistChoice(); };
  /* Auto-save the custom model as it is typed (debounced) so it can never
     be silently dropped — the STATUS line below always shows the truth. */
  function localDebounce(fn, wait) {
    var t = null;
    function d() {
      var a = arguments, s = this;
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(s, a); }, wait);
    }
    d.cancel = function () { if (t) { clearTimeout(t); t = null; } };
    return d;
  }
  var debounceFn = window.NeutronUI ? window.NeutronUI.debounce : localDebounce;
  var saveModelSoon = debounceFn(function () {
    setStoredModel(modelCustom.value.trim() || modelSel.value);
    paintModelStatus();
    clearError();
  }, 600);
  modelCustom.oninput = function () { saveModelSoon(); };
  modelCustom.onblur = function () {
    saveModelSoon.cancel();
    setStoredModel(modelCustom.value.trim() || modelSel.value);
    paintModelStatus();
  };
  var modelSave = el("button", "btn primary", "Save provider & model");
  modelSave.onclick = persistChoice;
  var mrow = el("div", "row");
  mrow.appendChild(modelSave);
  pp.appendChild(mrow);
  pp.appendChild(modelStatus);
  view.appendChild(pp);

  /* ----- Model router (Phase 21) ----- */
  var rp = el("section", "panel");
  rp.appendChild(el("h2", null, "Model router"));
  rp.appendChild(el("p", "muted small",
    "Heuristic auto-selection over YOUR configured models only — it never invents model ids. " +
    "Auto picks per message and shows why. Manual suggests and lets you apply. " +
    "Locked never changes your choice, even when the heuristics disagree."));
  var UIm = window.NeutronUI;
  var modeSel = el("select", "input");
  modeSel.setAttribute("aria-label", "Router mode");
  [["auto", "Auto — pick per message"], ["manual", "Manual — suggest only"], ["locked", "Locked — never change my model"]]
    .forEach(function (pair) {
      var o = document.createElement("option");
      o.value = pair[0];
      o.textContent = pair[1];
      modeSel.appendChild(o);
    });
  modeSel.value = routerMode();
  modeSel.onchange = function () {
    if (UIm) lsSet(UIm.ROUTER_MODE_KEY, modeSel.value);
    clearError();
    toast("Router mode: " + modeSel.value + ".");
  };
  rp.appendChild(field("ROUTER MODE", modeSel));
  view.appendChild(rp);

  /* ----- Usage rates (Phase 31) ----- */
  var rt = el("section", "panel");
  rt.appendChild(el("h2", null, "Usage rates"));
  rt.appendChild(el("p", "muted small",
    "What YOU pay per 1M tokens, per model id. Used only to estimate spend on the Usage dashboard. " +
    "Models without a rate show \u2014 for cost — never a guessed price. Check your provider's pricing page."));
  var rateRows = el("div", "rate-rows");
  function rateRow(modelId, rin, rout) {
    var row = el("div", "rate-row");
    var mid = el("input", "input");
    mid.type = "text"; mid.placeholder = "model id (e.g. meta/llama-3.1-70b-instruct)";
    mid.setAttribute("aria-label", "Model id"); mid.autocomplete = "off"; mid.value = modelId || "";
    var rinI = el("input", "input");
    rinI.type = "number"; rinI.min = "0"; rinI.step = "any"; rinI.placeholder = "$/1M in";
    rinI.setAttribute("aria-label", "Dollars per million input tokens"); rinI.value = rin == null ? "" : String(rin);
    var routI = el("input", "input");
    routI.type = "number"; routI.min = "0"; routI.step = "any"; routI.placeholder = "$/1M out";
    routI.setAttribute("aria-label", "Dollars per million output tokens"); routI.value = rout == null ? "" : String(rout);
    var del = el("button", "btn ghost sm", "\u2715");
    del.type = "button"; del.setAttribute("aria-label", "Remove rate row");
    del.onclick = function () { row.parentNode.removeChild(row); };
    row.appendChild(mid); row.appendChild(rinI); row.appendChild(routI); row.appendChild(del);
    return row;
  }
  function paintRateRows() {
    rateRows.innerHTML = "";
    var rates = loadRates();
    Object.keys(rates).forEach(function (k) {
      rateRows.appendChild(rateRow(k, rates[k].in, rates[k].out));
    });
    if (!Object.keys(rates).length) rateRows.appendChild(rateRow("", "", ""));
  }
  paintRateRows();
  rt.appendChild(rateRows);
  var rateBtns = el("div", "row");
  var addRate = el("button", "btn ghost sm", "+ Add rate");
  addRate.type = "button";
  addRate.onclick = function () { rateRows.appendChild(rateRow("", "", "")); };
  var saveRatesBtn = el("button", "btn primary", "Save rates");
  saveRatesBtn.onclick = function () {
    var UIv = window.NeutronUI;
    var out = {};
    var bad = 0;
    Array.prototype.forEach.call(rateRows.children, function (row) {
      var ins = row.querySelectorAll("input");
      var mid = ins[0].value.trim();
      var ri = UIv ? UIv.validateRate(ins[1].value) : null;
      var ro = UIv ? UIv.validateRate(ins[2].value) : null;
      if (!mid && ri == null && ro == null) return; /* empty row */
      if (!mid || ri == null || ro == null) { bad++; return; }
      out[mid] = { in: ri, out: ro };
    });
    if (bad) { showError(bad + " rate row(s) invalid — need a model id and two non-negative numbers."); return; }
    saveRates(out);
    clearError();
    toast("Usage rates saved.");
  };
  rateBtns.appendChild(addRate); rateBtns.appendChild(saveRatesBtn);
  rt.appendChild(rateBtns);
  view.appendChild(rt);

  /* ----- Budget & cost control (Phase 31) ----- */
  var bcp = el("section", "panel");
  bcp.appendChild(el("h2", null, "Budget & cost control"));
  bcp.appendChild(el("p", "muted small",
    "Optional spending guardrails, estimated from your rates above. At 80% of a budget you get a warning; " +
    "at 100% every send asks for confirmation. Max output tokens is passed to the provider when supported."));
  var curB = loadBudget();
  var dailyIn = el("input", "input");
  dailyIn.type = "number"; dailyIn.min = "0"; dailyIn.step = "any"; dailyIn.placeholder = "e.g. 5";
  dailyIn.setAttribute("aria-label", "Daily budget in dollars");
  dailyIn.value = curB.daily == null ? "" : String(curB.daily);
  var monthlyIn = el("input", "input");
  monthlyIn.type = "number"; monthlyIn.min = "0"; monthlyIn.step = "any"; monthlyIn.placeholder = "e.g. 50";
  monthlyIn.setAttribute("aria-label", "Monthly budget in dollars");
  monthlyIn.value = curB.monthly == null ? "" : String(curB.monthly);
  var mtIn = el("input", "input");
  mtIn.type = "number"; mtIn.min = "16"; mtIn.step = "1"; mtIn.placeholder = "e.g. 4096";
  mtIn.setAttribute("aria-label", "Max output tokens");
  var curMt = loadMaxTokens();
  mtIn.value = curMt == null ? "" : String(curMt);
  bcp.appendChild(field("DAILY BUDGET ($)", dailyIn));
  bcp.appendChild(field("MONTHLY BUDGET ($)", monthlyIn));
  bcp.appendChild(field("MAX OUTPUT TOKENS", mtIn));
  var saveB = el("button", "btn primary", "Save budget & limits");
  saveB.onclick = function () {
    var UIb = window.NeutronUI;
    if (!UIb) return;
    var b = UIb.sanitizeBudget({ daily: dailyIn.value, monthly: monthlyIn.value });
    if ((dailyIn.value.trim() || monthlyIn.value.trim()) && !b.daily && !b.monthly) {
      showError("Budgets must be positive numbers (or left empty).");
      return;
    }
    lsSet(UIb.BUDGET_STORE_KEY, JSON.stringify(b));
    var mt = UIb.sanitizeMaxTokens(mtIn.value);
    if (mtIn.value.trim() && mt == null) { showError("Max output tokens must be 16–128000 (or empty)."); return; }
    lsSet(UIb.MAXTOK_STORE_KEY, mt == null ? null : String(mt));
    clearError();
    toast("Budget & limits saved.");
  };
  var brow = el("div", "row");
  brow.appendChild(saveB);
  bcp.appendChild(brow);
  view.appendChild(bcp);

  /* ----- API key ----- */
  var p = el("section", "panel");
  p.appendChild(el("h2", null, "Provider API key"));
  p.appendChild(el("p", "muted small",
    "Bring your own key. It is stored only in this browser's localStorage and sent as the x-api-key header with your requests. It is never stored on the server — each request builds a request-scoped provider from it, and it is redacted from logs."));

  var keyIn = el("input", "input");
  keyIn.type = "password";
  keyIn.placeholder = "Paste your provider API key";
  keyIn.setAttribute("aria-label", "Provider API key");
  keyIn.autocomplete = "off";
  var keyWrap = el("div", "key-wrap");
  keyWrap.appendChild(keyIn);
  var keyToggle = el("button", "btn ghost sm", "Show");
  keyToggle.type = "button";
  keyToggle.setAttribute("aria-label", "Show API key");
  keyToggle.setAttribute("aria-pressed", "false");
  keyToggle.onclick = function () {
    var show = keyIn.type === "password";
    keyIn.type = show ? "text" : "password";
    keyToggle.textContent = show ? "Hide" : "Show";
    keyToggle.setAttribute("aria-label", show ? "Hide API key" : "Show API key");
    keyToggle.setAttribute("aria-pressed", show ? "true" : "false");
  };
  keyWrap.appendChild(keyToggle);
  p.appendChild(field("API KEY", keyWrap));

  var statusLine = el("p", "mono small", "");
  function paintStatus() {
    statusLine.textContent = storedApiKey()
      ? "STATUS: key set — sent only with your requests, never stored on the server."
      : "STATUS: no key set.";
  }
  paintStatus();
  p.appendChild(statusLine);

  var row = el("div", "row");
  var save = el("button", "btn primary", "Save key");
  var clear = el("button", "btn danger", "Clear key");
  save.onclick = function () {
    var k = keyIn.value.trim();
    if (!k) { showError("Paste a key first."); return; }
    setStoredApiKey(k);
    keyIn.value = "";
    keyIn.type = "password";
    keyToggle.textContent = "Show";
    keyToggle.setAttribute("aria-label", "Show API key");
    keyToggle.setAttribute("aria-pressed", "false");
    clearError();
    paintStatus();
    toast("API key saved — stored only in this browser.");
  };
  clear.onclick = function () {
    clearStoredApiKey();
    keyIn.value = "";
    keyIn.type = "password";
    keyToggle.textContent = "Show";
    keyToggle.setAttribute("aria-label", "Show API key");
    keyToggle.setAttribute("aria-pressed", "false");
    clearError();
    paintStatus();
    toast("API key cleared.");
  };
  row.appendChild(save);
  row.appendChild(clear);
  p.appendChild(row);
  view.appendChild(p);

  /* ----- Connect GitHub (additive) ----- */
  try {
    if (window.NeutronGitHub) window.NeutronGitHub.renderConnectSettings(view);
  } catch (e) { /* github connect is additive — never break settings */ }

  var s = el("section", "panel");
  s.appendChild(el("h2", null, "Server provider state"));
  var st = null;
  try { st = await api("GET", "/api/demo/status"); } catch (e) { /* offline */ }
  if (st) {
    s.appendChild(kvGrid([
      ["Server provider", st.providerConfigured ? "configured" : "not configured"],
      ["Note", (st.llmNote || "").slice(0, 160)],
    ]));
  } else {
    s.appendChild(el("p", "muted", "Could not reach the server."));
  }
  s.appendChild(el("p", "muted small",
    "Your key takes precedence over the server's provider for your requests. Remove it here any time; clearing is immediate and nothing of it remains server-side."));
  view.appendChild(s);

  /* ----- Appearance: theme gallery ----- */
  var ap = el("section", "panel");
  ap.appendChild(el("h2", null, "Appearance"));
  ap.appendChild(el("p", "muted small",
    "Pick a theme. \"System\" follows your device's light/dark setting."));
  var themeSearch = el("input", "input theme-search");
  themeSearch.type = "search";
  themeSearch.placeholder = "Search " + THEMES.length + " themes…";
  themeSearch.setAttribute("aria-label", "Search themes");
  ap.appendChild(themeSearch);
  var themeCount = el("p", "muted small theme-count");
  ap.appendChild(themeCount);
  var grid = el("div", "theme-grid");
  function paintThemes() {
    grid.innerHTML = "";
    var cur = storedTheme();
    var q = (themeSearch.value || "").trim().toLowerCase();
    function swatchBtn(id, label, colors, gradient) {
      var b = el("button", "theme-swatch" + (cur === id ? " selected" : ""));
      b.type = "button";
      b.setAttribute("aria-label", label + " theme");
      b.setAttribute("aria-pressed", cur === id ? "true" : "false");
      var strip = el("span", "theme-strip");
      if (gradient) {
        /* Representative gradient preview for glassmorphism themes. */
        var g = el("span", "theme-chip");
        g.style.background = gradient;
        strip.appendChild(g);
      } else {
        colors.forEach(function (c) {
          var s = el("span", "theme-chip");
          s.style.background = c;
          strip.appendChild(s);
        });
      }
      b.appendChild(strip);
      b.appendChild(el("span", "theme-name", label));
      b.onclick = function () {
        setStoredTheme(id === "system" ? "system" : id);
        applyTheme();
        paintThemes();
        toast(id === "system" ? "Theme: System." : "Theme: " + label + ".");
      };
      return b;
    }
    var shown = 0;
    function maybeAdd(t) {
      if (q && (t.name || "").toLowerCase().indexOf(q) === -1 &&
          (t.id || "").toLowerCase().indexOf(q) === -1) return;
      grid.appendChild(swatchBtn(t.id, t.name, t.swatch, t.preview));
      shown++;
    }
    THEMES.forEach(maybeAdd);
    if (!q || "system".indexOf(q) !== -1) {
      grid.appendChild(swatchBtn("system", "System", ["#FFFFFF", "#0E1013", "#888888"]));
      shown++;
    }
    themeCount.textContent = q ? (shown + " of " + (THEMES.length + 1) + " themes") : "";
  }
  themeSearch.addEventListener("input", paintThemes);
  paintThemes();
  ap.appendChild(grid);
  view.appendChild(ap);

  /* ----- Developer Mode (collapsible) ----- */
  var dev = el("details", "dump");
  dev.appendChild(el("summary", null, "DEVELOPER MODE"));
  var devBody = el("div", "dev-body");
  dev.appendChild(devBody);

  // Backend URL override
  devBody.appendChild(el("h3", null, "BACKEND URL OVERRIDE"));
  devBody.appendChild(el("p", "muted small",
    "Point the app at any backend (self-hosted Node server, another deployment). Empty = automatic (same origin as this page). The target must allow CORS — both bundled backends do."));
  var buIn = el("input", "input");
  buIn.type = "url";
  buIn.placeholder = "https://your-backend.example.com  (empty = automatic)";
  buIn.value = storedBackendUrl();
  buIn.setAttribute("aria-label", "Backend URL override");
  buIn.autocomplete = "off";
  devBody.appendChild(field("BACKEND BASE URL", buIn));
  var buEff = el("p", "mono small", "");
  function paintBackendEff() {
    var b = backendBase();
    buEff.textContent = "EFFECTIVE: " + (b ? b : "(same origin as this page)") + "  —  requests go to " + (b || "(same origin)") + "/api/…";
  }
  paintBackendEff();
  devBody.appendChild(buEff);
  var buRow = el("div", "row");
  var buSave = el("button", "btn primary", "Save backend URL");
  var buClear = el("button", "btn ghost", "Use automatic");
  buSave.onclick = function () {
    var u = buIn.value.trim().replace(/\/+$/, "");
    if (u && !/^https?:\/\//i.test(u)) { showError("Backend URL must start with http:// or https://"); return; }
    setStoredBackendUrl(u);
    buIn.value = u;
    clearError();
    paintBackendEff();
  };
  buClear.onclick = function () {
    setStoredBackendUrl("");
    buIn.value = "";
    clearError();
    paintBackendEff();
  };
  buRow.appendChild(buSave);
  buRow.appendChild(buClear);
  devBody.appendChild(buRow);

  // Verbose logging
  devBody.appendChild(el("h3", null, "VERBOSE LOGGING"));
  var vLabel = el("label", "field check");
  var vBox = document.createElement("input");
  vBox.type = "checkbox";
  vBox.checked = isVerbose();
  vBox.onchange = function () { setVerbose(vBox.checked); };
  vLabel.appendChild(vBox);
  vLabel.appendChild(el("span", null, "Log every API call to the browser console"));
  devBody.appendChild(vLabel);

  // API inspector
  devBody.appendChild(el("h3", null, "API INSPECTOR"));
  devBody.appendChild(el("p", "muted small",
    "Last " + API_LOG_MAX + " API calls made by this app in this session, newest first. Secrets are redacted."));
  var insp = el("div", null);
  function paintInspector() {
    insp.innerHTML = "";
    var calls = apiLog();
    if (!calls.length) {
      insp.appendChild(el("p", "muted small", "No API calls recorded yet. Use the app and come back."));
      return;
    }
    calls.forEach(function (c) {
      var d = el("details", "dump");
      d.appendChild(el("summary", "mono small",
        c.method + " " + c.path + "  →  " + (c.status || "ERR") + "  (" + c.ms + "ms)"));
      var txt = "URL: " + c.url + "\nTime: " + c.ts;
      if (c.request) txt += "\n\n— request —\n" + c.request;
      if (c.response) txt += "\n\n— response —\n" + c.response;
      if (c.error) txt += "\n\n— error —\n" + c.error;
      d.appendChild(el("pre", null, txt.slice(0, 8000)));
      insp.appendChild(d);
    });
  }
  paintInspector();
  var iRow = el("div", "row");
  var iRefresh = el("button", "btn ghost", "Refresh");
  iRefresh.onclick = paintInspector;
  var iClear = el("button", "btn ghost", "Clear log");
  iClear.setAttribute("aria-label", "Clear the API inspector log");
  iClear.onclick = function () { clearApiLog(); paintInspector(); };
  iRow.appendChild(iRefresh);
  iRow.appendChild(iClear);
  devBody.appendChild(iRow);
  devBody.appendChild(insp);

  view.appendChild(dev);

  /* ----- About: replay the first-run onboarding ----- */
  var ab = el("section", "panel");
  ab.appendChild(el("h2", null, "About"));
  ab.appendChild(el("p", "muted small",
    "Replay the first-run setup: display name, starter project, and provider walkthrough. Nothing is deleted — it only shows the setup flow again."));
  var abRow = el("div", "row");
  var replayBtn = el("button", "btn ghost", "Replay onboarding");
  replayBtn.type = "button";
  replayBtn.onclick = function () {
    var UO = window.NeutronUI;
    onboardingState = UO ? UO.onboardingReplay(loadOnboarding()) : onboardingState;
    saveOnboarding();
    showOnboarding();
  };
  abRow.appendChild(replayBtn);
  ab.appendChild(abRow);
  view.appendChild(ab);
}

/* ---------- boot ---------- */

function paintOfflineBar() {
  var bar = document.getElementById("offline-bar");
  if (!bar) return;
  var offline = (typeof navigator !== "undefined" && "onLine" in navigator)
    ? !navigator.onLine : false;
  bar.classList.toggle("hidden", !offline);
}
window.addEventListener("online", paintOfflineBar);
window.addEventListener("offline", paintOfflineBar);

var chatKeysBound = false;
function bindChatKeys() {
  if (chatKeysBound) return;
  chatKeysBound = true;
  /* Close the history item menu when clicking anywhere else. */
  document.addEventListener("click", function (ev) {
    try { if (ChatHooks.outsideClick) ChatHooks.outsideClick(ev); } catch (e) {}
  });
  document.addEventListener("keydown", function (ev) {
    if (currentRoute() !== "chat") return;
    var mod = ev.ctrlKey || ev.metaKey;
    var key = ev.key;
    /* NOTE: Ctrl/Cmd+K opens the global command palette (bound in
       palette.js) on every route — including chat. The history search
       input stays clickable/focusable, and the palette has a
       "Search Chat History" command that focuses it. */
    if (mod && ev.shiftKey && (key === "N" || key === "n")) {
      ev.preventDefault();
      if (ChatHooks.newTask) ChatHooks.newTask();
      return;
    }
    if (key === "Escape") {
      if (ChatHooks.closeOverlays) ChatHooks.closeOverlays();
      return;
    }
    if ((key === "ArrowDown" || key === "ArrowUp") && ChatHooks.moveHistSelection) {
      var ae = document.activeElement;
      if (ae && ae.classList && ae.classList.contains("hist-open")) {
        ev.preventDefault();
        ChatHooks.moveHistSelection(key === "ArrowDown" ? 1 : -1);
      }
    }
  });
}

/* ---------- app bridge for the command palette (palette.js) ----------
   Small, explicit surface: the palette needs read access to the
   device-local stores and a few global actions. Everything here is real —
   no invented data. */
window.NeutronApp = {
  getConversationIndex: function () {
    loadConvStore();
    var out = [];
    Object.keys(convStore.items || {}).forEach(function (id) {
      var it = convStore.items[id];
      if (!it || it.archived) return;
      var excerpt = "";
      try {
        excerpt = (it.messages || []).map(function (m) {
          return m && m.text ? String(m.text) : "";
        }).join("\n").slice(0, 600);
      } catch (e) {}
      out.push({
        id: id, title: it.title, updatedAt: it.updatedAt,
        createdAt: it.createdAt, archived: it.archived, excerpt: excerpt,
      });
    });
    return out;
  },
  getProjectIndex: function () {
    loadProjectStore();
    var NU = window.NeutronUI;
    var out = [];
    Object.keys((projectStore && projectStore.items) || {}).forEach(function (id) {
      var p = projectStore.items[id];
      if (!p) return;
      var mem = "";
      try { if (NU && NU.buildProjectContextBlock) mem = NU.buildProjectContextBlock(p).slice(0, 600); } catch (e) {}
      out.push({ id: id, name: p.name, updatedAt: p.updatedAt, createdAt: p.createdAt, memoryText: mem });
    });
    return out;
  },
  newChat: function () {
    if (currentRoute() === "chat" && ChatHooks.newTask) { ChatHooks.newTask(); return; }
    loadConvStore();
    var NU = window.NeutronUI;
    var id = genConvId();
    var item = NU ? NU.convCreate(convStore, id, Date.now()) : null;
    if (item) {
      item.provider = storedProvider();
      item.model = storedModel();
      saveConvStore();
    }
    if (currentRoute() !== "chat") location.hash = "#/chat";
    else render();
  },
  askAi: function () {
    window.__neutronFocusComposer = true;
    if (currentRoute() !== "chat") location.hash = "#/chat";
    else if (ChatHooks.focusComposer) ChatHooks.focusComposer();
  },
  searchHistory: function () {
    window.__neutronFocusHistSearch = true;
    if (currentRoute() !== "chat") location.hash = "#/chat";
    else if (ChatHooks.focusHistorySearch) ChatHooks.focusHistorySearch();
  },
  cycleTheme: function () {
    var ids = ["system"].concat(THEME_IDS);
    var cur = storedTheme();
    var next = ids[(ids.indexOf(cur) + 1) % ids.length] || "system";
    setStoredTheme(next);
    applyTheme();
    var label = next === "system" ? "System" :
      (THEMES.filter(function (t) { return t.id === next; })[0] || {}).name || next;
    toast("Theme: " + label);
  },
  /* ---------- model comparison bridge (Phase 22) ---------- */
  getProviders: function () {
    if (window.__neutronProvidersCache) return Promise.resolve(window.__neutronProvidersCache);
    return fetchProviders().then(function (list) {
      window.__neutronProvidersCache = list;
      return list;
    });
  },
  getStoredProvider: function () { return storedProvider(); },
  getStoredModel: function () { return storedModel(); },
  hasApiKey: function () { try { return !!storedApiKey(); } catch (e) { return false; } },
  getRates: function () { return loadRates(); },
  getMaxTokens: function () { return loadMaxTokens(); },
  getBudget: function () { return loadBudget(); },
  /* One /api/chat call with a per-request provider override + abort signal. */
  chatCompare: function (body, opts) { return api("POST", "/api/chat", body, opts || {}); },
  logUsage: function (entry) { recordUsage(entry); },
  /* Budget-aware max-cost estimate for a comparison run. Reuses the usage
     dashboard's rates/budget helpers — never invents prices. */
  estimateCompareCost: function (slots, promptChars) {
    var UI = window.NeutronUI;
    var rates = loadRates();
    var b = loadBudget();
    var log = loadUsageLog();
    var maxOut = loadMaxTokens();
    var est = UI ? UI.compareEstimateCost({
      promptChars: promptChars,
      maxOutTok: maxOut || undefined,
      rates: rates,
      models: (slots || []).map(function (s) { return s.model; }),
    }) : { inTok: 0, outTok: 0, perSlot: [], total: 0, costed: 0, uncosted: (slots || []).length };
    var spentD = periodSpend(log, rates, 1).dollars;
    var spentM = periodSpend(log, rates, 30).dollars;
    return {
      perSlot: est.perSlot, total: est.total,
      costed: est.costed, uncosted: est.uncosted,
      inTok: est.inTok, outTok: est.outTok,
      daily: b.daily, monthly: b.monthly,
      spentDaily: spentD, spentMonth: spentM,
      overDaily: UI ? UI.budgetStatus(spentD + est.total, b.daily) === "over" : false,
      overMonthly: UI ? UI.budgetStatus(spentM + est.total, b.monthly) === "over" : false,
    };
  },
  /* Create a conversation prefilled with messages (for compare "save to
     chat" / "continue with this"). Returns the new conversation id. */
  createChatWith: function (provider, model, messages) {
    loadConvStore();
    var NU = window.NeutronUI;
    if (!NU) return null;
    var id = genConvId();
    var item = NU.convCreate(convStore, id, Date.now());
    if (!item) return null;
    item.provider = provider || "";
    item.model = model || "";
    (messages || []).forEach(function (m) {
      if (!m || typeof m !== "object") return;
      item.messages.push({
        role: m.role === "assistant" ? "assistant" : "user",
        text: String(m.text == null ? "" : m.text),
        ts: m.ts || Date.now(),
      });
    });
    NU.convTouch(convStore, id, Date.now());
    saveConvStore();
    return id;
  },
  openChat: function (id, focus) {
    if (focus) window.__neutronFocusComposer = true;
    location.hash = "#/chat/" + encodeURIComponent(id);
  },
};

document.addEventListener("DOMContentLoaded", function () {
  if (!location.hash) location.hash = "#/dashboard";
  applyTheme(); // head script already did this; re-assert for cached pages
  paintOfflineBar();
  var dismiss = document.getElementById("error-dismiss");
  if (dismiss) dismiss.addEventListener("click", clearError);
  bindChatKeys();
  render();
  /* First-run onboarding overlay (Phase 36): skippable, replayable from
     Settings. Never blocks boot — failures are swallowed. */
  try { if (!loadOnboarding().done) showOnboarding(); } catch (e) {}
});
