import {
  hasLocalVault,
  readLocalVault,
  writeLocalVault,
  clearLocalVault,
  createVault,
  unlockWithPassword,
  resetPasswordWithRecovery,
  savePlainVault,
  parseVaultFile,
  downloadVault,
  entriesToBulkText,
  parseBulkText,
  getPasswordStrength
} from './solovault-core.js';

const ICONS = {
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4Z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="7.5" r="5.5"/><path d="m21 21-8.5-8.5"/><path d="m15 15 3 3"/></svg>'
};

const state = {
  page: 'loading',
  vaultFile: null,
  dek: null,
  plain: null,
  searchQuery: '',
  backoffUntil: 0,
  backoffTimer: null,
  autoLockTimer: null,
  idleTimer: null,
  clipboardTimers: new Map(),
  revealedPasswords: new Set()
};

const $app = document.getElementById('app');
const $toastLayer = document.getElementById('toast-layer');
const $modalOverlay = document.getElementById('modal-overlay');
const $modalContainer = document.getElementById('modal-container');

function toast(message, type = 'info', duration = 3000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $toastLayer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function showModal(html) {
  $modalContainer.innerHTML = html;
  $modalOverlay.classList.remove('hidden');
}

function hideModal() {
  $modalOverlay.classList.add('hidden');
  $modalContainer.innerHTML = '';
}

function render() {
  switch (state.page) {
    case 'loading': renderLoading(); break;
    case 'onboarding': renderOnboarding(); break;
    case 'unlock': renderUnlock(); break;
    case 'dashboard': renderDashboard(); break;
  }
}

function renderLoading() {
  $app.innerHTML = '<div class="center-page"><div class="brand"><h1>SoloVault</h1><p>本地离线密码库</p></div></div>';
}

function renderOnboarding() {
  $app.innerHTML = `
    <div class="center-page page">
      <div class="brand">
        <h1>SoloVault</h1>
        <p>本地离线密码库</p>
      </div>
      <div id="onboarding-content" class="form-card">
        <div id="ob-choices">
          <button class="btn btn-primary btn-block" data-action="ob-create">${ICONS.shield} 创建新密码库</button>
          <div class="divider">或</div>
          <button class="btn btn-block" data-action="ob-import">${ICONS.upload} 导入 Vault 文件</button>
        </div>
        <div id="ob-create-form" class="hidden">
          <div class="field">
            <label>主密码 <span class="required">*</span></label>
            <div class="input-wrap">
              <input type="password" id="ob-pw1" placeholder="至少 8 位" autocomplete="new-password">
              <button class="toggle-pw" data-toggle="ob-pw1" aria-label="显示密码">${ICONS.eye}</button>
            </div>
          </div>
          <div class="field">
            <label>确认主密码 <span class="required">*</span></label>
            <div class="input-wrap">
              <input type="password" id="ob-pw2" placeholder="再次输入主密码" autocomplete="new-password">
              <button class="toggle-pw" data-toggle="ob-pw2" aria-label="显示密码">${ICONS.eye}</button>
            </div>
          </div>
          <div id="ob-strength"></div>
          <div id="ob-pw-error" class="error-msg"></div>
          <div class="form-actions">
            <button class="btn btn-ghost" data-action="ob-back">返回</button>
            <button class="btn btn-primary" id="ob-create-btn" data-action="ob-do-create">创建</button>
          </div>
        </div>
        <div id="ob-recovery" class="hidden recovery-panel">
          <h3>恢复码</h3>
          <p>请妥善保存此恢复码，丢失后将无法找回。恢复码仅展示一次。</p>
          <div class="recovery-code" id="ob-recovery-code"></div>
          <div class="recovery-actions">
            <button class="btn btn-sm" data-action="ob-copy-recovery">${ICONS.copy} 复制恢复码</button>
            <button class="btn btn-sm" data-action="ob-download-recovery">${ICONS.download} 下载恢复码</button>
          </div>
          <label class="checkbox-field">
            <input type="checkbox" id="ob-recovery-confirmed">
            我已安全保存恢复码
          </label>
          <button class="btn btn-primary btn-block" id="ob-continue-btn" data-action="ob-continue" disabled>进入密码库</button>
        </div>
      </div>
    </div>`;
}

function renderUnlock() {
  const remaining = Math.max(0, state.backoffUntil - Date.now());
  const isThrottled = remaining > 0;
  $app.innerHTML = `
    <div class="center-page page">
      <div class="brand">
        <h1>SoloVault</h1>
        <p>密码库已锁定</p>
      </div>
      <div class="form-card">
        <div class="field">
          <label>主密码</label>
          <div class="input-wrap">
            <input type="password" id="unlock-pw" placeholder="输入主密码" autocomplete="current-password" ${isThrottled ? 'disabled' : ''}>
            <button class="toggle-pw" data-toggle="unlock-pw" aria-label="显示密码">${ICONS.eye}</button>
          </div>
        </div>
        <div id="unlock-error" class="error-msg"></div>
        ${isThrottled ? `<div class="backoff-msg">请等待 ${Math.ceil(remaining / 1000)} 秒后重试</div>` : ''}
        <div class="form-actions">
          <button class="btn btn-primary" id="unlock-btn" data-action="unlock" ${isThrottled ? 'disabled' : ''}>
            ${isThrottled ? '请等待...' : '解锁'}
          </button>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center">
          <button class="link-btn" data-action="show-import-unlock">${ICONS.upload} 导入 Vault 文件</button>
          <button class="link-btn" data-action="show-recovery-reset">${ICONS.key} 使用恢复码重设主密码</button>
        </div>
        <div class="danger-zone">
          <p>以下操作不可恢复</p>
          <button class="btn btn-danger btn-sm" data-action="show-wipe">清空本地数据</button>
        </div>
      </div>
    </div>`;

  const pwInput = document.getElementById('unlock-pw');
  if (pwInput && !isThrottled) {
    pwInput.focus();
  }
  if (isThrottled) scheduleBackoffCountdown();
}

function renderDashboard() {
  const query = state.searchQuery.toLowerCase();
  const filtered = query
    ? state.plain.entries.filter(e =>
        (e.title || '').toLowerCase().includes(query) ||
        (e.username || '').toLowerCase().includes(query) ||
        (e.url || '').toLowerCase().includes(query)
      )
    : state.plain.entries;

  const isEmpty = state.plain.entries.length === 0;
  const noResults = query && filtered.length === 0;

  $app.innerHTML = `
    <div class="page">
      <div class="toolbar">
        <button class="btn btn-ghost" data-action="lock">${ICONS.lock} 锁定</button>
        <div class="search-box">
          ${ICONS.search}
          <input type="text" id="search-input" placeholder="搜索标题、用户名、网址..." value="${escapeAttr(state.searchQuery)}">
        </div>
        <button class="btn btn-primary" data-action="add-entry">${ICONS.plus} 新增</button>
      </div>
      <div class="toolbar-secondary">
        <button class="btn btn-sm" data-action="export-vault">${ICONS.download} 导出 Vault 文件</button>
        <button class="btn btn-sm" data-action="import-vault">${ICONS.upload} 导入 Vault 文件</button>
        <button class="btn btn-sm" data-action="bulk-edit">${ICONS.edit} 批量编辑</button>
      </div>
      ${isEmpty ? `
        <div class="empty-state">
          <p>暂无条目</p>
          <button class="btn btn-primary" data-action="add-entry">${ICONS.plus} 新增条目</button>
          <button class="btn" data-action="import-vault">${ICONS.upload} 导入 Vault 文件</button>
        </div>
      ` : noResults ? `
        <div class="empty-state">
          <p>没有匹配结果</p>
          <button class="btn btn-sm" data-action="clear-search">清空搜索</button>
        </div>
      ` : `
        <div class="entry-list">
          ${filtered.map(e => renderEntryCard(e)).join('')}
        </div>
      `}
    </div>`;

  const searchInput = document.getElementById('search-input');
  if (searchInput && state.searchQuery) {
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }
  resetIdleTimer();
}

function renderEntryCard(entry) {
  const masked = state.revealedPasswords.has(entry.id) ? '' : 'masked';
  const pwDisplay = state.revealedPasswords.has(entry.id) ? escapeHtml(entry.password) : '••••••••';
  const title = entry.title || (entry.url ? getHostname(entry.url) : '未命名条目');
  const urlLine = entry.url ? `<div class="entry-url">${escapeHtml(entry.url)}</div>` : '';
  const noteLine = entry.note ? `<div class="note-preview">${escapeHtml(entry.note)}</div>` : '';

  return `
    <div class="entry-card" data-entry-id="${entry.id}">
      <div class="entry-header">
        <div class="entry-title">${escapeHtml(title)}</div>
        <div class="entry-actions">
          <button class="icon-btn" data-action="edit-entry" data-id="${entry.id}" aria-label="编辑">${ICONS.pencil}</button>
          <button class="icon-btn icon-btn-danger" data-action="delete-entry" data-id="${entry.id}" aria-label="删除">${ICONS.trash}</button>
        </div>
      </div>
      ${urlLine}
      <div class="entry-row">
        <span class="entry-row-label">用户名</span>
        <span class="entry-row-value">${escapeHtml(entry.username)}</span>
        <div class="entry-row-actions">
          <button class="icon-btn" data-action="copy-username" data-id="${entry.id}" aria-label="复制用户名">${ICONS.copy}</button>
        </div>
      </div>
      <div class="entry-row">
        <span class="entry-row-label">密码</span>
        <span class="entry-row-value ${masked}" data-pw-display="${entry.id}">${pwDisplay}</span>
        <div class="entry-row-actions">
          <button class="icon-btn" data-action="toggle-pw" data-id="${entry.id}" aria-label="显示密码">${state.revealedPasswords.has(entry.id) ? ICONS.eyeOff : ICONS.eye}</button>
          <button class="icon-btn" data-action="copy-password" data-id="${entry.id}" aria-label="复制密码">${ICONS.copy}</button>
        </div>
      </div>
      ${noteLine}
    </div>`;
}

function showEntryEditor(entry = null) {
  const isEdit = !!entry;
  const title = isEdit ? '编辑条目' : '新增条目';
  const v = entry || { title: '', username: '', password: '', url: '', note: '' };

  showModal(`
    <div class="modal-header">
      <h3>${title}</h3>
      <button class="modal-close" data-action="close-modal" aria-label="关闭">${ICONS.x}</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label>标题</label>
        <div class="input-wrap">
          <input type="text" id="ed-title" value="${escapeAttr(v.title)}" placeholder="可选，留空则取网址域名">
        </div>
      </div>
      <div class="field">
        <label>用户名 <span class="required">*</span></label>
        <div class="input-wrap">
          <input type="text" id="ed-username" value="${escapeAttr(v.username)}" placeholder="必填">
        </div>
      </div>
      <div class="field">
        <label>密码 <span class="required">*</span></label>
        <div class="input-wrap">
          <input type="password" id="ed-password" value="${escapeAttr(v.password)}" placeholder="必填">
          <button class="toggle-pw" data-toggle="ed-password" aria-label="显示密码">${ICONS.eye}</button>
        </div>
      </div>
      <div class="field">
        <label>网址</label>
        <div class="input-wrap">
          <input type="text" id="ed-url" value="${escapeAttr(v.url || '')}" placeholder="可选">
        </div>
      </div>
      <div class="field">
        <label>备注</label>
        <div class="input-wrap">
          <input type="text" id="ed-note" value="${escapeAttr(v.note || '')}" placeholder="可选">
        </div>
      </div>
      <div id="ed-error" class="error-msg"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="close-modal">取消</button>
      <button class="btn btn-primary" data-action="save-entry" data-edit-id="${isEdit ? entry.id : ''}">保存</button>
    </div>`);

  setTimeout(() => {
    const first = document.getElementById(isEdit ? 'ed-title' : 'ed-username');
    if (first) first.focus();
  }, 100);
}

function showBulkEditor() {
  const text = entriesToBulkText(state.plain.entries);

  showModal(`
    <div class="modal-header">
      <h3>批量编辑</h3>
      <button class="modal-close" data-action="close-modal" aria-label="关闭">${ICONS.x}</button>
    </div>
    <div class="modal-body bulk-editor">
      <textarea id="bulk-text" placeholder="title: 微博&#10;username: user&#10;password: pass&#10;url: https://weibo.com&#10;note: 备注&#10;&#10;title: 豆瓣&#10;username: user2&#10;password: pass2">${escapeHtml(text)}</textarea>
      <div id="bulk-result" class="bulk-result"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="close-modal">取消</button>
      <button class="btn" data-action="bulk-parse">解析</button>
      <button class="btn btn-primary" id="bulk-save-btn" data-action="bulk-save" disabled>保存覆盖</button>
    </div>`);
}

function showConfirmDialog({ title, message, confirmText, confirmAction, dangerInput = null }) {
  const dangerHtml = dangerInput
    ? `<p>请输入 <strong>${dangerInput}</strong> 以确认</p>
       <input class="danger-input" id="confirm-danger-input" placeholder="${dangerInput}" autocomplete="off">`
    : '';

  showModal(`
    <div class="modal-header">
      <h3>${title}</h3>
      <button class="modal-close" data-action="close-modal" aria-label="关闭">${ICONS.x}</button>
    </div>
    <div class="confirm-body">
      <p>${message}</p>
      ${dangerHtml}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="close-modal">取消</button>
      <button class="btn btn-danger" data-action="${confirmAction}" ${dangerInput ? 'disabled' : ''} id="confirm-action-btn">${confirmText}</button>
    </div>`);

  if (dangerInput) {
    const input = document.getElementById('confirm-danger-input');
    const btn = document.getElementById('confirm-action-btn');
    if (input && btn) {
      input.focus();
      input.addEventListener('input', () => {
        btn.disabled = input.value.toUpperCase() !== dangerInput;
      });
    }
  }
}

function showRecoveryResetModal() {
  showModal(`
    <div class="modal-header">
      <h3>使用恢复码重设主密码</h3>
      <button class="modal-close" data-action="close-modal" aria-label="关闭">${ICONS.x}</button>
    </div>
    <div class="modal-body">
      <div class="field">
        <label>恢复码</label>
        <div class="input-wrap">
          <input type="text" id="reset-recovery" placeholder="输入恢复码" autocomplete="off">
        </div>
      </div>
      <div class="field">
        <label>新主密码</label>
        <div class="input-wrap">
          <input type="password" id="reset-new-pw" placeholder="至少 8 位" autocomplete="new-password">
          <button class="toggle-pw" data-toggle="reset-new-pw" aria-label="显示密码">${ICONS.eye}</button>
        </div>
      </div>
      <div id="reset-error" class="error-msg"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" data-action="close-modal">取消</button>
      <button class="btn btn-primary" data-action="do-recovery-reset">重设主密码</button>
    </div>`);
}

async function init() {
  try {
    const exists = await hasLocalVault();
    state.page = exists ? 'unlock' : 'onboarding';
    if (exists) {
      state.vaultFile = await readLocalVault();
    }
  } catch {
    state.page = 'onboarding';
  }
  render();
}

async function handleCreateVault() {
  const pw1 = document.getElementById('ob-pw1').value;
  const pw2 = document.getElementById('ob-pw2').value;
  const errEl = document.getElementById('ob-pw-error');

  if (pw1.length < 8) {
    errEl.textContent = '主密码至少需要 8 位';
    return;
  }
  if (pw1 !== pw2) {
    errEl.textContent = '两次输入的主密码不一致';
    return;
  }

  const btn = document.getElementById('ob-create-btn');
  btn.classList.add('loading');
  btn.disabled = true;
  errEl.textContent = '';

  try {
    const { vaultFile, recoveryCode } = await createVault(pw1);
    state.vaultFile = vaultFile;

    document.getElementById('ob-create-form').classList.add('hidden');
    document.getElementById('ob-recovery').classList.remove('hidden');
    document.getElementById('ob-recovery-code').textContent = recoveryCode;
    state._pendingRecoveryCode = recoveryCode;
  } catch (e) {
    errEl.textContent = '创建失败：' + e.message;
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

async function handleUnlock() {
  const pw = document.getElementById('unlock-pw').value;
  if (!pw) return;

  const btn = document.getElementById('unlock-btn');
  const errEl = document.getElementById('unlock-error');
  btn.classList.add('loading');
  btn.disabled = true;
  errEl.textContent = '';

  try {
    const { dek, plain } = await unlockWithPassword(pw, state.vaultFile);
    state.dek = dek;
    state.plain = plain;
    state.page = 'dashboard';
    state.backoffUntil = 0;
    state.revealedPasswords.clear();
    render();
    startAutoLock();
  } catch (e) {
    if (e.message === 'PASSWORD_INCORRECT') {
      errEl.textContent = '无法解锁，请检查主密码。';
      applyBackoff();
    } else {
      errEl.textContent = '解锁失败，请重试。';
    }
    btn.classList.remove('loading');
    btn.disabled = false;
    const pwInput = document.getElementById('unlock-pw');
    if (pwInput) {
      pwInput.value = '';
      pwInput.focus();
      pwInput.parentElement.style.animation = 'shake 0.4s ease';
      setTimeout(() => { pwInput.parentElement.style.animation = ''; }, 400);
    }
  }
}

function applyBackoff() {
  const now = Date.now();
  if (state.backoffUntil <= now) {
    state.backoffUntil = now + 1000;
  } else {
    const current = state.backoffUntil - now;
    state.backoffUntil = now + Math.min(current * 2, 30000);
  }
  render();
}

function scheduleBackoffCountdown() {
  if (state.backoffTimer) clearInterval(state.backoffTimer);
  state.backoffTimer = setInterval(() => {
    if (Date.now() >= state.backoffUntil) {
      clearInterval(state.backoffTimer);
      state.backoffTimer = null;
      render();
      const pwInput = document.getElementById('unlock-pw');
      if (pwInput) pwInput.focus();
    } else {
      const remaining = Math.ceil((state.backoffUntil - Date.now()) / 1000);
      const msgEl = document.querySelector('.backoff-msg');
      const btn = document.getElementById('unlock-btn');
      if (msgEl) msgEl.textContent = `请等待 ${remaining} 秒后重试`;
      if (btn) { btn.textContent = `请等待 ${remaining}s`; btn.disabled = true; }
    }
  }, 500);
}

function handleSaveEntry(editId) {
  const username = document.getElementById('ed-username').value.trim();
  const password = document.getElementById('ed-password').value;
  const title = document.getElementById('ed-title').value.trim();
  const url = document.getElementById('ed-url').value.trim();
  const note = document.getElementById('ed-note').value.trim();
  const errEl = document.getElementById('ed-error');

  if (!username || !password) {
    errEl.textContent = '用户名和密码为必填项';
    return;
  }

  const now = Date.now();
  if (editId) {
    const idx = state.plain.entries.findIndex(e => e.id === editId);
    if (idx >= 0) {
      Object.assign(state.plain.entries[idx], {
        title: title || (url ? getHostname(url) : ''),
        username,
        password,
        url: url || null,
        note: note || null,
        updatedAt: now
      });
    }
  } else {
    state.plain.entries.push({
      id: crypto.randomUUID(),
      title: title || (url ? getHostname(url) : ''),
      username,
      password,
      url: url || null,
      note: note || null,
      totpSecret: null,
      createdAt: now,
      updatedAt: now
    });
  }

  saveAndRefresh();
  hideModal();
  toast(editId ? '条目已更新' : '条目已添加', 'success');
}

function handleDeleteEntry(id) {
  const entry = state.plain.entries.find(e => e.id === id);
  if (!entry) return;
  const name = entry.title || '未命名条目';
  showConfirmDialog({
    title: '删除条目',
    message: `确定要删除「${name}」吗？此操作不可恢复。`,
    confirmText: '删除',
    confirmAction: 'do-delete-entry',
  });
  state._pendingDeleteId = id;
}

function handleBulkParse() {
  const text = document.getElementById('bulk-text').value;
  const result = parseBulkText(text);
  const resultEl = document.getElementById('bulk-result');
  const saveBtn = document.getElementById('bulk-save-btn');

  let html = `<div class="result-ok">解析成功：${result.entries.length} 条条目</div>`;
  if (result.errors.length > 0) {
    html += '<ul class="result-errors">';
    result.errors.forEach(e => {
      html += `<li>第 ${e.blockIndex} 块：${e.message}</li>`;
    });
    html += '</ul>';
  }
  resultEl.innerHTML = html;
  saveBtn.disabled = result.entries.length === 0 || result.errors.length > 0;
  state._pendingBulkResult = result;
}

function handleBulkSave() {
  if (!state._pendingBulkResult || state._pendingBulkResult.errors.length > 0) return;

  showConfirmDialog({
    title: '覆盖确认',
    message: '保存将替换当前所有条目，请确认你已经导出过当前数据。',
    confirmText: '保存覆盖',
    confirmAction: 'do-bulk-save',
  });
}

async function handleExportVault() {
  try {
    downloadVault(state.vaultFile);
    toast('Vault 文件已导出', 'success');
  } catch (e) {
    toast('导出失败', 'error');
  }
}

function handleImportVault() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.vault';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const vault = parseVaultFile(text);
      if (state.vaultFile) {
        state._pendingImportVault = vault;
        showConfirmDialog({
          title: '导入确认',
          message: '导入后会替换当前本地密码库。请确认你已经导出过当前数据。',
          confirmText: '确认导入',
          confirmAction: 'do-import-vault',
        });
      } else {
        await writeLocalVault(vault);
        state.vaultFile = vault;
        state.page = 'unlock';
        render();
        toast('Vault 文件已导入，请输入主密码解锁', 'success');
      }
    } catch (e) {
      if (e.message === 'INVALID_JSON') toast('文件格式不是有效的 SoloVault 备份。', 'error');
      else if (e.message === 'UNSUPPORTED_VERSION') toast('当前应用暂不支持此备份版本。', 'error');
      else if (e.message === 'INVALID_FORMAT') toast('文件格式不是有效的 SoloVault 备份。', 'error');
      else toast('导入失败：' + e.message, 'error');
    }
  };
  input.click();
}

function handleImportVaultFromUnlock() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.vault';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const vault = parseVaultFile(text);
      await writeLocalVault(vault);
      state.vaultFile = vault;
      state.page = 'unlock';
      render();
      toast('Vault 文件已导入，请输入主密码解锁', 'success');
    } catch (e) {
      if (e.message === 'INVALID_JSON' || e.message === 'INVALID_FORMAT') {
        toast('文件格式不是有效的 SoloVault 备份。', 'error');
      } else if (e.message === 'UNSUPPORTED_VERSION') {
        toast('当前应用暂不支持此备份版本。', 'error');
      } else {
        toast('导入失败：' + e.message, 'error');
      }
    }
  };
  input.click();
}

async function handleRecoveryReset() {
  const recoveryCode = document.getElementById('reset-recovery').value.trim();
  const newPw = document.getElementById('reset-new-pw').value;
  const errEl = document.getElementById('reset-error');

  if (!recoveryCode || newPw.length < 8) {
    errEl.textContent = '请输入恢复码和新主密码（至少 8 位）';
    return;
  }

  try {
    const updated = await resetPasswordWithRecovery(recoveryCode, newPw, state.vaultFile);
    state.vaultFile = updated;
    state.backoffUntil = 0;
    hideModal();
    toast('主密码已重设，请使用新密码解锁', 'success');
    render();
  } catch (e) {
    if (e.message === 'RECOVERY_CODE_INCORRECT') {
      errEl.textContent = '恢复码不正确';
    } else {
      errEl.textContent = '重设失败，请重试';
    }
  }
}

async function handleWipe() {
  try {
    await clearLocalVault();
    state.vaultFile = null;
    lock();
    toast('本地数据已清空', 'success');
  } catch {
    toast('清空失败', 'error');
  }
}

function lock() {
  state.dek = null;
  state.plain = null;
  state.searchQuery = '';
  state.revealedPasswords.clear();
  clearClipboardTimers();
  stopAutoLock();
  state.page = state.vaultFile ? 'unlock' : 'onboarding';
  if (!state.vaultFile) {
    hasLocalVault().then(exists => {
      if (exists) {
        readLocalVault().then(v => {
          state.vaultFile = v;
          state.page = 'unlock';
          render();
        });
      }
    });
  }
  render();
}

async function saveAndRefresh() {
  try {
    state.vaultFile = await savePlainVault(state.dek, state.vaultFile, state.plain);
    render();
  } catch (e) {
    toast('保存失败', 'error');
  }
}

function copyToClipboard(text, label) {
  navigator.clipboard.writeText(text).then(() => {
    toast(`已复制${label}，30 秒后尝试清空剪贴板`, 'success');
    scheduleClipboardClear(label);
  }).catch(() => {
    toast('复制失败，请手动复制', 'error');
  });
}

function scheduleClipboardClear(label) {
  if (state.clipboardTimers.has(label)) {
    clearTimeout(state.clipboardTimers.get(label));
  }
  const timer = setTimeout(() => {
    navigator.clipboard.writeText('').catch(() => {});
    state.clipboardTimers.delete(label);
  }, 30000);
  state.clipboardTimers.set(label, timer);
}

function clearClipboardTimers() {
  state.clipboardTimers.forEach(t => clearTimeout(t));
  state.clipboardTimers.clear();
  navigator.clipboard.writeText('').catch(() => {});
}

function startAutoLock() {
  stopAutoLock();
  state.autoLockTimer = setInterval(() => {}, 60000);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  document.addEventListener('mousemove', resetIdleTimer);
  document.addEventListener('keydown', resetIdleTimer);
  document.addEventListener('touchstart', resetIdleTimer);
  resetIdleTimer();
}

function stopAutoLock() {
  if (state.autoLockTimer) { clearInterval(state.autoLockTimer); state.autoLockTimer = null; }
  if (state.idleTimer) { clearTimeout(state.idleTimer); state.idleTimer = null; }
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  document.removeEventListener('mousemove', resetIdleTimer);
  document.removeEventListener('keydown', resetIdleTimer);
  document.removeEventListener('touchstart', resetIdleTimer);
}

let hiddenAt = 0;
function handleVisibilityChange() {
  if (document.hidden) {
    hiddenAt = Date.now();
  } else {
    if (hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) {
      if (state.dek) lock();
    }
    hiddenAt = 0;
    resetIdleTimer();
  }
}

function resetIdleTimer() {
  if (state.idleTimer) clearTimeout(state.idleTimer);
  if (!state.dek) return;
  state.idleTimer = setTimeout(() => {
    if (state.dek) lock();
  }, 15 * 60 * 1000);
}

function getHostname(url) {
  try {
    const u = url.startsWith('http') ? url : 'https://' + url;
    return new URL(u).hostname;
  } catch {
    return url;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) {
    const inputId = toggle.dataset.toggle;
    const input = document.getElementById(inputId);
    if (input) {
      if (input.type === 'password') {
        input.type = 'text';
        toggle.innerHTML = ICONS.eyeOff;
      } else {
        input.type = 'password';
        toggle.innerHTML = ICONS.eye;
      }
    }
    return;
  }

  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;

  switch (action) {
    case 'ob-create':
      document.getElementById('ob-choices').classList.add('hidden');
      document.getElementById('ob-create-form').classList.remove('hidden');
      setTimeout(() => document.getElementById('ob-pw1')?.focus(), 50);
      break;

    case 'ob-import':
      handleImportVaultFromUnlock();
      break;

    case 'ob-back':
      document.getElementById('ob-create-form').classList.add('hidden');
      document.getElementById('ob-choices').classList.remove('hidden');
      break;

    case 'ob-do-create':
      handleCreateVault();
      break;

    case 'ob-copy-recovery':
      if (state._pendingRecoveryCode) {
        navigator.clipboard.writeText(state._pendingRecoveryCode)
          .then(() => toast('恢复码已复制', 'success'))
          .catch(() => toast('复制失败', 'error'));
      }
      break;

    case 'ob-download-recovery':
      if (state._pendingRecoveryCode) {
        const blob = new Blob([state._pendingRecoveryCode], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'solovault-recovery-code.txt';
        a.click();
        URL.revokeObjectURL(url);
      }
      break;

    case 'ob-continue':
      state._pendingRecoveryCode = null;
      state.page = 'unlock';
      render();
      break;

    case 'unlock':
      handleUnlock();
      break;

    case 'lock':
      lock();
      break;

    case 'add-entry':
      showEntryEditor();
      break;

    case 'edit-entry': {
      const id = target.dataset.id;
      const entry = state.plain.entries.find(e => e.id === id);
      if (entry) showEntryEditor(entry);
      break;
    }

    case 'delete-entry': {
      const id = target.dataset.id;
      handleDeleteEntry(id);
      break;
    }

    case 'save-entry': {
      const editId = target.dataset.editId || null;
      handleSaveEntry(editId);
      break;
    }

    case 'toggle-pw': {
      const id = target.dataset.id;
      if (state.revealedPasswords.has(id)) {
        state.revealedPasswords.delete(id);
      } else {
        state.revealedPasswords.add(id);
      }
      render();
      break;
    }

    case 'copy-username': {
      const id = target.dataset.id;
      const entry = state.plain.entries.find(e => e.id === id);
      if (entry) copyToClipboard(entry.username, '用户名');
      break;
    }

    case 'copy-password': {
      const id = target.dataset.id;
      const entry = state.plain.entries.find(e => e.id === id);
      if (entry) copyToClipboard(entry.password, '密码');
      break;
    }

    case 'export-vault':
      handleExportVault();
      break;

    case 'import-vault':
      handleImportVault();
      break;

    case 'bulk-edit':
      showBulkEditor();
      break;

    case 'bulk-parse':
      handleBulkParse();
      break;

    case 'bulk-save':
      handleBulkSave();
      break;

    case 'do-bulk-save':
      if (state._pendingBulkResult) {
        state.plain.entries = state._pendingBulkResult.entries;
        state._pendingBulkResult = null;
        saveAndRefresh();
        hideModal();
        toast('条目已批量更新', 'success');
      }
      break;

    case 'do-delete-entry':
      if (state._pendingDeleteId) {
        state.plain.entries = state.plain.entries.filter(e => e.id !== state._pendingDeleteId);
        state._pendingDeleteId = null;
        saveAndRefresh();
        hideModal();
        toast('条目已删除', 'success');
      }
      break;

    case 'do-import-vault':
      if (state._pendingImportVault) {
        writeLocalVault(state._pendingImportVault).then(() => {
          state.vaultFile = state._pendingImportVault;
          state._pendingImportVault = null;
          state.dek = null;
          state.plain = null;
          state.revealedPasswords.clear();
          clearClipboardTimers();
          stopAutoLock();
          hideModal();
          state.page = 'unlock';
          render();
          toast('Vault 文件已导入，请输入主密码解锁', 'success');
        }).catch(() => {
          toast('导入失败', 'error');
        });
      }
      break;

    case 'show-wipe':
      showConfirmDialog({
        title: '清空本地数据',
        message: '此操作将永久删除本地所有密码数据，不可恢复。',
        confirmText: '清空',
        confirmAction: 'do-wipe',
        dangerInput: 'WIPE',
      });
      break;

    case 'do-wipe':
      hideModal();
      handleWipe();
      break;

    case 'show-recovery-reset':
      showRecoveryResetModal();
      break;

    case 'do-recovery-reset':
      handleRecoveryReset();
      break;

    case 'show-import-unlock':
      handleImportVaultFromUnlock();
      break;

    case 'close-modal':
      hideModal();
      break;

    case 'clear-search':
      state.searchQuery = '';
      render();
      document.getElementById('search-input')?.focus();
      break;
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'ob-pw1') {
    const strength = getPasswordStrength(e.target.value);
    const el = document.getElementById('ob-strength');
    if (!e.target.value) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="strength-bar">
        <div class="strength-bar-fill" style="width:${strength.score * 20}%;background:${strength.color}"></div>
      </div>
      <div class="strength-label" style="color:${strength.color}">密码强度：${strength.label}</div>`;

    const pw2 = document.getElementById('ob-pw2');
    const errEl = document.getElementById('ob-pw-error');
    if (pw2 && pw2.value && pw2.value !== e.target.value) {
      errEl.textContent = '两次输入的主密码不一致';
    } else if (errEl) {
      errEl.textContent = '';
    }
  }

  if (e.target.id === 'ob-pw2') {
    const pw1 = document.getElementById('ob-pw1');
    const errEl = document.getElementById('ob-pw-error');
    if (pw1 && pw1.value !== e.target.value) {
      errEl.textContent = '两次输入的主密码不一致';
    } else if (errEl) {
      errEl.textContent = '';
    }
  }

  if (e.target.id === 'search-input') {
    state.searchQuery = e.target.value;
    renderDashboard();
    const input = document.getElementById('search-input');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'ob-recovery-confirmed') {
    const btn = document.getElementById('ob-continue-btn');
    if (btn) btn.disabled = !e.target.checked;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (e.target.id === 'unlock-pw') {
      handleUnlock();
    }
    if (e.target.id === 'ob-pw2') {
      handleCreateVault();
    }
  }
  if (e.key === 'Escape') {
    if (!$modalOverlay.classList.contains('hidden')) {
      hideModal();
    }
  }
});

$modalOverlay.addEventListener('click', (e) => {
  if (e.target === $modalOverlay) hideModal();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}

init();
