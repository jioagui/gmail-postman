function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderAccessDeniedHtml(appTitle: string, reason: string): string {
  const safeTitle = escapeHtml(appTitle);
  const safeReason = escapeHtml(reason);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>访问受限 · ${safeTitle}</title>
  <style>
    body {
      margin: 0; min-height: 100dvh; display: flex; align-items: center; justify-content: center;
      background: #0d1117; color: #e6edf3; padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
    }
    .box {
      max-width: 460px; width: 100%; background: #161b22; border: 1px solid #30363d;
      border-radius: 14px; padding: 28px;
    }
    h1 { font-size: 18px; margin: 0 0 10px; color: #f85149; }
    p { font-size: 14px; color: #8b949e; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="box">
    <h1>🛡️ Cloudflare Access 零信任拦截</h1>
    <p>${safeReason}</p>
  </div>
</body>
</html>`;
}

export function renderAppHtml(appTitle: string, scriptNonce = ""): string {
  const safeTitle = escapeHtml(appTitle);
  const nonceAttr = scriptNonce ? ` nonce="${escapeHtml(scriptNonce)}"` : "";

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#0d1117" />
  <title>${safeTitle}</title>
  <style>
    :root {
      --bg: #0d1117;
      --bg-elev: #161b22;
      --bg-glass: rgba(22, 27, 34, 0.88);
      --bg-hover: #1f2630;
      --border: #30363d;
      --text: #e6edf3;
      --muted: #8b949e;
      --accent: #3b82f6;
      --accent-soft: rgba(59, 130, 246, 0.14);
      --gmail: #ea4335;
      --danger: #f85149;
      --success: #3fb950;
      --warn: #d29922;
      --radius: 10px;
      --safe-top: env(safe-area-inset-top, 0px);
      --safe-bottom: env(safe-area-inset-bottom, 0px);
    }
    [data-theme="light"] {
      --bg: #f6f8fa;
      --bg-elev: #ffffff;
      --bg-glass: rgba(255, 255, 255, 0.9);
      --bg-hover: #eef2f6;
      --border: #d0d7de;
      --text: #1f2328;
      --muted: #656d76;
      --accent: #2563eb;
      --accent-soft: rgba(37, 99, 235, 0.1);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.5;
    }
    button, input, select, textarea { font: inherit; color: inherit; }
    button {
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--bg-elev);
      border-radius: 8px;
      padding: 7px 12px;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
    }
    button:hover { background: var(--bg-hover); }
    button.primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
      font-weight: 600;
    }
    button.primary:hover { filter: brightness(1.08); }
    button.danger { color: var(--danger); border-color: rgba(248, 81, 73, 0.4); }
    input, select, textarea {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      outline: none;
    }
    input:focus, select:focus, textarea:focus { border-color: var(--accent); }
    .auth-wrap {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .auth-card {
      width: 100%;
      max-width: 440px;
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 28px;
    }
    .auth-card h1 { font-size: 20px; margin-bottom: 6px; }
    .auth-card p { color: var(--muted); font-size: 13px; margin-bottom: 18px; }
    .field { margin-bottom: 14px; }
    .field label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
    .msg-err { color: var(--danger); font-size: 13px; margin-top: 8px; }
    .msg-ok { color: var(--success); font-size: 13px; margin-top: 8px; }

    /* ==================== Desktop Layout (> 960px, preserved intact) ==================== */
    .layout {
      display: grid;
      grid-template-columns: 240px 360px 1fr;
      height: 100vh;
    }
    .sidebar {
      border-right: 1px solid var(--border);
      background: var(--bg-elev);
      display: flex;
      flex-direction: column;
      padding: 14px;
      gap: 14px;
      overflow-y: auto;
    }
    .brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 700;
      font-size: 16px;
    }
    .drawer-close-btn { display: none; }
    .nav-group-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      margin-bottom: 6px;
      padding: 0 6px;
    }
    .nav-item {
      width: 100%;
      text-align: left;
      border: none;
      background: transparent;
      padding: 8px 10px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 14px;
    }
    .nav-item:hover { background: var(--bg-hover); }
    .nav-item.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
    .nav-item.reserved { opacity: 0.55; cursor: not-allowed; }
    .badge {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 999px;
      background: var(--bg-hover);
      color: var(--muted);
    }
    .badge.gmail { background: rgba(234, 67, 53, 0.16); color: #ff7b72; }
    .badge.verify { background: rgba(63, 185, 80, 0.18); color: var(--success); }
    .badge.alias { background: rgba(59, 130, 246, 0.15); color: var(--accent); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .nav-sub-item {
      padding-left: 24px;
      font-size: 13px;
      color: var(--muted);
    }
    .alias-gen-box {
      margin-top: 12px;
      padding: 12px;
      border-radius: 10px;
      border: 1px dashed var(--border);
      background: var(--bg);
    }
    .preset-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 8px 0;
    }
    .preset-chip {
      padding: 4px 10px;
      min-height: 28px;
      font-size: 12px;
      border-radius: 999px;
      background: var(--bg-elev);
    }
    .list-pane {
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .list-toolbar {
      padding: 12px;
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 8px;
      background: var(--bg-elev);
    }
    .list-toolbar button {
      white-space: nowrap;
      flex-shrink: 0;
    }
    .mail-list { flex: 1; overflow-y: auto; }
    .mail-item {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .mail-item:hover { background: var(--bg-hover); }
    .mail-item.active { background: var(--accent-soft); }
    .mail-item.unread .mail-subject { font-weight: 700; color: var(--text); }
    .mail-item-content { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
    .mail-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
    .mail-from { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
    .mail-subject { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    .mail-snippet { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .main-pane {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow-y: auto;
      padding: 20px;
    }
    .empty-state { margin: auto; text-align: center; color: var(--muted); max-width: 420px; }
    .card {
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      margin-bottom: 14px;
    }
    .card h2, .card h3 { font-size: 16px; margin-bottom: 10px; }
    .detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .detail-meta { font-size: 13px; color: var(--muted); display: grid; gap: 4px; margin-top: 8px; }
    .verify-banner {
      background: rgba(63, 185, 80, 0.12);
      border: 1px solid rgba(63, 185, 80, 0.45);
      border-radius: var(--radius);
      padding: 14px;
      margin-bottom: 14px;
    }
    .verify-code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 2px;
      margin: 8px 0;
    }
    .email-frame {
      width: 100%;
      min-height: 480px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #fff;
    }
    .email-text {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: inherit;
      font-size: 14px;
      padding: 14px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .att-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .att-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 12px;
      text-decoration: none;
      color: var(--text);
      background: var(--bg);
    }
    .att-chip:hover { border-color: var(--accent); }
    .row { display: flex; gap: 8px; align-items: center; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
    .muted { color: var(--muted); font-size: 13px; }
    .rule-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
    }
    .rule-row:last-child { border-bottom: none; }

    .mobile-detail-body {
      display: contents;
    }

    /* Mobile-only chrome hidden completely on desktop */
    .mobile-bar,
    .mobile-drawer-backdrop,
    .mobile-filter-pills,
    .mobile-back-bar,
    .mobile-bottom-nav,
    .mail-avatar,
    .mail-unread-dot {
      display: none;
    }

    /* Avatar palette for mobile cards */
    .av-0 { background: linear-gradient(135deg, #3b82f6, #1d4ed8); }
    .av-1 { background: linear-gradient(135deg, #ef4444, #b91c1c); }
    .av-2 { background: linear-gradient(135deg, #10b981, #047857); }
    .av-3 { background: linear-gradient(135deg, #f59e0b, #b45309); }
    .av-4 { background: linear-gradient(135deg, #8b5cf6, #6d28d9); }
    .av-5 { background: linear-gradient(135deg, #ec4899, #be185d); }

    /* ==================== Dedicated Mobile App UI (<= 960px) ==================== */
    @media (max-width: 960px) {
      body {
        min-height: 100dvh;
        overscroll-behavior-y: none;
      }
      input, select, textarea {
        font-size: 16px; /* Prevents iOS Safari auto-zoom on focus */
        padding: 10px 12px;
        border-radius: 10px;
      }
      button {
        min-height: 40px;
        border-radius: 10px;
        padding: 8px 14px;
      }
      button:active { transform: scale(0.97); }
      .auth-wrap {
        min-height: 100dvh;
        padding: calc(20px + var(--safe-top)) 16px calc(24px + var(--safe-bottom));
      }
      .auth-card {
        padding: 24px 20px;
        border-radius: 18px;
      }

      /* App Shell: full dynamic viewport height, single active view */
      .layout {
        display: flex;
        flex-direction: column;
        height: 100dvh;
        min-height: 100dvh;
        overflow: hidden;
      }

      /* Sticky Glass Top Header */
      .mobile-bar {
        display: flex;
        position: sticky;
        top: 0;
        z-index: 30;
        padding: calc(10px + var(--safe-top)) 14px 10px;
        background: var(--bg-glass);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border-bottom: 1px solid var(--border);
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-shrink: 0;
      }
      .layout[data-view="inbox"][data-mobile-screen="detail"] .mobile-bar {
        display: none;
      }
      .mobile-bar-left {
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
      }
      .mobile-title-wrap {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .mobile-title {
        font-size: 16px;
        font-weight: 700;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .mobile-subtitle {
        font-size: 11px;
        color: var(--muted);
        line-height: 1.25;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .icon-btn {
        min-width: 38px;
        min-height: 38px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        font-size: 16px;
        background: var(--bg);
        border: 1px solid var(--border);
        flex-shrink: 0;
      }

      /* Slide-Over Navigation Drawer + Blurred Backdrop */
      .mobile-drawer-backdrop {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.56);
        backdrop-filter: blur(3px);
        -webkit-backdrop-filter: blur(3px);
        z-index: 50;
      }
      .mobile-drawer-backdrop.open { display: block; }
      .sidebar {
        display: flex;
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        width: min(82vw, 300px);
        z-index: 60;
        padding: calc(16px + var(--safe-top)) 16px calc(20px + var(--safe-bottom));
        border-right: 1px solid var(--border);
        box-shadow: 12px 0 32px rgba(0, 0, 0, 0.35);
        transform: translateX(-105%);
        transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .sidebar.open { transform: translateX(0); }
      .drawer-close-btn {
        display: inline-flex;
        min-width: 34px;
        min-height: 34px;
        padding: 0;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
      }
      .sidebar .brand button[data-action="toggle-theme"] { display: none; }
      .sidebar .nav-item {
        padding: 11px 12px;
        font-size: 15px;
        border-radius: 10px;
      }

      /* Single-Pane Visibility Rules */
      .list-pane {
        border-right: none;
        flex: 1;
        min-height: 0;
        background: var(--bg);
      }
      .main-pane {
        flex: 1;
        min-height: 0;
        padding: 14px 14px calc(82px + var(--safe-bottom));
        -webkit-overflow-scrolling: touch;
      }
      .layout[data-view="inbox"][data-mobile-screen="list"] .main-pane { display: none; }
      .layout[data-view="inbox"][data-mobile-screen="detail"] .list-pane { display: none; }
      .layout[data-view="inbox"][data-mobile-screen="detail"] .main-pane {
        padding: 0 0 calc(20px + var(--safe-bottom));
      }
      .layout:not([data-view="inbox"]) .list-pane { display: none; }

      /* Mobile Search & Filter Pills */
      .list-toolbar {
        padding: 10px 14px 8px;
        border-bottom: none;
        background: var(--bg);
        gap: 8px;
      }
      .list-toolbar input {
        border-radius: 999px;
        padding: 9px 14px;
        background: var(--bg-elev);
        font-size: 15px;
      }
      .list-toolbar button {
        border-radius: 999px;
        padding: 0 14px;
        white-space: nowrap;
        font-size: 13px;
      }
      .mobile-filter-pills {
        display: flex;
        gap: 8px;
        padding: 2px 14px 10px;
        overflow-x: auto;
        scrollbar-width: none;
        border-bottom: 1px solid var(--border);
        background: var(--bg);
        flex-shrink: 0;
      }
      .mobile-filter-pills::-webkit-scrollbar { display: none; }
      .filter-pill {
        min-height: 32px;
        padding: 5px 12px;
        border-radius: 999px;
        font-size: 13px;
        white-space: nowrap;
        background: var(--bg-elev);
        border: 1px solid var(--border);
        color: var(--muted);
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .filter-pill.active {
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
        font-weight: 600;
      }

      /* Native-Style Mobile Mail List Cards */
      .mail-list {
        padding: 8px 12px calc(84px + var(--safe-bottom));
        display: flex;
        flex-direction: column;
        gap: 8px;
        -webkit-overflow-scrolling: touch;
      }
      .mail-item {
        flex-direction: row;
        align-items: flex-start;
        gap: 12px;
        padding: 13px 14px;
        border: 1px solid var(--border);
        border-radius: 14px;
        background: var(--bg-elev);
        position: relative;
      }
      .mail-item:active { background: var(--bg-hover); }
      .mail-item.unread {
        border-color: rgba(59, 130, 246, 0.45);
      }
      .mail-avatar {
        display: flex;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-weight: 700;
        font-size: 15px;
        flex-shrink: 0;
        margin-top: 2px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
      }
      .mail-unread-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--accent);
        flex-shrink: 0;
      }
      .mail-top { font-size: 13px; }
      .mail-from {
        max-width: none;
        flex: 1;
        font-weight: 600;
        color: var(--text);
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .mail-item:not(.unread) .mail-from { font-weight: 500; color: var(--muted); }
      .mail-subject {
        font-size: 15px;
        line-height: 1.35;
        white-space: nowrap;
      }
      .mail-snippet {
        font-size: 13px;
        line-height: 1.4;
        white-space: normal;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      /* Mobile Email Detail Sticky Back Header */
      .mobile-back-bar {
        display: flex;
        position: sticky;
        top: 0;
        z-index: 30;
        padding: calc(10px + var(--safe-top)) 12px 10px;
        background: var(--bg-glass);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        border-bottom: 1px solid var(--border);
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .mobile-back-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 12px;
        font-weight: 600;
        font-size: 14px;
        background: var(--bg);
      }
      .mobile-detail-quick {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .mobile-detail-body {
        padding: 12px 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        flex: 1;
      }
      .layout[data-view="inbox"][data-mobile-screen="detail"] .detail-actions-desktop {
        display: none;
      }
      .detail-sub-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .detail-sub-actions button {
        font-size: 13px;
        min-height: 36px;
        padding: 6px 12px;
      }
      .card {
        border-radius: 14px;
        padding: 14px;
        margin-bottom: 12px;
      }
      .card h2 { font-size: 16px; line-height: 1.35; }
      .detail-meta { font-size: 12.5px; word-break: break-all; }
      .att-chip {
        padding: 9px 12px;
        border-radius: 10px;
        font-size: 13px;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .email-frame {
        min-height: 58dvh;
        border-radius: 12px;
      }
      .email-text {
        font-size: 15px;
        line-height: 1.65;
        border-radius: 12px;
        padding: 14px;
      }

      /* Mobile Form & Rules Stacking */
      .grid-2 { grid-template-columns: 1fr; }
      .rule-row {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        padding: 12px 0;
      }
      .rule-row > .row {
        justify-content: flex-end;
        flex-wrap: wrap;
      }
      .card .row {
        flex-wrap: wrap;
      }
      .card .row > input {
        flex: 1 1 200px;
      }
      .verify-banner .row {
        flex-direction: column;
        align-items: stretch;
      }
      .verify-banner a,
      .verify-banner button {
        width: 100%;
        text-align: center;
      }

      /* Sticky Native Bottom Tab Bar */
      .mobile-bottom-nav {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 35;
        background: var(--bg-glass);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-top: 1px solid var(--border);
        padding: 6px 8px calc(8px + var(--safe-bottom));
        gap: 4px;
      }
      .layout[data-view="inbox"][data-mobile-screen="detail"] .mobile-bottom-nav {
        display: none;
      }
      .tab-btn {
        border: none;
        background: transparent;
        min-height: 48px;
        padding: 4px 2px;
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        color: var(--muted);
        position: relative;
      }
      .tab-btn:hover { background: transparent; }
      .tab-btn.active {
        color: var(--accent);
        background: var(--accent-soft);
        font-weight: 600;
      }
      .tab-icon { font-size: 18px; line-height: 1.1; }
      .tab-label { font-size: 11px; line-height: 1.1; }
      .tab-badge {
        position: absolute;
        top: 3px;
        right: calc(50% - 22px);
        min-width: 17px;
        height: 17px;
        padding: 0 5px;
        border-radius: 999px;
        background: var(--gmail);
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <script${nonceAttr}>
    const state = {
      status: null,
      view: "inbox",
      filter: "all",
      providerFilter: "gmail",
      aliasFilter: "all",
      search: "",
      emails: [],
      total: 0,
      unreadCount: 0,
      selectedId: null,
      detail: null,
      bodyMode: "html",
      allowRemoteImages: false,
      providers: [],
      aliases: [],
      aliasDraftTag: "work",
      blockRules: [],
      forwardRules: [],
      settings: null,
      mobileNavOpen: false,
      mobileScreen: "list" // "list" | "detail" (used on <= 960px)
    };

    const $ = (sel) => document.querySelector(sel);
    const esc = (s) => String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

    function isMobileViewport() {
      return window.matchMedia && window.matchMedia("(max-width: 960px)").matches;
    }

    async function api(path, opts = {}) {
      const headers = { "X-Requested-With": "GmailAssistant", ...(opts.headers || {}) };
      if (opts.body && !(opts.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
      }
      const res = await fetch(path, { ...opts, headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "请求失败 (" + res.status + ")");
      }
      return data;
    }

    function fmtTime(ts) {
      if (!ts) return "";
      const d = new Date(ts);
      const pad = (n) => String(n).padStart(2, "0");
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }

    function fmtShortTime(ts) {
      if (!ts) return "";
      const d = new Date(ts);
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
        return pad(d.getHours()) + ":" + pad(d.getMinutes());
      }
      return pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }

    function fmtBytes(bytes) {
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    }

    function getAvatarMeta(nameOrEmail) {
      const text = String(nameOrEmail || "?").trim();
      const ch = Array.from(text.replace(/^["'<]+/, ""))[0] || "?";
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
      }
      return {
        letter: ch.toUpperCase(),
        colorClass: "av-" + (hash % 6)
      };
    }

    function getAliasBadgeText(accountAlias) {
      const key = String(accountAlias || "").toLowerCase();
      if (!key || key === "gmail") return "";
      const found = (state.aliases || []).find((a) => a.alias === key);
      if (found && found.label && found.label !== "默认 Gmail") return found.label;
      const plusIdx = key.indexOf("+");
      if (plusIdx >= 0 && plusIdx < key.length - 1) return "+" + key.slice(plusIdx + 1);
      return key;
    }

    function sanitizeCustomPrefix(raw) {
      return String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, "")
        .slice(0, 64);
    }

    function buildCustomForwardAddress(domain, prefix) {
      const clean = sanitizeCustomPrefix(prefix);
      const d = String(domain || "example.com").trim().toLowerCase();
      return (clean || "your-prefix") + "@" + d;
    }

    function getMobileViewTitle() {
      if (state.view === "providers") return "Gmail 转发配置";
      if (state.view === "rules") return "拦截与推送规则";
      if (state.view === "settings") return "设置与清理";
      if (state.aliasFilter !== "all") {
        const found = (state.aliases || []).find((a) => a.alias === state.aliasFilter);
        return found ? (found.label || found.prefix) : state.aliasFilter;
      }
      return state.status?.appTitle || "Gmail 助手";
    }

    function syncThemeColor(theme) {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", theme === "light" ? "#f6f8fa" : "#0d1117");
    }

    function toggleTheme() {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("gmail_postman_theme", next);
      syncThemeColor(next);
    }

    function buildSafeSrcdoc(rawHtml, allowRemote) {
      const csp = allowRemote
        ? "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:;"
        : "default-src 'none'; style-src 'unsafe-inline'; img-src data:;";
      const responsiveHead =
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
        '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' +
        '<style>html,body{margin:0;padding:12px;max-width:100%!important;overflow-x:auto;word-break:break-word;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC",sans-serif;font-size:15px;line-height:1.6;color:#1f2328;}img,table,pre,blockquote{max-width:100%!important;height:auto!important;box-sizing:border-box;}</style>';
      return responsiveHead + rawHtml;
    }

    const savedTheme = localStorage.getItem("gmail_postman_theme");
    if (savedTheme) {
      document.documentElement.setAttribute("data-theme", savedTheme);
      syncThemeColor(savedTheme);
    }

    // Support native browser swipe-back on mobile email detail screen
    window.addEventListener("popstate", () => {
      if (state.view === "inbox" && state.mobileScreen === "detail") {
        state.mobileScreen = "list";
        renderApp();
      }
    });

    async function bootstrap() {
      state.status = await api("/api/status");
      if (!state.status.installed) {
        renderSetup();
        return;
      }
      if (!state.status.authenticated) {
        renderLogin();
        return;
      }
      await loadWorkspaceData();
      renderApp();
    }

    function renderSetup() {
      $("#app").innerHTML = \`
        <div class="auth-wrap">
          <div class="auth-card">
            <h1>📬 初始化 \${esc(state.status.appTitle)}</h1>
            <p>首次访问请设置管理员密码（使用 PBKDF2-SHA256 加密存储，设置后初始化入口自动锁定）。</p>
            <div class="field">
              <label>管理员密码（至少 8 位）</label>
              <input id="setup-pw" type="password" placeholder="输入强密码" autocomplete="new-password" />
            </div>
            <div class="field">
              <label>确认密码</label>
              <input id="setup-pw2" type="password" placeholder="再次输入密码" autocomplete="new-password" />
            </div>
            <div class="field">
              <label>你的 Gmail 地址（可选，仅用于界面展示备注）</label>
              <input id="setup-gmail" type="email" placeholder="example@gmail.com" />
            </div>
            <button class="primary" style="width:100%" id="setup-btn">完成初始化并进入收件箱</button>
            <div id="auth-msg"></div>
          </div>
        </div>\`;
      $("#setup-btn").addEventListener("click", async () => {
        const pw = $("#setup-pw").value;
        const pw2 = $("#setup-pw2").value;
        const gmailSourceEmail = $("#setup-gmail").value.trim();
        if (pw.length < 8) { $("#auth-msg").innerHTML = '<div class="msg-err">密码长度至少 8 位</div>'; return; }
        if (pw !== pw2) { $("#auth-msg").innerHTML = '<div class="msg-err">两次密码输入不一致</div>'; return; }
        try {
          await api("/api/setup", { method: "POST", body: JSON.stringify({ password: pw, gmailSourceEmail }) });
          await bootstrap();
        } catch (e) {
          $("#auth-msg").innerHTML = '<div class="msg-err">' + esc(e.message) + '</div>';
        }
      });
    }

    function renderLogin() {
      $("#app").innerHTML = \`
        <div class="auth-wrap">
          <div class="auth-card">
            <h1>🔒 登录 \${esc(state.status.appTitle)}</h1>
            <p>已开启 D1 限速防爆破与 HttpOnly 签名会话保护。</p>
            <div class="field">
              <label>管理员密码</label>
              <input id="login-pw" type="password" placeholder="输入管理员密码" autocomplete="current-password" />
            </div>
            <button class="primary" style="width:100%" id="login-btn">登录</button>
            <div id="auth-msg"></div>
          </div>
        </div>\`;
      const doLogin = async () => {
        try {
          await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("#login-pw").value }) });
          await bootstrap();
        } catch (e) {
          $("#auth-msg").innerHTML = '<div class="msg-err">' + esc(e.message) + '</div>';
        }
      };
      $("#login-btn").addEventListener("click", doLogin);
      $("#login-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
    }

    async function loadWorkspaceData() {
      const [provRes, mailRes] = await Promise.all([
        api("/api/providers"),
        api("/api/emails?" + new URLSearchParams({
          provider: state.providerFilter,
          alias: state.aliasFilter,
          filter: state.filter,
          q: state.search
        }))
      ]);
      state.providers = provRes.providers;
      state.aliases = provRes.aliases || [];
      state.emails = mailRes.emails;
      state.total = mailRes.total;
      state.unreadCount = mailRes.unreadCount;
    }

    async function openEmail(id) {
      const wasList = state.mobileScreen !== "detail";
      state.selectedId = id;
      state.view = "inbox";
      state.mobileScreen = "detail";
      state.mobileNavOpen = false;
      state.allowRemoteImages = false;
      if (isMobileViewport() && wasList) {
        try {
          window.history.pushState({ mobileDetail: id }, "");
        } catch {}
      }
      state.detail = await api("/api/emails/" + encodeURIComponent(id));
      if (state.detail.email && !state.detail.email.is_read) {
        api("/api/emails/" + encodeURIComponent(id) + "/mark", {
          method: "PATCH",
          body: JSON.stringify({ is_read: 1 })
        }).catch(() => {});
        state.detail.email.is_read = 1;
        const item = state.emails.find((m) => m.id === id);
        if (item && !item.is_read) {
          item.is_read = 1;
          state.unreadCount = Math.max(0, state.unreadCount - 1);
        }
      }
      state.bodyMode = state.detail.email.html_body ? "html" : "text";
      renderApp();
      const pane = $(".main-pane");
      if (pane) pane.scrollTop = 0;
    }

    async function openView(view) {
      state.view = view;
      state.mobileNavOpen = false;
      if (view === "inbox") {
        state.mobileScreen = "list";
        await loadWorkspaceData();
      } else if (view === "rules") {
        const [b, f] = await Promise.all([api("/api/rules/block"), api("/api/rules/forward")]);
        state.blockRules = b.rules;
        state.forwardRules = f.rules;
      } else if (view === "settings") {
        state.settings = await api("/api/settings");
      } else if (view === "providers") {
        const p = await api("/api/providers");
        state.providers = p.providers;
        state.aliases = p.aliases || [];
      }
      renderApp();
    }

    function renderForwardFields() {
      const el = $("#fw-fields");
      const type = $("#fw-type")?.value;
      if (!el) return;
      if (type === "wecom") {
        el.innerHTML = '<input id="fw-wecom-url" placeholder="企业微信 Webhook 地址或直接填 key (https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...)" style="grid-column:1 / -1" />';
      } else if (type === "ntfy") {
        el.innerHTML = \`
          <input id="fw-ntfy-topic" placeholder="Topic 名称（建议随机长字符串防猜测，如 gmail-9x7k2p）" />
          <input id="fw-ntfy-server" value="https://ntfy.sh" placeholder="服务器地址（默认 https://ntfy.sh，支持自建）" />
          <input id="fw-ntfy-token" placeholder="可选：Access Token (tk_...，私有 Topic 鉴权用)" />
          <select id="fw-ntfy-priority">
            <option value="3">默认优先级 (3 - Default)</option>
            <option value="4">高优先级 (4 - High)</option>
            <option value="5">紧急弹窗 (5 - Urgent)</option>
            <option value="2">低优先级 (2 - Low)</option>
          </select>\`;
      } else if (type === "serverchan") {
        el.innerHTML = '<input id="fw-sc-key" placeholder="Server酱 SendKey (SCT...)" /><div></div>';
      } else {
        el.innerHTML = '<input id="fw-wh-url" placeholder="Webhook URL (仅限 https://...)" /><input id="fw-wh-secret" placeholder="可选：X-Webhook-Secret 请求头密钥" />';
      }
    }

    function renderMainContent() {
      if (state.view === "providers") {
        const mailDomain = state.status?.mailDomain || "example.com";
        const previewAddr = buildCustomForwardAddress(mailDomain, state.aliasDraftTag);
        const configuredAliases = (state.aliases || []).filter((a) => a.id);
        return \`
          <div class="card">
            <h2>📮 自定义前缀转发地址（多 Gmail 独立前缀）</h2>
            <p class="muted" style="margin-bottom:12px">你可以为每个 Gmail 账号创建独立的自定义前缀（如 <span class="mono">work@\${esc(mailDomain)}</span>、<span class="mono">main@\${esc(mailDomain)}</span>），添加后即刻生效，无需额外配置 Cloudflare 路由；未添加的前缀会自动拒收防垃圾邮件。</p>

            <div class="alias-gen-box" style="margin-top:0;margin-bottom:14px">
              <div style="font-size:14px;font-weight:600;margin-bottom:6px">➕ 新增自定义前缀转发地址</div>
              <div class="preset-row">
                <button class="preset-chip" data-action="pick-alias-tag" data-tag="main">main (主号)</button>
                <button class="preset-chip" data-action="pick-alias-tag" data-tag="work">work (工作)</button>
                <button class="preset-chip" data-action="pick-alias-tag" data-tag="sub">sub (小号)</button>
                <button class="preset-chip" data-action="pick-alias-tag" data-tag="bank">bank (账单)</button>
              </div>
              <div class="grid-2" style="margin-bottom:8px">
                <input id="alias-prefix-input" class="mono" value="\${esc(state.aliasDraftTag)}" placeholder="自定义前缀（仅英文/数字/._-，如 work）" />
                <input id="alias-preview-addr" class="mono" readonly value="\${esc(previewAddr)}" />
              </div>
              <div class="grid-2" style="margin-bottom:10px">
                <input id="alias-label-input" placeholder="可选：显示名称（如 工作 Gmail，推送标题也会显示）" />
                <input id="alias-source-input" type="email" placeholder="可选：对应源 Gmail 备注（如 work@gmail.com）" />
              </div>
              <button id="add-alias-btn" class="primary">添加自定义转发地址</button>
              <div id="alias-msg"></div>
            </div>

            <h3 style="margin-bottom:8px">已启用的 Gmail 转发地址（\${configuredAliases.length} 个）</h3>
            \${configuredAliases.length === 0 ? '<div class="muted">暂无自定义前缀</div>' : configuredAliases.map((a) => \`
              <div class="rule-row">
                <div style="min-width:0">
                  <div class="row" style="flex-wrap:wrap;gap:6px">
                    <strong class="mono">\${esc(a.forwardAddress)}</strong>
                    \${a.isDefault ? '<span class="badge gmail">默认</span>' : '<span class="badge alias">' + esc(a.label || a.prefix) + '</span>'}
                    <span class="badge">\${a.total} 封</span>
                  </div>
                  \${a.source_email ? '<div class="muted" style="margin-top:2px">源邮箱：' + esc(a.source_email) + '</div>' : ''}
                </div>
                <div class="row">
                  <button data-action="copy-text" data-copy="\${esc(a.forwardAddress)}">复制地址</button>
                  <button data-action="toggle-alias" data-id="\${esc(a.id)}" data-enabled="\${a.enabled ? 0 : 1}">\${a.enabled ? '已启用' : '已停用'}</button>
                  \${a.isDefault ? '' : \`<button class="danger" data-action="del-alias" data-id="\${esc(a.id)}">删除</button>\`}
                </div>
              </div>
            \`).join("")}
          </div>

          <div class="card">
            <h2>📋 邮箱渠道与配置步骤（其他邮箱已预留）</h2>
            \${state.providers.map((p) => \`
              <div class="card" style="margin-bottom:10px;opacity:\${p.enabled ? 1 : 0.65}">
                <div class="row" style="justify-content:space-between;margin-bottom:6px">
                  <strong>\${esc(p.name)}</strong>
                  <span class="badge \${p.enabled ? 'gmail' : ''}">\${p.enabled ? '已启用' : '预留（未启用）'}</span>
                </div>
                <div class="muted" style="margin-bottom:8px">\${esc(p.description)}</div>
                <ol style="padding-left:18px;font-size:13px;color:var(--muted)">
                  \${p.setupSteps.map((s) => '<li style="margin-bottom:4px">' + esc(s) + '</li>').join("")}
                </ol>
              </div>
            \`).join("")}
          </div>\`;
      }

      if (state.view === "rules") {
        return \`
          <div class="card">
            <h2>🔍 关键词拦截规则（命中后不入库、不推送；已验签的 Gmail 转发确认邮件自动豁免）</h2>
            <div class="row" style="margin-bottom:12px">
              <input id="new-block-kw" placeholder="输入拦截关键词，例如：退订 / unsubscribe / 广告" />
              <button class="primary" id="add-block-btn" style="white-space:nowrap">添加拦截</button>
            </div>
            \${state.blockRules.length === 0 ? '<div class="muted">暂无拦截规则</div>' : state.blockRules.map((r) => \`
              <div class="rule-row">
                <div><strong>\${esc(r.keyword)}</strong> <span class="badge">\${esc(r.provider)}</span></div>
                <div class="row">
                  <button data-action="toggle-block" data-id="\${esc(r.id)}" data-enabled="\${r.enabled ? 0 : 1}">\${r.enabled ? '已启用' : '已停用'}</button>
                  <button class="danger" data-action="del-block" data-id="\${esc(r.id)}">删除</button>
                </div>
              </div>
            \`).join("")}
          </div>

          <div class="card">
            <h2>🔀 实时推送规则（企业微信 / ntfy / Server酱 / Webhook）</h2>
            <div class="grid-2" style="margin-bottom:10px">
              <input id="fw-name" placeholder="规则名称（如 企业微信 / 我的手机 ntfy）" />
              <select id="fw-type">
                <option value="wecom">企业微信群机器人</option>
                <option value="ntfy">ntfy 手机推送</option>
                <option value="serverchan">Server酱 (Turbo)</option>
                <option value="webhook">自定义 Webhook (HTTPS JSON)</option>
              </select>
            </div>
            <div id="fw-fields" class="grid-2" style="margin-bottom:10px"></div>
            <div class="row" style="margin-bottom:12px">
              <input id="fw-kw" placeholder="可选：仅推送包含这些关键词的邮件（逗号分隔，留空推送全部）" />
              <button class="primary" id="add-fw-btn" style="white-space:nowrap">保存推送规则</button>
            </div>
            <div id="fw-msg"></div>
            \${state.forwardRules.length === 0 ? '<div class="muted">暂无推送规则</div>' : state.forwardRules.map((r) => \`
              <div class="rule-row">
                <div>
                  <strong>\${esc(r.name)}</strong>
                  <span class="badge">\${esc(r.type)}</span>
                  <div class="muted">\${esc(r.configSummary)} \${r.keyword_filter ? '· 过滤: ' + esc(r.keyword_filter) : ''}</div>
                </div>
                <div class="row">
                  <button data-action="test-forward" data-id="\${esc(r.id)}">测试推送</button>
                  <button data-action="toggle-forward" data-id="\${esc(r.id)}" data-enabled="\${r.enabled ? 0 : 1}">\${r.enabled ? '已启用' : '已停用'}</button>
                  <button class="danger" data-action="del-forward" data-id="\${esc(r.id)}">删除</button>
                </div>
              </div>
            \`).join("")}
          </div>\`;
      }

      if (state.view === "settings" && state.settings) {
        return \`
          <div class="card">
            <h2>⚙️ 系统设置与自动清理</h2>
            <div class="field">
              <label>当前认证安全模式</label>
              <div class="muted">\${state.settings.auth_mode === 'access'
                ? '🛡️ Cloudflare Access 零信任模式（已验证身份：' + esc(state.settings.access_user) + '，公网密码与初始化入口已关闭）'
                : state.settings.auth_mode === 'access+password'
                  ? '🛡️🔑 Cloudflare Access + 本地密码双重认证（Access 身份：' + esc(state.settings.access_user) + '）'
                  : '🧪 本地密码开发模式（仅限本地 wrangler dev；线上默认强制启用 Cloudflare Access）'}</div>
            </div>
            <div class="field">
              <label>当前附件存储引擎</label>
              <div class="muted">\${state.settings.r2_enabled ? '✅ Cloudflare R2 已启用（最大 10 MB / 附件）' : '💾 纯 D1 模式（免绑卡免费版，单附件 ≤ 1 MB；后续开通 R2 在 wrangler.jsonc 取消注释即可自动升级）'}</div>
            </div>
            <div class="field">
              <label>Gmail 源邮箱备注</label>
              <input id="set-gmail" value="\${esc(state.settings.gmail_source_email || '')}" placeholder="yourname@gmail.com" />
            </div>
            <div class="field">
              <label>自动清理天数（0 = 不自动清理；星标邮件受保护不会被自动清理）</label>
              <input id="set-days" type="number" min="0" max="3650" value="\${esc(state.settings.auto_delete_days)}" />
            </div>
            <div class="row" style="margin-bottom:14px">
              <button class="primary" id="save-settings-btn">保存设置</button>
              <button id="run-cleanup-btn">立即执行一次清理</button>
            </div>
            \${state.settings.auth_mode !== 'access' ? \`
              <hr style="border:none;border-top:1px solid var(--border);margin:14px 0" />
              <h3>🔑 修改管理员密码</h3>
              <div class="grid-2" style="margin-bottom:10px">
                <input id="set-old-pw" type="password" placeholder="当前密码" />
                <input id="set-new-pw" type="password" placeholder="新密码（至少 8 位）" />
              </div>
              <button id="save-pw-btn">更新密码</button>
            \` : ''}
            <div id="set-msg"></div>
          </div>\`;
      }

      if (!state.detail) {
        return \`
          <div class="empty-state">
            <h2 style="margin-bottom:8px">📬 Gmail 实时收件箱</h2>
            <p class="muted" style="margin-bottom:12px">选择左侧邮件查看正文与附件，或前往「Gmail 转发配置」查看专属转发地址：</p>
            <div class="card mono">\${esc(state.status.gmailForwardAddress)}</div>
          </div>\`;
      }

      const m = state.detail.email;
      const atts = state.detail.attachments || [];
      const safeVerifyUrl = /^https:\\/\\//i.test(m.verification_url || "") ? m.verification_url : "";
      const hasSubControls = (m.html_body && m.text_body) || (state.bodyMode === "html" && m.html_body && !state.allowRemoteImages);
      return \`
        <div class="mobile-back-bar">
          <button class="mobile-back-btn" data-action="mobile-back">← 返回</button>
          <div class="mobile-detail-quick">
            <button class="icon-btn" title="星标" data-action="mark-email" data-id="\${esc(m.id)}" data-field="is_starred" data-value="\${m.is_starred ? 0 : 1}">\${m.is_starred ? '⭐' : '☆'}</button>
            <button class="icon-btn" title="重要" data-action="mark-email" data-id="\${esc(m.id)}" data-field="is_important" data-value="\${m.is_important ? 0 : 1}">\${m.is_important ? '🔥' : '🏷️'}</button>
            <button class="icon-btn" title="\${m.is_read ? '标为未读' : '标为已读'}" data-action="mark-email" data-id="\${esc(m.id)}" data-field="is_read" data-value="\${m.is_read ? 0 : 1}">\${m.is_read ? '📩' : '✅'}</button>
            <button class="icon-btn danger" title="删除" data-action="delete-email" data-id="\${esc(m.id)}">🗑️</button>
          </div>
        </div>

        <div class="mobile-detail-body">
          <div class="detail-actions detail-actions-desktop">
            <button data-action="mark-email" data-id="\${esc(m.id)}" data-field="is_starred" data-value="\${m.is_starred ? 0 : 1}">\${m.is_starred ? '⭐ 已星标' : '☆ 星标'}</button>
            <button data-action="mark-email" data-id="\${esc(m.id)}" data-field="is_important" data-value="\${m.is_important ? 0 : 1}">\${m.is_important ? '🔥 重要' : '标记重要'}</button>
            <button data-action="mark-email" data-id="\${esc(m.id)}" data-field="is_read" data-value="\${m.is_read ? 0 : 1}">\${m.is_read ? '标为未读' : '标为已读'}</button>
            \${m.html_body && m.text_body ? \`<button data-action="switch-body-mode">\${state.bodyMode === 'html' ? '切换纯文本' : '切换 HTML'}</button>\` : ''}
            \${state.bodyMode === 'html' && m.html_body && !state.allowRemoteImages ? '<button data-action="allow-remote-images">🖼️ 加载远程图片</button>' : ''}
            <button class="danger" data-action="delete-email" data-id="\${esc(m.id)}">🗑️ 删除</button>
          </div>

          \${m.is_verification ? \`
            <div class="verify-banner">
              <strong>🔐 检测到已验签的 Gmail 自动转发确认邮件</strong>
              \${m.verification_code ? \`<div class="verify-code">确认码：\${esc(m.verification_code)}</div>\` : ''}
              <div class="row">
                \${m.verification_code ? \`<button data-action="copy-text" data-copy="\${esc(m.verification_code)}">复制确认码</button>\` : ''}
                \${safeVerifyUrl ? \`<a href="\${esc(safeVerifyUrl)}" target="_blank" rel="noopener noreferrer"><button class="primary" type="button">打开 Gmail 确认链接</button></a>\` : ''}
              </div>
            </div>
          \` : ''}

          <div class="card">
            <div class="row" style="justify-content:space-between;flex-wrap:wrap">
              <h2>\${esc(m.subject)}</h2>
              <span class="badge gmail">\${esc(m.provider.toUpperCase())} · \${esc(m.account_alias)}</span>
            </div>
            <div class="detail-meta">
              <div>发件人：\${esc(m.from_name ? m.from_name + ' <' + m.from_address + '>' : m.from_address)}</div>
              <div>收件人：\${esc(m.to_address)}</div>
              <div>时间：\${fmtTime(m.received_at)} · 大小：\${fmtBytes(m.raw_size)}</div>
            </div>
            \${atts.length > 0 ? \`
              <div class="att-list">
                \${atts.map((a) => a.storage === 'skipped_too_large'
                  ? \`<span class="att-chip" title="超过纯 D1 限制">📎 \${esc(a.filename)} (\${fmtBytes(a.size)} · 需开通 R2)</span>\`
                  : \`<a class="att-chip" href="/api/attachments/\${encodeURIComponent(a.id)}/download">📎 \${esc(a.filename)} (\${fmtBytes(a.size)})</a>\`
                ).join("")}
              </div>
            \` : ''}
          </div>

          \${hasSubControls && isMobileViewport() ? \`
            <div class="detail-sub-actions">
              \${m.html_body && m.text_body ? \`<button data-action="switch-body-mode">\${state.bodyMode === 'html' ? '📄 切换纯文本' : '🌐 切换 HTML'}</button>\` : ''}
              \${state.bodyMode === 'html' && m.html_body && !state.allowRemoteImages ? '<button data-action="allow-remote-images">🖼️ 加载远程图片</button>' : ''}
            </div>
          \` : ''}

          \${state.bodyMode === "html" && m.html_body
            ? \`<iframe class="email-frame" sandbox="" referrerpolicy="no-referrer" srcdoc="\${esc(buildSafeSrcdoc(m.html_body, state.allowRemoteImages))}"></iframe>\`
            : \`<div class="email-text">\${esc(m.text_body || m.snippet || '(空邮件)')}</div>\`
          }
        </div>
      \`;
    }

    function renderApp() {
      const gmailAliases = (state.aliases || []).filter((a) => a.provider === "gmail");
      const mobileSub = state.status.accessUser
        ? "🛡️ " + state.status.accessUser
        : (state.unreadCount > 0 ? state.unreadCount + " 封未读" : "Gmail 实时聚合");

      $("#app").innerHTML = \`
        <div class="layout" data-view="\${esc(state.view)}" data-mobile-screen="\${esc(state.mobileScreen)}">
          <header class="mobile-bar">
            <div class="mobile-bar-left">
              <button class="icon-btn" data-action="toggle-mobile-nav" aria-label="打开菜单">☰</button>
              <div class="mobile-title-wrap">
                <span class="mobile-title">📬 \${esc(getMobileViewTitle())}</span>
                <span class="mobile-subtitle">\${esc(mobileSub)}</span>
              </div>
            </div>
            <div class="row">
              \${state.view === "inbox" ? '<button class="icon-btn" data-action="mobile-refresh" aria-label="刷新">↻</button>' : ''}
              <button class="icon-btn" data-action="toggle-theme" aria-label="切换主题">🌓</button>
            </div>
          </header>

          <div class="mobile-drawer-backdrop \${state.mobileNavOpen ? 'open' : ''}" data-action="close-mobile-nav"></div>

          <aside class="sidebar \${state.mobileNavOpen ? 'open' : ''}">
            <div class="brand">
              <span>📬 Gmail 助手</span>
              <div class="row">
                <button data-action="toggle-theme" title="切换暗色/亮色模式">🌓</button>
                <button class="drawer-close-btn" data-action="close-mobile-nav" aria-label="关闭菜单">✕</button>
              </div>
            </div>
            \${state.status.accessUser ? \`<div class="badge verify" style="text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="Cloudflare Access 零信任已认证">🛡️ \${esc(state.status.accessUser)}</div>\` : ''}

            <div>
              <div class="nav-group-title">Gmail 收件箱</div>
              <button class="nav-item \${state.view==='inbox' && state.filter==='all' ? 'active' : ''}" data-action="set-filter" data-filter="all"><span>📥 全部邮件</span><span class="badge">\${state.total}</span></button>
              <button class="nav-item \${state.view==='inbox' && state.filter==='unread' ? 'active' : ''}" data-action="set-filter" data-filter="unread"><span>🔵 未读邮件</span><span class="badge">\${state.unreadCount}</span></button>
              <button class="nav-item \${state.view==='inbox' && state.filter==='starred' ? 'active' : ''}" data-action="set-filter" data-filter="starred"><span>⭐ 星标邮件</span></button>
              <button class="nav-item \${state.view==='inbox' && state.filter==='important' ? 'active' : ''}" data-action="set-filter" data-filter="important"><span>🔥 重要邮件</span></button>
              <button class="nav-item \${state.view==='inbox' && state.filter==='verification' ? 'active' : ''}" data-action="set-filter" data-filter="verification"><span>🔐 转发确认</span></button>
            </div>

            <div>
              <div class="nav-group-title">邮箱来源</div>
              \${state.providers.map((p) => {
                if (!p.enabled) {
                  return \`<button class="nav-item reserved" disabled title="已预留接口，后续可在 src/providers.ts 启用"><span>○ \${esc(p.name)}</span><span class="badge">预留</span></button>\`;
                }
                const subItems = p.id === "gmail" && gmailAliases.length > 0
                  ? gmailAliases.map((a) => \`
                      <button class="nav-item nav-sub-item \${state.view==='inbox' && state.providerFilter==='gmail' && state.aliasFilter===a.alias ? 'active' : ''}" data-action="set-alias" data-alias="\${esc(a.alias)}">
                        <span>↳ \${esc(a.label)}</span>
                        <span class="badge">\${a.unread > 0 ? a.unread + '/' + a.total : a.total}</span>
                      </button>\`).join("")
                  : "";
                return \`
                  <button class="nav-item \${state.view==='inbox' && state.providerFilter===p.id && state.aliasFilter==='all' ? 'active' : ''}" data-action="set-provider" data-provider="\${esc(p.id)}"><span>● \${esc(p.name)}</span><span class="badge gmail">\${p.count || 0}</span></button>
                  \${subItems}\`;
              }).join("")}
            </div>

            <div>
              <div class="nav-group-title">管理</div>
              <button class="nav-item \${state.view==='providers' ? 'active' : ''}" data-action="open-view" data-view="providers"><span>📮 Gmail 转发配置</span></button>
              <button class="nav-item \${state.view==='rules' ? 'active' : ''}" data-action="open-view" data-view="rules"><span>🔀 拦截与推送规则</span></button>
              <button class="nav-item \${state.view==='settings' ? 'active' : ''}" data-action="open-view" data-view="settings"><span>⚙️ 设置与清理</span></button>
              <button class="nav-item" data-action="logout"><span>🚪 退出登录</span></button>
            </div>
          </aside>

          <section class="list-pane">
            <div class="list-toolbar">
              <input id="search-input" value="\${esc(state.search)}" placeholder="搜索主题、发件人、正文..." />
              <button id="refresh-btn">刷新</button>
            </div>
            <div class="mobile-filter-pills">
              <button class="filter-pill \${state.filter==='all' ? 'active' : ''}" data-action="set-filter" data-filter="all">全部 (\${state.total})</button>
              <button class="filter-pill \${state.filter==='unread' ? 'active' : ''}" data-action="set-filter" data-filter="unread">未读 (\${state.unreadCount})</button>
              <button class="filter-pill \${state.filter==='starred' ? 'active' : ''}" data-action="set-filter" data-filter="starred">⭐ 星标</button>
              <button class="filter-pill \${state.filter==='important' ? 'active' : ''}" data-action="set-filter" data-filter="important">🔥 重要</button>
              <button class="filter-pill \${state.filter==='verification' ? 'active' : ''}" data-action="set-filter" data-filter="verification">🔐 转发确认</button>
              \${gmailAliases.length > 1 ? \`
                <button class="filter-pill \${state.aliasFilter==='all' ? 'active' : ''}" data-action="set-alias" data-alias="all">全部账号</button>
                \${gmailAliases.map((a) => \`<button class="filter-pill \${state.aliasFilter===a.alias ? 'active' : ''}" data-action="set-alias" data-alias="\${esc(a.alias)}">🏷️ \${esc(a.label)}</button>\`).join("")}
              \` : ''}
            </div>
            <div class="mail-list">
              \${state.emails.length === 0 ? '<div class="muted" style="padding:36px 20px;text-align:center">暂无邮件</div>' : state.emails.map((m) => {
                const av = getAvatarMeta(m.from_name || m.from_address);
                const aliasBadge = getAliasBadgeText(m.account_alias);
                return \`
                <div class="mail-item \${m.is_read ? '' : 'unread'} \${state.selectedId===m.id ? 'active' : ''}" data-action="open-email" data-id="\${esc(m.id)}">
                  <div class="mail-avatar \${av.colorClass}">\${esc(av.letter)}</div>
                  <div class="mail-item-content">
                    <div class="mail-top">
                      <span class="mail-from">\${m.is_read ? '' : '<span class="mail-unread-dot"></span>'}\${m.is_starred ? '⭐ ' : ''}\${esc(m.from_name || m.from_address)}</span>
                      <span>\${isMobileViewport() ? fmtShortTime(m.received_at) : fmtTime(m.received_at).slice(5)}</span>
                    </div>
                    <div class="mail-subject">\${aliasBadge ? '<span class="badge alias">' + esc(aliasBadge) + '</span> ' : ''}\${m.is_verification ? '<span class="badge verify">确认</span> ' : ''}\${esc(m.subject)}</div>
                    <div class="mail-snippet">\${esc(m.snippet)}</div>
                  </div>
                </div>\`;
              }).join("")}
            </div>
          </section>

          <main class="main-pane">
            \${renderMainContent()}
          </main>

          <nav class="mobile-bottom-nav" aria-label="移动端导航">
            <button class="tab-btn \${state.view==='inbox' ? 'active' : ''}" data-action="open-view" data-view="inbox">
              <span class="tab-icon">📥</span>
              <span class="tab-label">收件箱</span>
              \${state.unreadCount > 0 ? \`<span class="tab-badge">\${state.unreadCount > 99 ? '99+' : state.unreadCount}</span>\` : ''}
            </button>
            <button class="tab-btn \${state.view==='providers' ? 'active' : ''}" data-action="open-view" data-view="providers">
              <span class="tab-icon">📮</span>
              <span class="tab-label">转发</span>
            </button>
            <button class="tab-btn \${state.view==='rules' ? 'active' : ''}" data-action="open-view" data-view="rules">
              <span class="tab-icon">🔀</span>
              <span class="tab-label">规则</span>
            </button>
            <button class="tab-btn \${state.view==='settings' ? 'active' : ''}" data-action="open-view" data-view="settings">
              <span class="tab-icon">⚙️</span>
              <span class="tab-label">设置</span>
            </button>
          </nav>
        </div>\`;

      const searchInput = $("#search-input");
      if (searchInput) {
        searchInput.addEventListener("keydown", async (e) => {
          if (e.key === "Enter") {
            state.search = searchInput.value.trim();
            await loadWorkspaceData();
            renderApp();
          }
        });
      }
      const refreshBtn = $("#refresh-btn");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
          state.search = ($("#search-input")?.value || "").trim();
          await loadWorkspaceData();
          renderApp();
        });
      }

      if (state.view === "providers") {
        const prefixInput = $("#alias-prefix-input");
        const previewInput = $("#alias-preview-addr");
        const addAliasBtn = $("#add-alias-btn");
        const mailDomain = state.status?.mailDomain || "example.com";
        if (prefixInput && previewInput) {
          prefixInput.addEventListener("input", () => {
            state.aliasDraftTag = sanitizeCustomPrefix(prefixInput.value);
            previewInput.value = buildCustomForwardAddress(mailDomain, state.aliasDraftTag);
          });
        }
        addAliasBtn?.addEventListener("click", async () => {
          const prefix = sanitizeCustomPrefix($("#alias-prefix-input")?.value || "");
          const label = ($("#alias-label-input")?.value || "").trim();
          const source_email = ($("#alias-source-input")?.value || "").trim();
          if (!prefix) {
            $("#alias-msg").innerHTML = '<div class="msg-err">请输入有效的英文/数字前缀（例如 work）</div>';
            return;
          }
          try {
            const res = await api("/api/aliases", {
              method: "POST",
              body: JSON.stringify({ prefix, label, source_email })
            });
            state.aliasDraftTag = "";
            await openView("providers");
            const msgEl = $("#alias-msg");
            if (msgEl) msgEl.innerHTML = '<div class="msg-ok">已添加转发地址：' + esc(res.forwardAddress) + '（立即可用）</div>';
          } catch (e) {
            $("#alias-msg").innerHTML = '<div class="msg-err">' + esc(e.message) + '</div>';
          }
        });
      }

      if (state.view === "rules") {
        renderForwardFields();
        $("#fw-type")?.addEventListener("change", renderForwardFields);
        $("#add-block-btn")?.addEventListener("click", async () => {
          const keyword = $("#new-block-kw").value.trim();
          if (!keyword) return;
          await api("/api/rules/block", { method: "POST", body: JSON.stringify({ keyword, provider: "gmail" }) });
          await openView("rules");
        });
        $("#add-fw-btn")?.addEventListener("click", async () => {
          const type = $("#fw-type").value;
          const name = $("#fw-name").value.trim() || type;
          const keyword_filter = $("#fw-kw").value.trim();
          let config = {};
          if (type === "wecom") {
            config = { webhook_url: $("#fw-wecom-url").value.trim() };
          } else if (type === "ntfy") {
            config = {
              server_url: ($("#fw-ntfy-server").value.trim() || "https://ntfy.sh"),
              topic: $("#fw-ntfy-topic").value.trim(),
              token: $("#fw-ntfy-token").value.trim(),
              priority: $("#fw-ntfy-priority").value
            };
          } else if (type === "serverchan") {
            config = { send_key: $("#fw-sc-key").value.trim() };
          } else {
            config = { url: $("#fw-wh-url").value.trim(), secret: $("#fw-wh-secret").value.trim() };
          }
          try {
            await api("/api/rules/forward", { method: "POST", body: JSON.stringify({ name, type, provider: "gmail", config, keyword_filter }) });
            await openView("rules");
          } catch (e) {
            $("#fw-msg").innerHTML = '<div class="msg-err">' + esc(e.message) + '</div>';
          }
        });
      }

      if (state.view === "settings") {
        $("#save-settings-btn")?.addEventListener("click", async () => {
          try {
            await api("/api/settings", {
              method: "PUT",
              body: JSON.stringify({
                auto_delete_days: Number($("#set-days").value || 0),
                gmail_source_email: $("#set-gmail").value.trim()
              })
            });
            $("#set-msg").innerHTML = '<div class="msg-ok">设置已保存</div>';
          } catch (e) {
            $("#set-msg").innerHTML = '<div class="msg-err">' + esc(e.message) + '</div>';
          }
        });
        $("#run-cleanup-btn")?.addEventListener("click", async () => {
          const res = await api("/api/cleanup", { method: "POST" });
          $("#set-msg").innerHTML = '<div class="msg-ok">清理完成：删除邮件 ' + res.deletedEmails + ' 封</div>';
          await loadWorkspaceData();
        });
        $("#save-pw-btn")?.addEventListener("click", async () => {
          try {
            await api("/api/settings", {
              method: "PUT",
              body: JSON.stringify({
                current_password: $("#set-old-pw").value,
                new_password: $("#set-new-pw").value
              })
            });
            $("#set-old-pw").value = "";
            $("#set-new-pw").value = "";
            $("#set-msg").innerHTML = '<div class="msg-ok">密码已更新，旧会话已自动失效</div>';
          } catch (e) {
            $("#set-msg").innerHTML = '<div class="msg-err">' + esc(e.message) + '</div>';
          }
        });
      }
    }

    // Single delegated click listener — zero inline onclick JS anywhere in DOM
    document.addEventListener("click", async (event) => {
      const target = event.target?.closest?.("[data-action]");
      if (!target) return;
      const action = target.dataset.action;

      if (action === "toggle-theme") { toggleTheme(); return; }
      if (action === "toggle-mobile-nav") { state.mobileNavOpen = !state.mobileNavOpen; renderApp(); return; }
      if (action === "close-mobile-nav") { state.mobileNavOpen = false; renderApp(); return; }
      if (action === "mobile-back") {
        state.mobileScreen = "list";
        renderApp();
        return;
      }
      if (action === "mobile-refresh") {
        state.search = ($("#search-input")?.value || "").trim();
        await loadWorkspaceData();
        renderApp();
        return;
      }
      if (action === "copy-text") {
        await navigator.clipboard?.writeText(target.dataset.copy || "");
        target.textContent = "已复制";
        return;
      }
      if (action === "set-filter") {
        state.filter = target.dataset.filter || "all";
        state.view = "inbox";
        state.mobileScreen = "list";
        state.mobileNavOpen = false;
        await loadWorkspaceData();
        renderApp();
        return;
      }
      if (action === "set-provider") {
        state.providerFilter = target.dataset.provider || "gmail";
        state.aliasFilter = "all";
        state.view = "inbox";
        state.mobileScreen = "list";
        state.mobileNavOpen = false;
        await loadWorkspaceData();
        renderApp();
        return;
      }
      if (action === "set-alias") {
        state.providerFilter = "gmail";
        state.aliasFilter = target.dataset.alias || "all";
        state.view = "inbox";
        state.mobileScreen = "list";
        state.mobileNavOpen = false;
        await loadWorkspaceData();
        renderApp();
        return;
      }
      if (action === "pick-alias-tag") {
        state.aliasDraftTag = sanitizeCustomPrefix(target.dataset.tag || "");
        renderApp();
        return;
      }
      if (action === "toggle-alias") {
        await api("/api/aliases/" + encodeURIComponent(target.dataset.id || ""), {
          method: "PATCH",
          body: JSON.stringify({ enabled: Number(target.dataset.enabled || "0") })
        });
        await openView("providers");
        return;
      }
      if (action === "del-alias") {
        const delId = target.dataset.id || "";
        await api("/api/aliases/" + encodeURIComponent(delId), { method: "DELETE" });
        state.aliasFilter = "all";
        await openView("providers");
        return;
      }
      if (action === "open-view") { await openView(target.dataset.view || "inbox"); return; }
      if (action === "open-email") { await openEmail(target.dataset.id || ""); return; }
      if (action === "switch-body-mode") { state.bodyMode = state.bodyMode === "html" ? "text" : "html"; renderApp(); return; }
      if (action === "allow-remote-images") { state.allowRemoteImages = true; renderApp(); return; }
      if (action === "mark-email") {
        const id = target.dataset.id || "";
        const field = target.dataset.field || "";
        const value = Number(target.dataset.value || "0");
        await api("/api/emails/" + encodeURIComponent(id) + "/mark", { method: "PATCH", body: JSON.stringify({ [field]: value }) });
        await loadWorkspaceData();
        if (state.detail && state.detail.email.id === id) {
          state.detail = await api("/api/emails/" + encodeURIComponent(id));
        }
        renderApp();
        return;
      }
      if (action === "delete-email") {
        const id = target.dataset.id || "";
        await api("/api/emails/" + encodeURIComponent(id), { method: "DELETE" });
        if (state.selectedId === id) {
          state.selectedId = null;
          state.detail = null;
          state.mobileScreen = "list";
        }
        await loadWorkspaceData();
        renderApp();
        return;
      }
      if (action === "toggle-block") {
        await api("/api/rules/block/" + encodeURIComponent(target.dataset.id || ""), { method: "PATCH", body: JSON.stringify({ enabled: Number(target.dataset.enabled || "0") }) });
        await openView("rules");
        return;
      }
      if (action === "del-block") {
        await api("/api/rules/block/" + encodeURIComponent(target.dataset.id || ""), { method: "DELETE" });
        await openView("rules");
        return;
      }
      if (action === "toggle-forward") {
        await api("/api/rules/forward/" + encodeURIComponent(target.dataset.id || ""), { method: "PATCH", body: JSON.stringify({ enabled: Number(target.dataset.enabled || "0") }) });
        await openView("rules");
        return;
      }
      if (action === "del-forward") {
        await api("/api/rules/forward/" + encodeURIComponent(target.dataset.id || ""), { method: "DELETE" });
        await openView("rules");
        return;
      }
      if (action === "test-forward") {
        try {
          const res = await api("/api/rules/forward/" + encodeURIComponent(target.dataset.id || "") + "/test", { method: "POST" });
          $("#fw-msg").innerHTML = res.ok ? '<div class="msg-ok">测试推送已发送成功！</div>' : '<div class="msg-err">推送失败：' + esc(res.error || '未知错误') + '</div>';
        } catch (e) {
          $("#fw-msg").innerHTML = '<div class="msg-err">' + esc(e.message) + '</div>';
        }
        return;
      }
      if (action === "logout") {
        const res = await api("/api/logout", { method: "POST" });
        state.detail = null;
        if (res.redirectUrl) {
          window.location.href = res.redirectUrl;
          return;
        }
        await bootstrap();
      }
    });

    // Only re-render when crossing the 960px desktop/mobile breakpoint (never on mobile keyboard resize)
    let lastWasMobile = isMobileViewport();
    window.addEventListener("resize", () => {
      const nowMobile = isMobileViewport();
      if (nowMobile !== lastWasMobile) {
        lastWasMobile = nowMobile;
        if (state.status?.authenticated) renderApp();
      }
    });

    bootstrap().catch((e) => {
      $("#app").innerHTML = '<div class="auth-wrap"><div class="auth-card"><h1>加载失败</h1><p class="msg-err">' + esc(e.message) + '</p></div></div>';
    });
  </script>
</body>
</html>`;
}
