/**
 * B站 Cookie 管理工具 - 前端逻辑
 */

// ===== 状态 =====
const state = {
  accounts:        [],
  qrPollingTimer:  null,
  qrExpireTimer:   null,
  barUpdateTimer:  null,
  eventSource:     null,
};

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
  checkHealth();
  connectStatusStream(); // 替代 fetchAccounts()，通过 SSE 实时获取初始数据及后续更新

  // 点击遮罩关闭弹窗
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.getElementById('confirm-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeConfirm();
  });

  // Esc 键关闭弹窗
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeConfirm(); }
  });
});

// ===== 健康检查 =====
async function checkHealth() {
  try {
    const res  = await fetch('/api/health');
    const data = await res.json();
    setServiceStatus(data.status === 'ok' ? 'online' : 'offline',
                     data.status === 'ok' ? '服务在线' : '服务异常');
  } catch {
    setServiceStatus('offline', '无法连接');
  }
}

function setServiceStatus(status, text) {
  document.getElementById('status-dot').className = `status-dot status-${status}`;
  document.getElementById('status-text').textContent = text;
}

// ===== 实时状态流（SSE） =====
function connectStatusStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }

  setStreamStatus('connecting');
  const es = new EventSource('/api/accounts/stream');
  state.eventSource = es;

  // 连接建立，收到初始数据
  es.addEventListener('init', (e) => {
    const accounts = JSON.parse(e.data);
    state.accounts = accounts;
    renderAccounts(accounts);
    updateStats(accounts);
    setStreamStatus('connected');
  });

  // 单个账号状态变更
  es.addEventListener('account-update', (e) => {
    const account = JSON.parse(e.data);
    const idx = state.accounts.findIndex(a => a.uid === account.uid);
    if (idx >= 0) {
      state.accounts[idx] = account;
    } else {
      state.accounts.push(account);
    }
    const card = document.getElementById(`card-${account.uid}`);
    if (card) {
      card.outerHTML = createAccountCard(account);
    } else {
      renderAccounts(state.accounts);
    }
    updateStats(state.accounts);
  });

  // 全量验证完成（服务端定时任务触发）
  es.addEventListener('validation-complete', (e) => {
    const results = JSON.parse(e.data);
    // 用服务端最新结果批量更新本地状态
    results.forEach(r => {
      const idx = state.accounts.findIndex(a => a.uid === r.uid);
      if (idx >= 0) {
        state.accounts[idx].isValid        = r.isValid;
        state.accounts[idx].username       = r.username;
        state.accounts[idx].sessdataExpiry = r.sessdataExpiry;
        if (r.refreshed) state.accounts[idx].refreshed = true;
      }
    });
    renderAccounts(state.accounts);
    updateStats(state.accounts);

    const refreshedCount = results.filter(r => r.refreshed).length;
    if (refreshedCount > 0) {
      showToast(`${refreshedCount} 个账号 Cookie 已自动续期`, 'success');
    }
  });

  // 全部账号失效告警
  es.addEventListener('all-invalid', () => {
    showToast('⚠️ 所有账号 Cookie 均已失效，请扫码添加新账号！', 'error');
    showAllInvalidBanner();
  });

  es.onerror = () => {
    setStreamStatus('offline');
    es.close();
    state.eventSource = null;
    // 5 秒后自动重连，期间保持本地数据可用
    setTimeout(() => connectStatusStream(), 5000);
  };
}

function setStreamStatus(status) {
  const dot  = document.getElementById('stream-dot');
  const text = document.getElementById('stream-text');
  if (!dot || !text) return;
  const MAP = {
    connected:  { cls: 'stream-dot-connected',  label: '实时监测中' },
    connecting: { cls: 'stream-dot-connecting', label: '连接中...' },
    offline:    { cls: 'stream-dot-offline',    label: '已断开，重连中' },
  };
  const cfg = MAP[status] || MAP.connecting;
  dot.className  = `stream-dot ${cfg.cls}`;
  text.textContent = cfg.label;
}
async function fetchAccounts() {
  try {
    const res  = await fetch('/api/accounts');
    const data = await res.json();
    if (data.success) {
      state.accounts = data.data;
      renderAccounts(state.accounts);
      updateStats(state.accounts);
    }
  } catch {
    showToast('加载账号列表失败', 'error');
    renderEmpty();
  }
}

// ===== 渲染 =====
function renderAccounts(accounts) {
  const container = document.getElementById('accounts-container');
  if (!accounts.length) { renderEmpty(); return; }
  container.innerHTML = accounts.map(createAccountCard).join('');
}

function renderEmpty() {
  document.getElementById('accounts-container').innerHTML = `
    <div class="empty-state">
      <svg class="empty-icon" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="28" stroke="currentColor" stroke-width="2" stroke-dasharray="5 3"/>
        <path d="M24 32h16M32 24v16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <p class="empty-title">还没有账号</p>
      <p class="empty-desc">点击「添加账号」扫码登录 B站 账号</p>
      <button class="btn btn-primary" style="margin-top:4px" onclick="showAddModal()">添加第一个账号</button>
    </div>
  `;
}

function createAccountCard(account) {
  const { uid, username, avatar, isValid, lastValidated, addedAt, sessdataExpiry } = account;

  const timeLabel = lastValidated
    ? `上次验证: ${formatRelativeTime(lastValidated)}`
    : `添加时间: ${formatRelativeTime(addedAt)}`;

  // 计算过期信息
  const expiryInfo = buildExpiryInfo(sessdataExpiry, isValid);

  const avatarImg = avatar
    ? `<img class="account-avatar" src="${esc(avatar)}" alt="${esc(username)}"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const avatarFallback = `<div class="account-avatar-fallback"
    style="${avatar ? 'display:none;' : ''}background:${avatarColor(uid)}">
    ${esc((username || uid).charAt(0).toUpperCase())}
  </div>`;

  return `
    <div class="account-card${expiryInfo.cardClass}" id="card-${esc(uid)}" data-uid="${esc(uid)}">
      <div class="account-card-left">
        <div class="account-avatar-wrap">
          ${avatarImg}
          ${avatarFallback}
        </div>
        <div class="account-info">
          <div class="account-name">${esc(username || `UID:${uid}`)}</div>
          <div class="account-uid">UID: ${esc(uid)}</div>
          <div class="account-meta">${timeLabel}</div>
          ${expiryInfo.html}
        </div>
      </div>
      <div class="account-card-right">
        ${statusBadge(isValid)}
        <div class="account-actions">
          <button class="btn btn-sm btn-ghost"
            onclick="validateAccount('${esc(uid)}')" title="立即验证并续期">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            验证
          </button>
          <button class="btn btn-sm btn-ghost"
            onclick="copyAccountCookie('${esc(uid)}')" title="复制 Cookie 字符串">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            复制
          </button>
          <button class="btn btn-sm btn-danger-ghost"
            onclick="confirmRemove('${esc(uid)}', '${esc(username || uid)}')" title="删除账号">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
            删除
          </button>
        </div>
      </div>
    </div>
  `;
}

function statusBadge(isValid) {
  if (isValid === true)  return '<span class="badge badge-valid">有效</span>';
  if (isValid === false) return '<span class="badge badge-invalid">已失效</span>';
  return '<span class="badge badge-unknown">验证中...</span>';
}

/**
 * 计算过期提示信息（给 account-card 用）
 * @param {number|null} sessdataExpiry Unix 时间戳（秒）
 * @param {boolean} isValid
 * @returns {{ html: string, cardClass: string }}
 */
function buildExpiryInfo(sessdataExpiry, isValid) {
  if (!isValid || !sessdataExpiry) return { html: '', cardClass: '' };

  const nowSec   = Date.now() / 1000;
  const daysLeft = (sessdataExpiry - nowSec) / 86400;
  const dateStr  = new Date(sessdataExpiry * 1000).toLocaleDateString('zh-CN');

  if (daysLeft <= 0) {
    return {
      html:      `<div class="expiry-tag expiry-expired">SESSDATA 已过期</div>`,
      cardClass: ' account-card-expired',
    };
  }
  if (daysLeft <= 3) {
    return {
      html:      `<div class="expiry-tag expiry-urgent">⚠ ${Math.ceil(daysLeft)} 天后过期 (${dateStr})，自动续期中</div>`,
      cardClass: ' account-card-warn',
    };
  }
  if (daysLeft <= 14) {
    return {
      html:      `<div class="expiry-tag expiry-warn">Cookie 将于 ${Math.ceil(daysLeft)} 天后过期 (${dateStr})</div>`,
      cardClass: ' account-card-warn',
    };
  }
  return {
    html:      `<div class="expiry-tag expiry-ok">过期于 ${dateStr}</div>`,
    cardClass: '',
  };
}

function updateStats(accounts) {
  const total   = accounts.length;
  const valid   = accounts.filter(a => a.isValid === true).length;
  const invalid = accounts.filter(a => a.isValid === false).length;
  const unknown = total - valid - invalid;
  document.getElementById('stat-total').textContent   = total;
  document.getElementById('stat-valid').textContent   = valid;
  document.getElementById('stat-invalid').textContent = invalid;
  document.getElementById('stat-unknown').textContent = unknown;

  // 全部失效时显示横幅
  if (total > 0 && valid === 0) {
    showAllInvalidBanner();
  } else {
    hideAllInvalidBanner();
  }
}

function showAllInvalidBanner() {
  let banner = document.getElementById('all-invalid-banner');
  if (banner) return; // 已存在
  banner = document.createElement('div');
  banner.id = 'all-invalid-banner';
  banner.className = 'all-invalid-banner';
  banner.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;flex-shrink:0">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    <span>所有账号 Cookie 均已失效，服务无法获取 B站 数据，请立即</span>
    <button class="btn btn-sm btn-primary" onclick="showAddModal()">扫码添加账号</button>
  `;
  // 插入账号列表区域顶部
  const section = document.querySelector('.section');
  if (section) section.insertAdjacentElement('beforebegin', banner);
}

function hideAllInvalidBanner() {
  const banner = document.getElementById('all-invalid-banner');
  if (banner) banner.remove();
}

// ===== 弹窗：添加账号（扫码登录） =====
async function showAddModal() {
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  // 重置状态
  document.getElementById('qr-container').innerHTML = `
    <div class="qr-loading"><div class="spinner"></div><p>生成二维码中...</p></div>`;
  document.getElementById('qr-status-text').textContent = '请使用 B站 APP 扫描上方二维码';

  await generateQR();
}

function closeModal() {
  clearQRTimers();
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function clearQRTimers() {
  if (state.qrPollingTimer) { clearInterval(state.qrPollingTimer); state.qrPollingTimer = null; }
  if (state.qrExpireTimer)  { clearTimeout(state.qrExpireTimer);  state.qrExpireTimer  = null; }
  if (state.barUpdateTimer) { clearInterval(state.barUpdateTimer); state.barUpdateTimer = null; }
}

async function generateQR() {
  try {
    const res  = await fetch('/api/auth/qrcode');
    const data = await res.json();
    if (!data.success) throw new Error(data.message);

    const { qrcode_image, qrcode_key, expires_in } = data.data;

    document.getElementById('qr-container').innerHTML = `
      <div class="qr-image-wrap">
        <img class="qr-image" src="${qrcode_image}" alt="登录二维码">
        <div class="qr-expire-bar">
          <div class="qr-expire-progress" id="qr-expire-progress"></div>
        </div>
      </div>`;

    // 过期进度条
    const expiresMs = expires_in * 1000;
    const startTime = Date.now();
    state.barUpdateTimer = setInterval(() => {
      const bar = document.getElementById('qr-expire-progress');
      if (!bar) return;
      const pct = Math.max(0, 100 - ((Date.now() - startTime) / expiresMs) * 100);
      bar.style.width = `${pct}%`;
    }, 200);

    // 二维码过期
    state.qrExpireTimer = setTimeout(() => {
      clearQRTimers();
      document.getElementById('qr-status-text').textContent = '二维码已过期';
      document.getElementById('qr-container').innerHTML = `
        <div class="qr-expired">
          <p>二维码已过期</p>
          <button class="btn btn-primary" onclick="generateQR()">重新生成</button>
        </div>`;
    }, expiresMs);

    startPolling(qrcode_key);
  } catch (err) {
    document.getElementById('qr-container').innerHTML = `
      <div class="qr-error">
        <p>生成二维码失败: ${esc(err.message)}</p>
        <button class="btn btn-primary" onclick="generateQR()">重试</button>
      </div>`;
  }
}

function startPolling(qrcode_key) {
  if (state.qrPollingTimer) clearInterval(state.qrPollingTimer);

  state.qrPollingTimer = setInterval(async () => {
    try {
      const res  = await fetch(`/api/auth/poll?key=${encodeURIComponent(qrcode_key)}`);
      const data = await res.json();
      if (!data.success) return;

      const code = data.data.code;

      if (code === 86101) {
        document.getElementById('qr-status-text').textContent = '请使用 B站 APP 扫描上方二维码';
      } else if (code === 86090) {
        document.getElementById('qr-status-text').textContent = '已扫码，请在手机上确认登录';
      } else if (code === 86038) {
        // 二维码失效（已由 expireTimer 处理，此处保险处理）
        clearQRTimers();
        document.getElementById('qr-status-text').textContent = '二维码已过期';
        document.getElementById('qr-container').innerHTML = `
          <div class="qr-expired">
            <p>二维码已过期</p>
            <button class="btn btn-primary" onclick="generateQR()">重新生成</button>
          </div>`;
      } else if (code === 0) {
        // 登录成功
        clearQRTimers();

        document.getElementById('qr-container').innerHTML = `
          <div class="qr-success">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
          </div>`;

        const account  = data.account;
        const isUpdate = data.isUpdate;
        document.getElementById('qr-status-text').textContent = account
          ? (isUpdate ? `Cookie 已更新！${account.username}` : `登录成功！欢迎，${account.username}`)
          : (isUpdate ? 'Cookie 已更新！' : '登录成功！');

        showToast(
          account
            ? (isUpdate ? `账号「${account.username}」Cookie 已更新` : `账号「${account.username}」已添加`)
            : (isUpdate ? 'Cookie 已更新' : '账号已添加'),
          'success',
        );

        // SSE 会自动推送 account-update 事件刷新列表，此处仅关闭弹窗
        setTimeout(() => closeModal(), 1500);
      }
    } catch {
      // 轮询期间的网络错误忽略，继续轮询
    }
  }, 1500);
}

// ===== 复制 Cookie =====
async function copyAccountCookie(uid) {
  try {
    const res  = await fetch(`/api/accounts/${encodeURIComponent(uid)}/cookie`);
    const data = await res.json();
    if (!data.success) { showToast(data.message || '获取失败', 'error'); return; }

    const cookieStr = Object.entries(data.data.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    await navigator.clipboard.writeText(cookieStr);
    showToast('Cookie 已复制到剪贴板', 'success');
  } catch {
    showToast('复制失败，请检查浏览器权限', 'error');
  }
}

// ===== 删除账号 =====
function confirmRemove(uid, username) {
  document.getElementById('confirm-text').textContent =
    `确定要删除账号「${username}」吗？此操作不可撤销。`;
  document.getElementById('confirm-btn').onclick = () => removeAccount(uid);
  document.getElementById('confirm-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeConfirm() {
  document.getElementById('confirm-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

async function removeAccount(uid) {
  closeConfirm();
  try {
    const res  = await fetch(`/api/accounts/${encodeURIComponent(uid)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      state.accounts = state.accounts.filter(a => a.uid !== uid);
      renderAccounts(state.accounts);
      updateStats(state.accounts);
      showToast('账号已删除', 'success');
    } else {
      showToast(data.message || '删除失败', 'error');
    }
  } catch {
    showToast('删除请求失败', 'error');
  }
}

// ===== Toast =====
function showToast(message, type = 'success') {
  const ICONS = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>`,
    error:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${ICONS[type] || ICONS.success}</span>
                     <span class="toast-message">${esc(message)}</span>`;
  document.getElementById('toast-container').appendChild(toast);

  // 触发动画
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast-visible')));

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ===== 工具函数 =====
function esc(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

function formatRelativeTime(isoStr) {
  if (!isoStr) return '未知';
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 60_000)        return '刚刚';
  if (diff < 3_600_000)     return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000)    return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(isoStr).toLocaleDateString('zh-CN');
}

const AVATAR_COLORS = ['#00a1d6', '#fb7299', '#4caf50', '#ff9800', '#7b1fa2', '#00796b'];
function avatarColor(uid) {
  return AVATAR_COLORS[parseInt(uid || '0') % AVATAR_COLORS.length];
}
