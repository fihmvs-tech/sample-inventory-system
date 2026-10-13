// 管理者畫面：登入、展品列表、單品詳情與履歷、新增／編輯、移轉、催還。

import { api, getConfig, clearConfig, isDemo } from '../api.js';
import * as store from '../store.js';
import { current, go, route } from '../router.js';
import {
  view, esc, toast, statusTag, loadingHtml, withBusy,
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

// 管理者 API 失敗時，若是金鑰失效就回到登入畫面。
async function adminApi(action, params) {
  try {
    return await api(action, params);
  } catch (err) {
    if (/管理者金鑰/.test(err.message)) {
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

function login() {
  view.innerHTML = `
    <form class="card" id="login">
      <h2>管理者登入</h2>
      <p class="small muted">管理者可以管理展品主檔、代同仁登記借用、查詢展品履歷與寄送催還信。</p>
      ${isDemo ? '<p class="notice">示範模式的管理者金鑰是 <code>demo</code>。</p>' : ''}
      <div class="field">
        <label for="a-key">管理者金鑰</label>
        <input id="a-key" name="key" type="password" autocomplete="off" required>
      </div>
      <div class="field">
        <label for="a-name">你的名字</label>
        <input id="a-name" name="name" required placeholder="會記錄在操作紀錄中">
      </div>
      <button class="btn btn-primary btn-block" type="submit">登入</button>
    </form>`;
  const form = document.getElementById('login');
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
      <div class="card-head"><h2>展品管理</h2><span class="small muted">${esc(store.get().operatorName)}</span></div>
      <div class="btn-row">
        <a class="btn btn-primary" href="#/item-edit/new">新增展品</a>
        <a class="btn" href="labels.html">列印 QR 標籤</a>
        <a class="btn" href="entry-qr.html">系統入口 QR Code</a>
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

  view.querySelectorAll('[data-status]').forEach((button) => {
    button.addEventListener('click', () => {
      const status = button.dataset.status;
      const note = prompt(`將 ${it.item_id} 改為「${status}」。說明（可留空）：`, '');
      if (note === null) return;
      withBusy(button, '處理中…', async () => {
        try {
          await adminApi('setItemStatus', { itemId: it.item_id, status, note });
          toast(`${it.item_id} 已改為「${status}」`);
          route();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    });
  });
  const showTransfer = document.getElementById('show-transfer');
  if (showTransfer) showTransfer.addEventListener('click', () => transferForm(it));
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
        toast(`已儲存 ${saved.item_id}`);
        go(`#/item/${encodeURIComponent(saved.item_id)}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}
