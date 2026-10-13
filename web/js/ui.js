// 共用的畫面小工具。

export const view = document.getElementById('view');

export const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

const svg = (paths) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
export const ICONS = {
  scan: svg('<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M7 12h10"/>'),
};

const scripts = {};
export function loadScriptOnce(src) {
  scripts[src] ||= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => {
      delete scripts[src];
      reject(new Error('無法載入 ' + src));
    };
    document.head.appendChild(el);
  });
  return scripts[src];
}

// 展品標籤 QR Code 的內容：系統網址加上 ?item=編號，手機相機掃描就會開啟並放進清單。
export function itemUrl(itemId) {
  return new URL(`./?item=${encodeURIComponent(itemId)}`, location.href).href;
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastTimer = null;
export function toast(message, kind = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = kind === 'error' ? 'toast error' : 'toast';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'error' ? 6000 : 2500);
}

// 依手機本地時間回傳 yyyy-MM-dd。
export function datePlus(days) {
  return new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE');
}

const STATUS_CLASS = { 在庫: 'tag-ok', 借出: 'tag-info', 送修: 'tag-warn', 遺失: 'tag-danger', 報廢: '' };

export function statusTag(status, overdue = false) {
  if (overdue) return '<span class="tag tag-danger">逾期</span>';
  return `<span class="tag ${STATUS_CLASS[status] ?? ''}">${esc(status)}</span>`;
}

export const loadingHtml = '<p class="empty">載入中…</p>';

export function errorHtml(message) {
  return `<section class="card"><p class="notice notice-warn">${esc(message)}</p>
    <button class="btn btn-block" type="button" onclick="location.reload()">重新載入</button></section>`;
}

// 送出期間鎖住按鈕，避免重複送出。
export async function withBusy(button, label, fn) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

export function stripDomain(email, domain) {
  const suffix = '@' + domain;
  return domain && email.toLowerCase().endsWith(suffix.toLowerCase()) ? email.slice(0, -suffix.length) : email;
}

/**
 * 借用者欄位（Email、姓名），借用與移轉共用。people 會出現在 Email 的下拉建議中，選了會自動帶入姓名。
 */
export function borrowerFieldsHtml({ domain, people, email = '', name = '' }) {
  const shown = stripDomain(email, domain);
  const input = domain
    ? `<div class="input-group">
         <input id="f-email" name="email" inputmode="email" autocomplete="email" autocapitalize="off" required
           list="people" placeholder="Email 前綴" value="${esc(shown)}">
         <span class="addon">@${esc(domain)}</span>
       </div>`
    : `<input id="f-email" name="email" type="email" autocomplete="email" required list="people"
         placeholder="name@company.com" value="${esc(shown)}">`;
  return `
    <div class="field">
      <label for="f-email">Email</label>
      ${input}
      ${domain ? '<div class="hint">只需輸入 @ 前面的部分</div>' : ''}
      <datalist id="people">${people.map((p) => `<option value="${esc(stripDomain(p.email, domain))}">${esc(p.name)}</option>`).join('')}</datalist>
    </div>
    <div class="field">
      <label for="f-name">姓名</label>
      <input id="f-name" name="name" autocomplete="name" required value="${esc(name)}">
    </div>`;
}

export function bindBorrowerFields(form, { domain, people }) {
  const email = form.elements.email;
  const name = form.elements.name;
  email.addEventListener('change', () => {
    const typed = email.value.trim().toLowerCase();
    const match = people.find((p) => p.email.toLowerCase() === typed || stripDomain(p.email, domain).toLowerCase() === typed);
    if (match) name.value = match.name;
  });
}

export function reasonFieldsHtml(reasons, selected = '') {
  return `
    <div class="field">
      <label for="f-reason">借用事由</label>
      <select id="f-reason" name="reason" required>
        <option value="">請選擇</option>
        ${reasons.map((r) => `<option ${r === selected ? 'selected' : ''}>${esc(r)}</option>`).join('')}
      </select>
      <input name="reasonOther" class="mt" placeholder="請說明借用事由" aria-label="其他借用事由" hidden>
    </div>
    <div class="field">
      <label for="f-date">預計歸還日期</label>
      <input id="f-date" name="expected" type="date" required min="${datePlus(0)}" value="${datePlus(7)}">
    </div>`;
}

export function bindReasonFields(form) {
  const select = form.elements.reason;
  const other = form.elements.reasonOther;
  select.addEventListener('change', () => {
    other.hidden = select.value !== '其他';
    other.required = !other.hidden;
  });
}

export function readReason(form) {
  const { reason, reasonOther } = form.elements;
  return reason.value === '其他' && reasonOther.value.trim() ? `其他：${reasonOther.value.trim()}` : reason.value;
}
