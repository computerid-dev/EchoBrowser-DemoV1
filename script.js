/* =========================================================
   ECHO BROWSER — script.js
   Semua logika: tab, navigasi, iframe viewer, bookmark,
   history, shortcut, settings — murni JavaScript + localStorage.
   Tidak ada API key, tidak ada backend, tidak ada scraping.
   ========================================================= */

(() => {
  "use strict";

  /* ---------------------------------------------------------
     0. KONSTANTA & STORAGE KEYS
  --------------------------------------------------------- */
  const LS = {
    SETTINGS: "echo_settings",
    BOOKMARKS: "echo_bookmarks",
    HISTORY: "echo_history",
    SHORTCUTS: "echo_shortcuts",
  };

  const SEARCH_ENGINES = {
    google: "https://www.google.com/search?q=",
    duckduckgo: "https://duckduckgo.com/?q=",
    bing: "https://www.bing.com/search?q=",
    ecosia: "https://www.ecosia.org/search?q=",
  };

  // Daftar domain yang DIKETAHUI menolak ditampilkan di iframe
  // (X-Frame-Options / CSP frame-ancestors). Ini heuristik best-effort,
  // bukan daftar lengkap — dibuat supaya user tidak menunggu timeout
  // untuk situs yang sudah pasti akan gagal.
  const KNOWN_BLOCKED_DOMAINS = [
    "google.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
    "linkedin.com", "tiktok.com", "netflix.com", "whatsapp.com", "amazon.com",
    "chatgpt.com", "openai.com", "claude.ai", "paypal.com", "bankofamerica.com",
    "reddit.com", "pinterest.com",
  ];

  const IFRAME_TIMEOUT_MS = 8000;
  const DEFAULT_SHORTCUTS = [
    { id: "s1", label: "Wikipedia", url: "https://www.wikipedia.org" },
    { id: "s2", label: "MDN", url: "https://developer.mozilla.org" },
    { id: "s3", label: "Vercel", url: "https://vercel.com" },
  ];

  /* ---------------------------------------------------------
     1. STATE
  --------------------------------------------------------- */
  let settings = loadSettings();
  let bookmarks = loadJSON(LS.BOOKMARKS, []);
  let history = loadJSON(LS.HISTORY, []);
  let shortcuts = loadJSON(LS.SHORTCUTS, DEFAULT_SHORTCUTS);

  let tabs = [];
  let activeTabId = null;
  let tabCounter = 0;

  /* ---------------------------------------------------------
     2. ELEMEN DOM
  --------------------------------------------------------- */
  const el = {
    tabs: document.getElementById("tabs"),
    btnNewTab: document.getElementById("btn-new-tab"),
    viewport: document.getElementById("viewport"),
    btnBack: document.getElementById("btn-back"),
    btnForward: document.getElementById("btn-forward"),
    btnReload: document.getElementById("btn-reload"),
    btnHome: document.getElementById("btn-home"),
    btnStar: document.getElementById("btn-star"),
    addressForm: document.getElementById("address-form"),
    addressInput: document.getElementById("address-input"),
    addressStatus: document.getElementById("address-status"),
    btnMenu: document.getElementById("btn-menu"),
    menuDropdown: document.getElementById("menu-dropdown"),
    brandHomeBtn: document.getElementById("brand-home-btn"),
    btnHistory: document.getElementById("btn-history"),
    btnBookmarks: document.getElementById("btn-bookmarks"),
    btnSettings: document.getElementById("btn-settings"),
    overlay: document.getElementById("overlay"),
    settingsPanel: document.getElementById("settings-panel"),
    bookmarksPanel: document.getElementById("bookmarks-panel"),
    historyPanel: document.getElementById("history-panel"),
    aboutModal: document.getElementById("about-modal"),
    bookmarksList: document.getElementById("bookmarks-list"),
    bookmarksEmpty: document.getElementById("bookmarks-empty"),
    historyList: document.getElementById("history-list"),
    historyEmpty: document.getElementById("history-empty"),
    themeSegmented: document.getElementById("theme-segmented"),
    settingHomepage: document.getElementById("setting-homepage"),
    settingSearchEngine: document.getElementById("setting-search-engine"),
    settingNewtab: document.getElementById("setting-newtab"),
    btnClearHistory: document.getElementById("btn-clear-history"),
    btnClearHistory2: document.getElementById("btn-clear-history-2"),
    btnClearBookmarks: document.getElementById("btn-clear-bookmarks"),
    btnClearAll: document.getElementById("btn-clear-all"),
    toastContainer: document.getElementById("toast-container"),
  };

  /* ---------------------------------------------------------
     3. STORAGE HELPERS
  --------------------------------------------------------- */
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      showToast("Gagal menyimpan data lokal (localStorage penuh/diblokir).");
    }
  }
  function loadSettings() {
    return loadJSON(LS.SETTINGS, {
      theme: "system",
      homepage: "echo://home",
      searchEngine: "google",
      newTab: "home",
    });
  }
  function saveSettings() { saveJSON(LS.SETTINGS, settings); }
  function saveBookmarks() { saveJSON(LS.BOOKMARKS, bookmarks); }
  function saveHistory() { saveJSON(LS.HISTORY, history); }
  function saveShortcuts() { saveJSON(LS.SHORTCUTS, shortcuts); }

  /* ---------------------------------------------------------
     4. UTIL: URL & INPUT PARSING
  --------------------------------------------------------- */
  function getHostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch { return url; }
  }

  function looksLikeUrl(input) {
    if (/^https?:\/\//i.test(input)) return true;
    // pola sederhana: tanpa spasi & mengandung titik domain, atau localhost/IP
    if (/\s/.test(input)) return false;
    if (/^localhost(:\d+)?$/i.test(input)) return true;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(input);
  }

  // Mengubah input address bar menjadi URL final yang siap dimuat
  function resolveInput(rawInput) {
    const input = rawInput.trim();
    if (!input) return null;
    if (looksLikeUrl(input)) {
      return /^https?:\/\//i.test(input) ? input : `https://${input}`;
    }
    // bukan URL -> perlakukan sebagai pencarian
    const template = SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google;
    return template + encodeURIComponent(input);
  }

  function isKnownBlocked(url) {
    const host = getHostname(url);
    return KNOWN_BLOCKED_DOMAINS.some((d) => host === d || host.endsWith("." + d));
  }

  /* ---------------------------------------------------------
     5. TAB MODEL
  --------------------------------------------------------- */
  function createTab(initialUrl) {
    tabCounter += 1;
    const id = "tab-" + tabCounter;
    const tab = {
      id,
      url: initialUrl || "echo://home",
      title: initialUrl ? getHostname(initialUrl) : "Beranda",
      status: initialUrl ? "loading" : "home", // home | loading | loaded | error
      errorReason: null,
      navStack: [initialUrl || "echo://home"],
      navIndex: 0,
      contentEl: null,
      iframeEl: null,
      loadTimeoutId: null,
    };
    tabs.push(tab);
    mountTabContent(tab);
    switchTab(id);
    if (initialUrl) attemptLoad(tab, initialUrl);
    renderTabs();
    return tab;
  }

  function closeTab(id) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const tab = tabs[idx];
    if (tab.loadTimeoutId) clearTimeout(tab.loadTimeoutId);
    if (tab.contentEl) tab.contentEl.remove();
    tabs.splice(idx, 1);

    if (tabs.length === 0) {
      createTab(null);
      return;
    }
    if (activeTabId === id) {
      const next = tabs[idx] || tabs[idx - 1];
      switchTab(next.id);
    }
    renderTabs();
  }

  function switchTab(id) {
    activeTabId = id;
    tabs.forEach((t) => {
      if (t.contentEl) t.contentEl.classList.toggle("active", t.id === id);
    });
    renderTabs();
    syncChrome();
  }

  function getActiveTab() {
    return tabs.find((t) => t.id === activeTabId) || null;
  }

  /* ---------------------------------------------------------
     6. RENDER: TAB STRIP
  --------------------------------------------------------- */
  function renderTabs() {
    el.tabs.innerHTML = "";
    tabs.forEach((tab) => {
      const chip = document.createElement("div");
      chip.className = "tab-chip" + (tab.id === activeTabId ? " active" : "");
      chip.setAttribute("role", "tab");
      chip.title = tab.url === "echo://home" ? "Beranda" : tab.url;

      const titleSpan = document.createElement("span");
      titleSpan.className = "tab-title";
      titleSpan.textContent = tab.title || "Tab baru";

      const closeBtn = document.createElement("span");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "✕";
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });

      chip.addEventListener("click", () => switchTab(tab.id));
      chip.appendChild(titleSpan);
      chip.appendChild(closeBtn);
      el.tabs.appendChild(chip);
    });
  }

  /* ---------------------------------------------------------
     7. RENDER: KONTEN TAB (home / loading / iframe / error)
  --------------------------------------------------------- */
  function mountTabContent(tab) {
    const wrap = document.createElement("div");
    wrap.className = "tab-content";
    wrap.id = "content-" + tab.id;
    el.viewport.appendChild(wrap);
    tab.contentEl = wrap;
    renderTabBody(tab);
  }

  function renderTabBody(tab) {
    const wrap = tab.contentEl;
    wrap.innerHTML = "";

    if (tab.url === "echo://home") {
      wrap.appendChild(buildHomeScreen(tab));
      return;
    }
    if (tab.status === "loading") {
      wrap.appendChild(buildLoadingScreen(tab));
      return;
    }
    if (tab.status === "error") {
      wrap.appendChild(buildErrorScreen(tab));
      return;
    }
    // status loaded -> tampilkan iframe (dibuat ulang di attemptLoad)
    if (tab.iframeEl) wrap.appendChild(tab.iframeEl);
  }

  function buildHomeScreen(tab) {
    const wrap = document.createElement("div");
    wrap.className = "home-screen";
    wrap.innerHTML = `
      <svg class="home-rings" viewBox="0 0 100 100" aria-hidden="true">
        <rect x="4" y="4" width="92" height="92" fill="none" stroke="var(--ink)" stroke-width="4"/>
        <rect x="24" y="24" width="52" height="52" fill="none" stroke="var(--ink)" stroke-width="4"/>
        <rect x="42" y="42" width="16" height="16" fill="var(--ink)"/>
      </svg>
      <svg class="home-logo" viewBox="0 0 100 100" aria-hidden="true">
        <rect x="8" y="8" width="84" height="84" fill="none" stroke="var(--ink)" stroke-width="9"/>
        <rect x="28" y="28" width="44" height="44" fill="none" stroke="var(--ink)" stroke-width="9"/>
        <rect x="42" y="42" width="16" height="16" fill="var(--primary)"/>
      </svg>
      <h1 class="home-title">ECHO<span>BROWSER</span></h1>
      <p class="home-tagline">Website-mu, dengan caramu.</p>
      <div class="home-search-wrap">
        <input class="home-search-input" type="text" placeholder="Ketik alamat situs atau kata kunci pencarian…" spellcheck="false">
        <button class="home-search-btn">OPEN</button>
      </div>
      <div class="home-section" id="home-shortcuts-section">
        <div class="home-section-head">
          <h3>Shortcut</h3>
          <button class="home-add-btn" id="home-add-shortcut">+ TAMBAH</button>
        </div>
        <div class="shortcut-grid" id="home-shortcut-grid"></div>
      </div>
      <div class="home-section" id="home-bookmarks-section">
        <div class="home-section-head"><h3>Bookmark Tersimpan</h3></div>
        <div class="bookmark-strip" id="home-bookmark-strip"></div>
      </div>
    `;

    const input = wrap.querySelector(".home-search-input");
    const goBtn = wrap.querySelector(".home-search-btn");
    const submit = () => {
      const resolved = resolveInput(input.value);
      if (resolved) navigate(tab.id, resolved);
    };
    goBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

    wrap.querySelector("#home-add-shortcut").addEventListener("click", openAddShortcutPrompt);
    renderShortcutGrid(wrap.querySelector("#home-shortcut-grid"), tab);
    renderHomeBookmarkStrip(wrap.querySelector("#home-bookmark-strip"), tab);

    return wrap;
  }

  function renderShortcutGrid(container, tab) {
    container.innerHTML = "";
    if (shortcuts.length === 0) {
      container.innerHTML = `<p class="empty-note">Belum ada shortcut. Klik "+ TAMBAH" untuk menambahkan situs favoritmu.</p>`;
      return;
    }
    shortcuts.forEach((s) => {
      const tile = document.createElement("div");
      tile.className = "shortcut-tile";
      const initial = (s.label || getHostname(s.url) || "?").trim().charAt(0).toUpperCase();
      tile.innerHTML = `
        <div class="shortcut-remove" title="Hapus shortcut">✕</div>
        <div class="shortcut-icon">${initial}</div>
        <div class="shortcut-label">${escapeHtml(s.label)}</div>
      `;
      tile.addEventListener("click", (e) => {
        if (e.target.closest(".shortcut-remove")) return;
        navigate(tab.id, s.url);
      });
      tile.querySelector(".shortcut-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        shortcuts = shortcuts.filter((x) => x.id !== s.id);
        saveShortcuts();
        renderShortcutGrid(container, tab);
        showToast("Shortcut dihapus.");
      });
      container.appendChild(tile);
    });
  }

  function renderHomeBookmarkStrip(container, tab) {
    container.innerHTML = "";
    if (bookmarks.length === 0) {
      container.innerHTML = `<p class="empty-note">Belum ada bookmark tersimpan.</p>`;
      return;
    }
    bookmarks.slice(0, 10).forEach((b) => {
      const chip = document.createElement("div");
      chip.className = "bookmark-chip";
      chip.textContent = "★ " + (b.title || getHostname(b.url));
      chip.addEventListener("click", () => navigate(tab.id, b.url));
      container.appendChild(chip);
    });
  }

  function openAddShortcutPrompt() {
    const url = prompt("Masukkan URL untuk shortcut baru:\n(contoh: https://example.com)");
    if (!url) return;
    const resolved = looksLikeUrl(url.trim()) ? (/^https?:\/\//i.test(url.trim()) ? url.trim() : "https://" + url.trim()) : null;
    if (!resolved) { showToast("URL tidak valid."); return; }
    const label = prompt("Nama shortcut:", getHostname(resolved)) || getHostname(resolved);
    shortcuts.push({ id: "s" + Date.now(), label, url: resolved });
    saveShortcuts();
    renderTabBody(getActiveTab());
    showToast("Shortcut ditambahkan ✓");
  }

  function buildLoadingScreen(tab) {
    const wrap = document.createElement("div");
    wrap.className = "loading-screen";
    wrap.innerHTML = `
      <div class="echo-pulse"><span></span><span></span><span></span></div>
      <div class="loading-text">MEMUAT ${escapeHtml(getHostname(tab.url)).toUpperCase()}…</div>
      <div class="loading-hint">Situs terlihat kosong atau tidak kunjung tampil? <button id="manual-fail-btn">Klik di sini</button></div>
    `;
    wrap.querySelector("#manual-fail-btn").addEventListener("click", () => {
      if (tab.loadTimeoutId) clearTimeout(tab.loadTimeoutId);
      showError(tab, "manual");
    });
    return wrap;
  }

  function buildErrorScreen(tab) {
    const wrap = document.createElement("div");
    wrap.className = "error-screen";
    const reasons = {
      "known-blocked": "Situs ini diketahui menolak untuk ditampilkan di dalam iframe (kebijakan X-Frame-Options / CSP milik situs tersebut).",
      "timeout": "Situs tidak kunjung merespons dalam waktu wajar. Kemungkinan situs menolak embedding atau koneksi lambat.",
      "load-error": "Terjadi kegagalan saat memuat situs ini.",
      "manual": "Situs tampaknya tidak dapat ditampilkan dengan benar di dalam EchoBrowser.",
      "invalid": "Alamat yang kamu masukkan tidak valid.",
      "offline": "Tidak ada koneksi internet. Periksa koneksimu lalu coba lagi.",
    };
    wrap.innerHTML = `
      <div class="error-badge">✕</div>
      <h2 class="error-title">Website Tidak Dapat Ditampilkan</h2>
      <p class="error-desc">${reasons[tab.errorReason] || reasons["load-error"]}<br><br>Ini bukan bug — EchoBrowser tidak melewati (bypass) pengaturan keamanan situs mana pun.</p>
      <div class="error-actions">
        <button class="secondary-btn" id="err-back-btn">KEMBALI</button>
        <button class="secondary-btn" id="err-retry-btn">COBA LAGI</button>
        <button class="primary-btn" id="err-open-btn">BUKA DI BROWSER UTAMA</button>
      </div>
    `;
    wrap.querySelector("#err-back-btn").addEventListener("click", () => back(tab.id));
    wrap.querySelector("#err-retry-btn").addEventListener("click", () => attemptLoad(tab, tab.url, { pushHistory: false }));
    wrap.querySelector("#err-open-btn").addEventListener("click", () => window.open(tab.url, "_blank", "noopener"));
    return wrap;
  }

  /* ---------------------------------------------------------
     8. NAVIGASI
  --------------------------------------------------------- */
  function navigate(tabId, url, opts = {}) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const pushHistory = opts.pushHistory !== false;

    if (pushHistory) {
      // buang forward-stack, tambahkan entri baru
      tab.navStack = tab.navStack.slice(0, tab.navIndex + 1);
      tab.navStack.push(url);
      tab.navIndex = tab.navStack.length - 1;
    }

    tab.url = url;
    tab.title = url === "echo://home" ? "Beranda" : getHostname(url);
    renderTabs();

    if (url === "echo://home") {
      tab.status = "home";
      tab.errorEl = null;
      renderTabBody(tab);
      syncChrome();
      return;
    }
    attemptLoad(tab, url, { pushHistory: false, alreadyPushed: true });
  }

  function back(tabId) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || tab.navIndex <= 0) return;
    tab.navIndex -= 1;
    loadFromStack(tab);
  }
  function forward(tabId) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || tab.navIndex >= tab.navStack.length - 1) return;
    tab.navIndex += 1;
    loadFromStack(tab);
  }
  function loadFromStack(tab) {
    const url = tab.navStack[tab.navIndex];
    tab.url = url;
    tab.title = url === "echo://home" ? "Beranda" : getHostname(url);
    if (url === "echo://home") {
      tab.status = "home";
      renderTabBody(tab);
    } else {
      attemptLoad(tab, url, { pushHistory: false, skipHistoryLog: true });
    }
    renderTabs();
    syncChrome();
  }

  function reload(tabId) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.url === "echo://home") { renderTabBody(tab); return; }
    attemptLoad(tab, tab.url, { pushHistory: false, skipHistoryLog: true });
  }

  function goHome(tabId) {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const target = settings.homepage && settings.homepage !== "echo://home" ? settings.homepage : "echo://home";
    navigate(tabId, target);
  }

  /* ---------------------------------------------------------
     9. WEBSITE VIEWER (iframe) + DETEKSI GAGAL
  --------------------------------------------------------- */
  function attemptLoad(tab, url, opts = {}) {
    if (!navigator.onLine) {
      tab.status = "error"; tab.errorReason = "offline";
      renderTabBody(tab); syncChrome(); return;
    }

    tab.status = "loading";
    tab.errorReason = null;
    renderTabBody(tab);
    syncChrome();

    if (isKnownBlocked(url)) {
      // Tidak perlu menunggu — situs ini diketahui menolak iframe.
      tab.status = "error";
      tab.errorReason = "known-blocked";
      renderTabBody(tab);
      syncChrome();
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    iframe.title = "Konten situs: " + url;

    let settled = false;
    const finishOk = () => {
      if (settled) return;
      settled = true;
      clearTimeout(tab.loadTimeoutId);
      tab.status = "loaded";
      tab.iframeEl = iframe;
      renderTabBody(tab);
      syncChrome();
      if (!opts.skipHistoryLog) logHistory(url, tab.title);
    };
    const finishFail = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(tab.loadTimeoutId);
      tab.status = "error";
      tab.errorReason = reason;
      renderTabBody(tab);
      syncChrome();
    };

    iframe.addEventListener("load", finishOk);
    iframe.addEventListener("error", () => finishFail("load-error"));

    tab.loadTimeoutId = setTimeout(() => finishFail("timeout"), IFRAME_TIMEOUT_MS);
    iframe.src = url;
  }

  function logHistory(url, title) {
    history.unshift({ id: "h" + Date.now(), url, title: title || getHostname(url), time: Date.now() });
    if (history.length > 200) history = history.slice(0, 200);
    saveHistory();
  }

  /* ---------------------------------------------------------
     10. SINKRONISASI UI CHROME (address bar, tombol nav, star)
  --------------------------------------------------------- */
  function syncChrome() {
    const tab = getActiveTab();
    if (!tab) return;

    el.addressInput.value = tab.url === "echo://home" ? "" : tab.url;
    el.btnBack.disabled = tab.navIndex <= 0;
    el.btnForward.disabled = tab.navIndex >= tab.navStack.length - 1;

    el.addressStatus.className = "address-status";
    if (tab.status === "loading") el.addressStatus.classList.add("loading");
    else if (tab.status === "loaded") el.addressStatus.classList.add("loaded");
    else if (tab.status === "error") el.addressStatus.classList.add("error");

    const bookmarked = tab.url !== "echo://home" && bookmarks.some((b) => b.url === tab.url);
    el.btnStar.classList.toggle("is-active", bookmarked);
    el.btnStar.disabled = tab.url === "echo://home";
  }

  /* ---------------------------------------------------------
     11. BOOKMARK
  --------------------------------------------------------- */
  function toggleBookmark() {
    const tab = getActiveTab();
    if (!tab || tab.url === "echo://home") return;
    const idx = bookmarks.findIndex((b) => b.url === tab.url);
    if (idx > -1) {
      bookmarks.splice(idx, 1);
      showToast("Bookmark dihapus.");
    } else {
      bookmarks.unshift({ id: "b" + Date.now(), url: tab.url, title: tab.title });
      showToast("Tersimpan ke bookmark ★");
    }
    saveBookmarks();
    syncChrome();
    renderBookmarksPanel();
    if (tab.status === "home") renderTabBody(tab);
  }

  function renderBookmarksPanel() {
    el.bookmarksList.innerHTML = "";
    el.bookmarksEmpty.classList.toggle("hidden", bookmarks.length > 0);
    bookmarks.forEach((b) => {
      const item = document.createElement("div");
      item.className = "entry-item";
      item.innerHTML = `
        <div class="entry-main">
          <div class="entry-title"></div>
          <div class="entry-url"></div>
        </div>
        <div class="entry-actions">
          <button class="entry-btn" data-act="rename" title="Ubah nama">✎</button>
          <button class="entry-btn" data-act="delete" title="Hapus">✕</button>
        </div>`;
      item.querySelector(".entry-title").textContent = b.title || getHostname(b.url);
      item.querySelector(".entry-url").textContent = b.url;
      item.querySelector(".entry-main").addEventListener("click", () => {
        navigate(activeTabId, b.url);
        closePanel(el.bookmarksPanel);
      });
      item.querySelector('[data-act="rename"]').addEventListener("click", (e) => {
        e.stopPropagation();
        const name = prompt("Nama baru untuk bookmark ini:", b.title || getHostname(b.url));
        if (name) { b.title = name; saveBookmarks(); renderBookmarksPanel(); }
      });
      item.querySelector('[data-act="delete"]').addEventListener("click", (e) => {
        e.stopPropagation();
        bookmarks = bookmarks.filter((x) => x.id !== b.id);
        saveBookmarks(); renderBookmarksPanel(); syncChrome();
      });
      el.bookmarksList.appendChild(item);
    });
  }

  /* ---------------------------------------------------------
     12. HISTORY
  --------------------------------------------------------- */
  function renderHistoryPanel() {
    el.historyList.innerHTML = "";
    el.historyEmpty.classList.toggle("hidden", history.length > 0);
    history.forEach((h) => {
      const item = document.createElement("div");
      item.className = "entry-item";
      item.innerHTML = `
        <div class="entry-main">
          <div class="entry-title"></div>
          <div class="entry-url"></div>
          <div class="entry-time"></div>
        </div>
        <div class="entry-actions">
          <button class="entry-btn" data-act="delete" title="Hapus">✕</button>
        </div>`;
      item.querySelector(".entry-title").textContent = h.title || getHostname(h.url);
      item.querySelector(".entry-url").textContent = h.url;
      item.querySelector(".entry-time").textContent = formatTime(h.time);
      item.querySelector(".entry-main").addEventListener("click", () => {
        navigate(activeTabId, h.url);
        closePanel(el.historyPanel);
      });
      item.querySelector('[data-act="delete"]').addEventListener("click", (e) => {
        e.stopPropagation();
        history = history.filter((x) => x.id !== h.id);
        saveHistory(); renderHistoryPanel();
      });
      el.historyList.appendChild(item);
    });
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  /* ---------------------------------------------------------
     13. SETTINGS
  --------------------------------------------------------- */
  function applyTheme() {
    let effective = settings.theme;
    if (effective === "system") {
      effective = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.documentElement.setAttribute("data-theme", effective);
    [...el.themeSegmented.children].forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.themeValue === settings.theme);
    });
  }

  function populateSettingsForm() {
    el.settingHomepage.value = settings.homepage;
    el.settingSearchEngine.value = settings.searchEngine;
    el.settingNewtab.value = settings.newTab;
    applyTheme();
  }

  /* ---------------------------------------------------------
     14. PANEL / MODAL HELPERS
  --------------------------------------------------------- */
  function openPanel(panelEl) {
    el.overlay.classList.remove("hidden");
    panelEl.classList.remove("hidden");
  }
  function closePanel(panelEl) {
    panelEl.classList.add("hidden");
    if ([el.settingsPanel, el.bookmarksPanel, el.historyPanel].every((p) => p.classList.contains("hidden"))) {
      el.overlay.classList.add("hidden");
    }
  }
  function closeAllPanels() {
    [el.settingsPanel, el.bookmarksPanel, el.historyPanel].forEach((p) => p.classList.add("hidden"));
    el.overlay.classList.add("hidden");
    el.aboutModal.classList.add("hidden");
  }

  /* ---------------------------------------------------------
     15. TOAST
  --------------------------------------------------------- */
  function showToast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    el.toastContainer.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str ?? "";
    return d.innerHTML;
  }

  /* ---------------------------------------------------------
     16. EVENT BINDINGS
  --------------------------------------------------------- */
  el.btnNewTab.addEventListener("click", () => {
    createTab(settings.newTab === "home" ? null : null); // keduanya mulai dari home screen internal
  });

  el.btnBack.addEventListener("click", () => back(activeTabId));
  el.btnForward.addEventListener("click", () => forward(activeTabId));
  el.btnReload.addEventListener("click", () => reload(activeTabId));
  el.btnHome.addEventListener("click", () => goHome(activeTabId));
  el.brandHomeBtn.addEventListener("click", () => goHome(activeTabId));
  el.btnStar.addEventListener("click", toggleBookmark);

  el.addressForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const resolved = resolveInput(el.addressInput.value);
    if (!resolved) return;
    navigate(activeTabId, resolved);
    el.addressInput.blur();
  });

  el.btnMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    el.menuDropdown.classList.toggle("hidden");
  });
  document.addEventListener("click", () => el.menuDropdown.classList.add("hidden"));

  el.menuDropdown.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "bookmarks") { renderBookmarksPanel(); openPanel(el.bookmarksPanel); }
    if (action === "history") { renderHistoryPanel(); openPanel(el.historyPanel); }
    if (action === "settings") { populateSettingsForm(); openPanel(el.settingsPanel); }
    if (action === "about") { el.aboutModal.classList.remove("hidden"); }
  });

  el.btnHistory.addEventListener("click", () => { renderHistoryPanel(); openPanel(el.historyPanel); });
  el.btnBookmarks.addEventListener("click", () => { renderBookmarksPanel(); openPanel(el.bookmarksPanel); });
  el.btnSettings.addEventListener("click", () => { populateSettingsForm(); openPanel(el.settingsPanel); });

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.close;
      const target = document.getElementById(targetId);
      if (target.classList.contains("modal")) target.classList.add("hidden");
      else closePanel(target);
    });
  });
  el.overlay.addEventListener("click", closeAllPanels);

  el.themeSegmented.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-value]");
    if (!btn) return;
    settings.theme = btn.dataset.themeValue;
    saveSettings();
    applyTheme();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (settings.theme === "system") applyTheme();
  });

  el.settingHomepage.addEventListener("change", () => {
    const v = el.settingHomepage.value.trim() || "echo://home";
    settings.homepage = v === "echo://home" ? v : (looksLikeUrl(v) ? (/^https?:\/\//i.test(v) ? v : "https://" + v) : "echo://home");
    saveSettings();
    showToast("Homepage diperbarui.");
  });
  el.settingSearchEngine.addEventListener("change", () => {
    settings.searchEngine = el.settingSearchEngine.value;
    saveSettings();
    showToast("Mesin pencari diperbarui.");
  });
  el.settingNewtab.addEventListener("change", () => {
    settings.newTab = el.settingNewtab.value;
    saveSettings();
  });

  el.btnClearHistory.addEventListener("click", () => clearHistoryAll());
  el.btnClearHistory2.addEventListener("click", () => clearHistoryAll());
  el.btnClearBookmarks.addEventListener("click", () => {
    if (!confirm("Hapus semua bookmark? Tindakan ini tidak bisa dibatalkan.")) return;
    bookmarks = []; saveBookmarks(); renderBookmarksPanel(); syncChrome();
    showToast("Semua bookmark dihapus.");
  });
  el.btnClearAll.addEventListener("click", () => {
    if (!confirm("Hapus SELURUH data lokal Echo Browser (bookmark, riwayat, shortcut, pengaturan)? Tindakan ini tidak bisa dibatalkan.")) return;
    localStorage.removeItem(LS.SETTINGS);
    localStorage.removeItem(LS.BOOKMARKS);
    localStorage.removeItem(LS.HISTORY);
    localStorage.removeItem(LS.SHORTCUTS);
    settings = loadSettings();
    bookmarks = []; history = []; shortcuts = DEFAULT_SHORTCUTS.slice();
    populateSettingsForm();
    renderBookmarksPanel(); renderHistoryPanel();
    syncChrome();
    showToast("Seluruh data lokal telah dihapus.");
  });

  function clearHistoryAll() {
    if (!confirm("Hapus semua riwayat penjelajahan?")) return;
    history = []; saveHistory(); renderHistoryPanel();
    showToast("Riwayat dihapus.");
  }

  /* ---------------------------------------------------------
     17. KEYBOARD SHORTCUTS
     Catatan: Ctrl+T dan Ctrl+W adalah shortcut yang direservasi
     oleh sebagian besar browser desktop untuk alasan keamanan,
     sehingga tidak selalu bisa di-override lewat JavaScript.
     Kami tetap mendaftarkan handler-nya untuk browser/lingkungan
     yang mengizinkan (mis. saat embed sebagai app).
  --------------------------------------------------------- */
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "l") {
      e.preventDefault();
      el.addressInput.focus();
      el.addressInput.select();
    } else if (mod && e.key.toLowerCase() === "t") {
      e.preventDefault();
      createTab(null);
    } else if (mod && e.key.toLowerCase() === "w") {
      e.preventDefault();
      if (activeTabId) closeTab(activeTabId);
    } else if (mod && e.key.toLowerCase() === "r") {
      e.preventDefault();
      reload(activeTabId);
    } else if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      back(activeTabId);
    } else if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      forward(activeTabId);
    } else if (e.key === "Escape") {
      closeAllPanels();
    }
  });

  /* ---------------------------------------------------------
     18. INISIALISASI
  --------------------------------------------------------- */
  function init() {
    applyTheme();
    createTab(null); // tab pertama = beranda
    syncChrome();
  }

  init();
})();
