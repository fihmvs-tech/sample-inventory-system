// 管理者畫面：登入、展品列表、單品詳情與履歷、新增／編輯、移轉、催還。

import { api, getConfig, clearConfig, isDemo } from '../api.js';
import * as store from '../store.js';
import { current, go, route } from '../router.js';
import {
  view, esc, toast, statusTag, loadingHtml, withBusy, QR_LIB, loadScriptOnce, itemUrl,
  borrowerFieldsHtml, bindBorrowerFields, reasonFieldsHtml, bindReasonFields, readReason,
} from '../ui.js';

const FILTERS = [
  ['all', '全部', () => true],
  ['in', '在庫', (i) => i.status === '在庫'],
  ['out', '借出', (i) => i.status === '借出'],
  ['overdue', '逾期', (i) => i.overdue],
  ['repair', '送修', (i) => i.status === '送修'],
  ['other', '遺失／報廢', (i) => i.status === '遺失' || i.status === '報廢'],
];
const listState = { filter: 'all', search: '' };

function logout(message) {
  store.update({ adminKey: '', operatorName: '' });
  clearConfig();
  if (message) toast(message, 'error');
}

// 管理者 API 失敗時，若是密碼失效就回到登入畫面。
async function adminApi(action, params) {
  try {
    return await api(action, params);
  } catch (err) {
    if (/管理者(密碼|金鑰)/.test(err.message)) {
      logout(err.message);
      go('#/admin');
    }
    throw err;
  }
}

function requireLogin() {
  if (store.get().adminKey) return true;
  go('#/admin');
  return false;
}

// ---- 登入 ----

const ICON_ATTRS = 'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const EYE_ICON = `<svg ${ICON_ATTRS}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_ICON = `<svg ${ICON_ATTRS}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-11-7-11-7a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function login() {
  view.innerHTML = `
    <form class="card" id="login">
      <h2>管理者登入</h2>
      <p class="small muted">管理者可以管理展品主檔、代同仁登記借用、查詢展品履歷與寄送催還信。</p>
      ${isDemo ? '<p class="notice">示範模式的管理者密碼是 <code>demo</code>。</p>' : ''}
      <div class="field">
        <label for="a-key">管理者密碼</label>
        <div class="password-field">
          <input id="a-key" name="key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required>
          <button class="password-toggle" type="button" id="a-key-toggle" aria-controls="a-key" aria-pressed="false" aria-label="顯示密碼" title="顯示密碼">${EYE_ICON}</button>
        </div>
      </div>
      <div class="field">
        <label for="a-name">你的名字</label>
        <input id="a-name" name="name" required placeholder="會記錄在操作紀錄中">
      </div>
      <button class="btn btn-primary btn-block" type="submit">登入</button>
    </form>`;
  const form = document.getElementById('login');
  const keyInput = document.getElementById('a-key');
  const toggle = document.getElementById('a-key-toggle');
  toggle.addEventListener('click', () => {
    const show = keyInput.type === 'password';
    keyInput.type = show ? 'text' : 'password';
    toggle.innerHTML = show ? EYE_OFF_ICON : EYE_ICON;
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? '隱藏密碼' : '顯示密碼');
    toggle.title = show ? '隱藏密碼' : '顯示密碼';
    keyInput.focus();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const key = form.elements.key.value.trim();
    const name = form.elements.name.value.trim();
    withBusy(form.querySelector('[type=submit]'), '驗證中…', async () => {
      try {
        await api('verifyAdmin', { adminKey: key });
        store.update({ adminKey: key, operatorName: name });
        clearConfig();
        route();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

// ---- 展品列表 ----

export async function admin() {
  if (!store.get().adminKey) {
    login();
    return;
  }
  const live = current();
  view.innerHTML = loadingHtml;
  const items = await adminApi('listItems');
  if (!live()) return;
  const overdue = items.filter((i) => i.overdue);

  view.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>展品管理</h2><span class="small muted">管理者：${esc(store.get().operatorName)}</span></div>
      <div class="quick-grid">
        <a class="quick quick-primary" href="#/item-edit/new"><b>新增展品</b><span>建立展品，存檔後即可列印標籤</span></a>
        <a class="quick" href="#/borrow/proxy"><b>代填借用</b><span>幫不方便操作的同仁登記借用</span></a>
        <a class="quick" href="labels.html"><b>列印展品標籤</b><span>批次列印貼在展品上的 QR Code</span></a>
        <a class="quick" href="entry-qr.html"><b>系統入口 QR Code</b><span>列印海報或分享到 LINE 群組</span></a>
      </div>
    </section>
    ${overdue.length ? `
      <section class="card">
        <div class="card-head"><h2>逾期未還</h2><span class="tag tag-danger">${overdue.length} 件</span></div>
        <p class="small muted">系統每天會自動寄催還信給借用者，也可以現在立即寄送。</p>
        <button class="btn btn-block" type="button" id="send-reminders">立即寄送催還信</button>
      </section>` : ''}
    <section class="card">
      <input type="search" id="search" placeholder="搜尋編號、名稱、借用者" aria-label="搜尋展品" value="${esc(listState.search)}">
      <div class="chips mt" role="group" aria-label="篩選">
        ${FILTERS.map(([key, label, fn]) => `
          <button class="chip" type="button" data-filter="${key}" aria-pressed="${listState.filter === key}">
            ${label} ${items.filter(fn).length}</button>`).join('')}
      </div>
      <ul class="list" id="item-list"></ul>
    </section>
    <section class="card">
      <div class="btn-row">
        <button class="btn" type="button" id="logout">登出管理者</button>
        ${isDemo ? '<button class="btn btn-danger" type="button" id="reset-demo">重設示範資料</button>' : ''}
      </div>
    </section>`;

  const renderList = () => {
    const match = FILTERS.find(([key]) => key === listState.filter)[2];
    const q = listState.search.trim().toLowerCase();
    const shown = items.filter(match).filter((i) => !q || [i.item_id, i.name, i.category, i.location, i.current_borrower_name, i.current_borrower_email]
      .some((v) => String(v || '').toLowerCase().includes(q)));
    document.getElementById('item-list').innerHTML = shown.length
      ? shown.map((i) => `
          <li><a class="row-link" href="#/item/${encodeURIComponent(i.item_id)}">
            <div class="main">
              <div class="title"><span class="item-id">${esc(i.item_id)}</span> ${esc(i.name)}</div>
              <div class="sub">${i.status === '借出'
                ? `${esc(i.current_borrower_name)}・預計 ${esc(i.expected_return_date)}`
                : esc([i.category, i.location].filter(Boolean).join('・'))}</div>
            </div>
            ${statusTag(i.status, i.overdue)}
          </a></li>`).join('')
      : '<li><p class="empty">沒有符合的展品</p></li>';
  };
  renderList();

  document.getElementById('search').addEventListener('input', (e) => {
    listState.search = e.target.value;
    renderList();
  });
  view.querySelectorAll('[data-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      listState.filter = chip.dataset.filter;
      view.querySelectorAll('[data-filter]').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      renderList();
    });
  });
  document.getElementById('logout').addEventListener('click', () => {
    logout();
    route();
  });
  const reset = document.getElementById('reset-demo');
  if (reset) {
    reset.addEventListener('click', async () => {
      if (!confirm('要清除這台裝置上的所有示範資料嗎？')) return;
      const { resetDemo } = await import('../demo/demo-backend.js');
      resetDemo();
      store.update({ borrow: [], ret: [], adminKey: '', operatorName: '' });
      location.reload();
    });
  }
  const send = document.getElementById('send-reminders');
  if (send) {
    send.addEventListener('click', () => withBusy(send, '寄送中…', async () => {
      try {
        const res = await adminApi('sendReminders');
        toast(`已寄出 ${res.sent.length} 封催還信（共 ${res.overdueItems} 件逾期）${isDemo ? '\n示範模式不會真的寄出信件' : ''}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    }));
  }
}

// ---- 單品詳情與履歷 ----

const STATUS_ACTIONS = {
  在庫: [['送修', '送修'], ['遺失', '標記遺失'], ['報廢', '報廢']],
  送修: [['在庫', '修好，恢復在庫']],
  遺失: [['在庫', '已找回，恢復在庫']],
  報廢: [['在庫', '恢復在庫']],
};

export async function item(itemId) {
  if (!requireLogin()) return;
  const live = current();
  view.innerHTML = loadingHtml;
  const { item: it, logs } = await adminApi('getHistory', { itemId });
  if (!live()) return;

  const actions = (STATUS_ACTIONS[it.status] || [])
    .map(([status, label]) => `<button class="btn" type="button" data-status="${status}">${label}</button>`).join('');

  view.innerHTML = `
    <a href="#/admin" class="small">← 返回展品列表</a>
    <section class="card mt">
      <div class="card-head">
        <h2><span class="item-id">${esc(it.item_id)}</span> ${esc(it.name)}</h2>
        ${statusTag(it.status, it.overdue)}
      </div>
      <dl class="info">
        <dt>狀態</dt><dd>${esc(it.status)}</dd>
        ${it.category ? `<dt>類別</dt><dd>${esc(it.category)}</dd>` : ''}
        ${it.location ? `<dt>存放位置</dt><dd>${esc(it.location)}</dd>` : ''}
        ${it.status === '借出' ? `
          <dt>借用者</dt><dd>${esc(it.current_borrower_name)}<br><span class="small muted">${esc(it.current_borrower_email)}</span></dd>
          <dt>借用單</dt><dd>${esc(it.current_loan_id)}</dd>
          <dt>預計歸還</dt><dd>${esc(it.expected_return_date)} ${it.overdue ? statusTag('', true) : ''}</dd>` : ''}
        ${it.note ? `<dt>備註</dt><dd>${esc(it.note)}</dd>` : ''}
      </dl>
      <div class="btn-row">
        <a class="btn" href="#/item-edit/${encodeURIComponent(it.item_id)}">編輯資料</a>
        ${actions}
        ${it.status === '借出' ? '<button class="btn" type="button" id="show-transfer">移轉／延長借用</button>' : ''}
        ${it.status !== '借出' ? '<button class="btn btn-danger" type="button" id="show-delete">刪除展品</button>' : ''}
      </div>
    </section>
    <div id="action-box"></div>
    <section class="card item-label">
      <div class="label-preview">
        <div class="qr" id="item-qr" role="img" aria-label="${esc(it.item_id)} 的 QR Code"></div>
        <div class="label-id">${esc(it.item_id)}</div>
        <div class="label-name">${esc(it.name)}</div>
      </div>
      <div class="label-side">
        <h2>展品標籤</h2>
        <p class="small muted">貼在展品上，同仁用手機相機一掃就能借用或歸還。</p>
        <a class="btn btn-primary" href="labels.html?ids=${encodeURIComponent(it.item_id)}">列印這件的標籤</a>
      </div>
    </section>
    <div id="transfer-box"></div>
    <section class="card">
      <h2>異動履歷</h2>
      ${logs.length ? `<ul class="timeline">${logs.map((l) => `
        <li>
          <div><span class="tag tag-info">${esc(l.action)}</span> ${esc(l.borrower_email)}</div>
          ${l.detail ? `<div class="small">${esc(l.detail)}</div>` : ''}
          <div class="when">${esc(l.timestamp)}・${esc(l.operator)}${l.loan_id ? `・${esc(l.loan_id)}` : ''}</div>
        </li>`).join('')}</ul>` : '<p class="empty">尚無紀錄</p>'}
    </section>`;

  loadScriptOnce(QR_LIB)
    .then(() => {
      const box = document.getElementById('item-qr');
      if (box) new window.QRCode(box, { text: itemUrl(it.item_id), width: 240, height: 240, correctLevel: window.QRCode.CorrectLevel.M });
    })
    .catch(() => {
      const box = document.getElementById('item-qr');
      if (box) box.textContent = 'QR Code 無法載入，請檢查網路';
    });

  view.querySelectorAll('[data-status]').forEach((button) => {
    button.addEventListener('click', () => statusPanel(it, button.dataset.status));
  });
  const showTransfer = document.getElementById('show-transfer');
  if (showTransfer) showTransfer.addEventListener('click', () => transferForm(it));
  const showDelete = document.getElementById('show-delete');
  if (showDelete) showDelete.addEventListener('click', () => deletePanel(it));
}

const STATUS_HINTS = {
  送修: '例如：螢幕刮傷，送原廠維修',
  遺失: '例如：展覽結束後找不到',
  報廢: '例如：損壞無法修復',
  在庫: '例如：已修好並放回 A 櫃',
};

// 變更狀態前在頁面上確認，並可以順便寫下原因（會記在異動履歷）。
function statusPanel(it, status) {
  const box = document.getElementById('action-box');
  box.innerHTML = `
    <form class="card action-panel" id="status-form" aria-labelledby="status-title">
      <h2 id="status-title">將 ${esc(it.item_id)} 改為「${esc(status)}」</h2>
      <div class="field">
        <label for="s-note">說明（可留空）</label>
        <input id="s-note" name="note" placeholder="${esc(STATUS_HINTS[status] || '')}">
        <div class="hint">會記錄在這件展品的異動履歷中。</div>
      </div>
      <div class="btn-row">
        <button class="btn" type="button" data-cancel>取消</button>
        <button class="btn btn-primary" type="submit">確定改為「${esc(status)}」</button>
      </div>
    </form>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const form = document.getElementById('status-form');
  form.elements.note.focus({ preventScroll: true });
  box.querySelector('[data-cancel]').addEventListener('click', () => { box.innerHTML = ''; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy(form.querySelector('[type=submit]'), '處理中…', async () => {
      try {
        await adminApi('setItemStatus', { itemId: it.item_id, status, note: form.elements.note.value });
        toast(`${it.item_id} 已改為「${status}」`);
        route();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

// 刪除前在頁面上再確認一次，說清楚會發生什麼事。
function deletePanel(it) {
  const box = document.getElementById('action-box');
  box.innerHTML = `
    <section class="card danger-zone" role="alertdialog" aria-labelledby="delete-title">
      <h2 id="delete-title">刪除 ${esc(it.item_id)} ${esc(it.name)}？</h2>
      <ul class="consequences">
        <li>展品會從清單中移除，貼在展品上的 QR 標籤將無法再使用。</li>
        <li>過去的借用紀錄與異動日誌會保留在試算表中。</li>
        <li>刪除後無法復原。如果只是不再使用、想保留資料，請改用「報廢」。</li>
      </ul>
      <div class="btn-row">
        <button class="btn" type="button" data-cancel>取消</button>
        <button class="btn btn-danger-solid" type="button" data-confirm>確定刪除</button>
      </div>
    </section>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  box.querySelector('[data-cancel]').addEventListener('click', () => { box.innerHTML = ''; });
  const confirmButton = box.querySelector('[data-confirm]');
  confirmButton.addEventListener('click', () => withBusy(confirmButton, '刪除中…', async () => {
    try {
      await adminApi('deleteItem', { itemId: it.item_id });
      toast(`已刪除 ${it.item_id} ${it.name}`);
      go('#/admin');
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
}

// 例：日本展覽結束後剩下的展品直接帶去美國 → 移轉給同一人（或其他人），更新事由與預計歸還日。
async function transferForm(it) {
  const cfg = await getConfig();
  const box = document.getElementById('transfer-box');
  box.innerHTML = `
    <form class="card" id="transfer">
      <h2>移轉／延長借用</h2>
      <p class="small muted">原借用單的這件展品會結清為「已移轉」，並開一張新的借用單。借用者可以是同一人。</p>
      ${borrowerFieldsHtml({ domain: cfg.emailDomain, people: cfg.borrowers || [], email: it.current_borrower_email, name: it.current_borrower_name })}
      ${reasonFieldsHtml(cfg.reasons)}
      <button class="btn btn-primary btn-block" type="submit">確認移轉</button>
    </form>`;
  const form = document.getElementById('transfer');
  bindBorrowerFields(form, { domain: cfg.emailDomain, people: cfg.borrowers || [] });
  bindReasonFields(form);
  form.scrollIntoView({ behavior: 'smooth' });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    withBusy(form.querySelector('[type=submit]'), '處理中…', async () => {
      try {
        const res = await adminApi('transfer', {
          itemIds: [it.item_id],
          borrowerEmail: f.email.value,
          borrowerName: f.name.value,
          reason: readReason(form),
          expectedReturnDate: f.expected.value,
        });
        toast(`已移轉到借用單 ${res.loanId}`);
        route();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

// ---- 新增／編輯展品 ----

export async function itemEdit(itemId) {
  if (!requireLogin()) return;
  const isNew = itemId === 'new';
  let it = { item_id: '', name: '', category: '', location: '', note: '' };
  if (!isNew) {
    const live = current();
    view.innerHTML = loadingHtml;
    it = (await adminApi('getHistory', { itemId })).item;
    if (!live()) return;
  }

  view.innerHTML = `
    <a href="${isNew ? '#/admin' : `#/item/${encodeURIComponent(it.item_id)}`}" class="small">← 返回</a>
    <form class="card mt" id="item-form">
      <h2>${isNew ? '新增展品' : '編輯展品'}</h2>
      <div class="field">
        <label for="i-id">展品編號</label>
        <input id="i-id" name="item_id" required autocapitalize="characters" pattern="[A-Za-z0-9._\\-]{1,40}"
          value="${esc(it.item_id)}" ${isNew ? '' : 'readonly'}>
        <div class="hint">英數字、點、底線或連字號，例如 A31。會印在 QR Code 標籤上，建立後不能修改。</div>
      </div>
      <div class="field"><label for="i-name">名稱</label><input id="i-name" name="name" required value="${esc(it.name)}"></div>
      <div class="field"><label for="i-cat">類別</label><input id="i-cat" name="category" value="${esc(it.category)}"></div>
      <div class="field"><label for="i-loc">存放位置</label><input id="i-loc" name="location" value="${esc(it.location)}"></div>
      <div class="field"><label for="i-note">備註</label><textarea id="i-note" name="note">${esc(it.note)}</textarea></div>
      <button class="btn btn-primary btn-block" type="submit">儲存</button>
    </form>`;

  const form = document.getElementById('item-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = form.elements;
    withBusy(form.querySelector('[type=submit]'), '儲存中…', async () => {
      try {
        const saved = await adminApi('saveItem', {
          isNew,
          item: { item_id: f.item_id.value, name: f.name.value, category: f.category.value, location: f.location.value, note: f.note.value },
        });
        toast(isNew ? `已新增 ${saved.item_id}，可以在下方列印它的標籤` : `已儲存 ${saved.item_id}`);
        go(`#/item/${encodeURIComponent(saved.item_id)}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}
