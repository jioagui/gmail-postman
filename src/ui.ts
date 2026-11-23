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
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>访问受限 · ${safeTitle}</title>
  <style>
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>
    :root {
      --bg: #0d1117;
      --bg-elev: #161b22;
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
    }
    [data-theme="light"] {
      --bg: #f6f8fa;
      --bg-elev: #ffffff;
      --bg-hover: #eef2f6;
      --border: #d0d7de;
      --text: #1f2328;
      --muted: #656d76;
      --accent: #2563eb;
      --accent-soft: rgba(37, 99, 235, 0.1);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
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
      transition: background 0.15s, border-color 0.15s;
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
    .mobile-bar {
      display: none;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-elev);
      justify-content: space-between;
      align-items: center;
    }
    @media (max-width: 960px) {
      .layout { grid-template-columns: 1fr; height: auto; min-height: 100vh; }
      .mobile-bar { display: flex; }
      .sidebar { display: none; border-right: none; border-bottom: 1px solid var(--border); }
      .sidebar.open { display: flex; }
      .list-pane { border-right: none; max-height: 45vh; }
      .grid-2 { grid-template-columns: 1fr; }
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
      search: "",
      emails: [],
      total: 0,
      unreadCount: 0,
      selectedId: null,
      detail: null,
      bodyMode: "html",
      allowRemoteImages: false,
      providers: [],
      blockRules: [],
      forwardRules: [],
      settings: null,
      mobileNavOpen: false
    };

    const $ = (sel) => document.querySelector(sel);
    const esc = (s) => String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

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

    function fmtBytes(bytes) {
      if (bytes < 1024) return bytes + " B";
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
      return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    }

    function toggleTheme() {
      const cur = document.documentElement.getAttribute("data-theme") || "dark";
      const next = cur === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("gmail_postman_theme", next);
    }

    function buildSafeSrcdoc(rawHtml, allowRemote) {
      const csp = allowRemote
        ? "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:;"
        : "default-src 'none'; style-src 'unsafe-inline'; img-src data:;";
      return '<meta http-equiv="Content-Security-Policy" content="' + csp + '">' + rawHtml;
    }

    const savedTheme = localStorage.getItem("gmail_postman_theme");
    if (savedTheme) document.documentElement.setAttribute("data-theme", savedTheme);

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
          filter: state.filter,
          q: state.search
        }))
      ]);
      state.providers = provRes.providers;
      state.emails = mailRes.emails;
      state.total = mailRes.total;
      state.unreadCount = mailRes.unreadCount;
    }

    async function openEmail(id) {
      state.selectedId = id;
      state.view = "inbox";
      state.allowRemoteImages = false;
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
    }

    async function openView(view) {
      state.view = view;
      state.mobileNavOpen = false;
      if (view === "rules") {
        const [b, f] = await Promise.all([api("/api/rules/block"), api("/api/rules/forward")]);
        state.blockRules = b.rules;
        state.forwardRules = f.rules;
      } else if (view === "settings") {
        state.settings = await api("/api/settings");
      } else if (view === "providers") {
        const p = await api("/api/providers");
        state.providers = p.providers;
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
        return \`
          <div class="card">
            <h2>📮 邮箱转发接入（当前启用 Gmail，其他邮箱已预留）</h2>
            <p class="muted" style="margin-bottom:12px">将 Gmail 自动转发到下方 Cloudflare Email Routing 地址后，邮件会秒级入库并触发实时推送。</p>
            \${state.providers.map((p) => \`
              <div class="card" style="margin-bottom:10px;opacity:\${p.enabled ? 1 : 0.65}">
                <div class="row" style="justify-content:space-between;margin-bottom:6px">
                  <strong>\${esc(p.name)}</strong>
                  <span class="badge \${p.enabled ? 'gmail' : ''}">\${p.enabled ? '已启用' : '预留（未启用）'}</span>
                </div>
                <div class="muted" style="margin-bottom:8px">\${esc(p.description)}</div>
                <div class="row" style="margin-bottom:8px">
                  <input class="mono" readonly value="\${esc(p.forwardAddress)}" />
                  <button data-action="copy-text" data-copy="\${esc(p.forwardAddress)}">复制地址</button>
                </div>
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
      return \`
        <div class="detail-actions">
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

        \${state.bodyMode === "html" && m.html_body
          ? \`<iframe class="email-frame" sandbox="" referrerpolicy="no-referrer" srcdoc="\${esc(buildSafeSrcdoc(m.html_body, state.allowRemoteImages))}"></iframe>\`
          : \`<div class="email-text">\${esc(m.text_body || m.snippet || '(空邮件)')}</div>\`
        }
      \`;
    }

    function renderApp() {
      $("#app").innerHTML = \`
        <div class="mobile-bar">
          <strong>📬 \${esc(state.status.appTitle)}</strong>
          <div class="row">
            <button data-action="toggle-theme">🌓</button>
            <button data-action="toggle-mobile-nav">☰ 菜单</button>
          </div>
        </div>
        <div class="layout">
          <aside class="sidebar \${state.mobileNavOpen ? 'open' : ''}">
            <div class="brand">
              <span>📬 Gmail 助手</span>
              <button data-action="toggle-theme" title="切换暗色/亮色模式">🌓</button>
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
              \${state.providers.map((p) => p.enabled
                ? \`<button class="nav-item \${state.providerFilter===p.id ? 'active' : ''}" data-action="set-provider" data-provider="\${esc(p.id)}"><span>● \${esc(p.name)}</span><span class="badge gmail">\${p.count || 0}</span></button>\`
                : \`<button class="nav-item reserved" disabled title="已预留接口，后续可在 src/providers.ts 启用"><span>○ \${esc(p.name)}</span><span class="badge">预留</span></button>\`
              ).join("")}
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
            <div class="mail-list">
              \${state.emails.length === 0 ? '<div class="muted" style="padding:24px;text-align:center">暂无邮件</div>' : state.emails.map((m) => \`
                <div class="mail-item \${m.is_read ? '' : 'unread'} \${state.selectedId===m.id ? 'active' : ''}" data-action="open-email" data-id="\${esc(m.id)}">
                  <div class="mail-top">
                    <span class="mail-from">\${m.is_starred ? '⭐ ' : ''}\${esc(m.from_name || m.from_address)}</span>
                    <span>\${fmtTime(m.received_at).slice(5)}</span>
                  </div>
                  <div class="mail-subject">\${m.is_verification ? '<span class="badge verify">确认</span> ' : ''}\${esc(m.subject)}</div>
                  <div class="mail-snippet">\${esc(m.snippet)}</div>
                </div>
              \`).join("")}
            </div>
          </section>

          <main class="main-pane">
            \${renderMainContent()}
          </main>
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
      if (action === "copy-text") {
        await navigator.clipboard?.writeText(target.dataset.copy || "");
        target.textContent = "已复制";
        return;
      }
      if (action === "set-filter") {
        state.filter = target.dataset.filter || "all";
        state.view = "inbox";
        state.mobileNavOpen = false;
        await loadWorkspaceData();
        renderApp();
        return;
      }
      if (action === "set-provider") {
        state.providerFilter = target.dataset.provider || "gmail";
        state.view = "inbox";
        state.mobileNavOpen = false;
        await loadWorkspaceData();
        renderApp();
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
        if (state.selectedId === id) { state.selectedId = null; state.detail = null; }
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

    bootstrap().catch((e) => {
      $("#app").innerHTML = '<div class="auth-wrap"><div class="auth-card"><h1>加载失败</h1><p class="msg-err">' + esc(e.message) + '</p></div></div>';
    });
  </script>
</body>
</html>`;
}
