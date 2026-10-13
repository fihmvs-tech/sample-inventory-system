// 借用者畫面：首頁、借用清單、歸還清單、我的借用。

import { api, getConfig } from '../api.js';
import * as store from '../store.js';
import { openScanner, parseItemId } from '../scanner.js';
import { current, go, route } from '../router.js';
import {
  view, esc, toast, statusTag, loadingHtml, withBusy, stripDomain,
  borrowerFieldsHtml, bindBorrowerFields, reasonFieldsHtml, bindReasonFields, readReason,
} from '../ui.js';

const SCAN_TITLES = { auto: '掃描展品', borrow: '掃描要借用的展品', return: '掃描要歸還的展品' };

/**
 * 依展品狀態放進對應清單：在庫 → 借用清單，借出 → 歸還清單。
 * mode 為 borrow / return 時只接受對應狀態的展品。
 */
export async function addScanned(itemId, mode = 'auto') {
  const item = await api('getItem', { itemId });
  const s = store.get();
  const label = `${item.item_id} ${item.name}`;

  if (item.status === '在庫' && mode !== 'return') {
    const exists = s.borrow.some((i) => i.item_id === item.item_id);
    if (!exists) store.update({ borrow: [...s.borrow, { item_id: item.item_id, name: item.name }] });
    return { list: 'borrow', added: !exists, message: exists ? `${label} 已在借用清單中` : `已加入借用清單：${label}` };
  }
  if (item.status === '借出' && mode !== 'borrow') {
    const exists = s.ret.some((i) => i.item_id === item.item_id);
    if (!exists) {
      store.update({
        ret: [...s.ret, {
          item_id: item.item_id,
          name: item.name,
          borrower: item.current_borrower_name,
          expected: item.expected_return_date,
          overdue: item.overdue,
        }],
      });
    }
    return { list: 'return', added: !exists, message: exists ? `${label} 已在歸還清單中` : `已加入歸還清單：${label}` };
  }
  throw new Error(`${label} 目前「${item.status}」，${mode === 'return' ? '不需要歸還' : '無法借用'}`);
}

function scanControlsHtml(mode, buttonLabel) {
  return `
    <button class="btn btn-block ${mode === 'auto' ? 'btn-primary btn-lg' : ''}" type="button" data-scan="${mode}">${buttonLabel}</button>
    <form class="inline-form mt" data-manual="${mode}">
      <input name="id" placeholder="或輸入展品編號，例如 A31" autocomplete="off" autocapitalize="characters" aria-label="展品編號">
      <button class="btn" type="submit">加入</button>
    </form>`;
}

function bindScanControls() {
  view.querySelectorAll('[data-scan]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.dataset.scan;
      openScanner({
        title: SCAN_TITLES[mode],
        onScan: (id) => addScanned(id, mode),
        onClose: route,
      });
    });
  });
  view.querySelectorAll('[data-manual]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = parseItemId(form.elements.id.value);
      if (!id) {
        toast('請輸入正確的展品編號', 'error');
        return;
      }
      try {
        const result = await addScanned(id, form.dataset.manual);
        toast(result.message);
        go(result.list === 'borrow' ? '#/borrow' : '#/return');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function itemLine(i, extra = '') {
  return `<div class="title"><span class="item-id">${esc(i.item_id)}</span> ${esc(i.name)}</div>${extra}`;
}

// ---- 首頁 ----

export function home() {
  const s = store.get();
  const carts = [];
  if (s.borrow.length) carts.push(`<a class="btn" href="#/borrow">借用清單 ${s.borrow.length} 件 →</a>`);
  if (s.ret.length) carts.push(`<a class="btn" href="#/return">歸還清單 ${s.ret.length} 件 →</a>`);

  view.innerHTML = `
    <section class="card">
      <h1>掃碼借還展品</h1>
      <p class="muted">掃描展品上的 QR Code：在庫的展品會放進借用清單，借出中的展品會放進歸還清單。</p>
      ${scanControlsHtml('auto', '掃描 QR Code')}
    </section>
    ${carts.length ? `<section class="card"><h2>尚未送出</h2><div class="btn-row">${carts.join('')}</div></section>` : ''}
    <section class="card">
      <h2>使用方式</h2>
      <ol class="steps">
        <li>用手機相機或上方按鈕掃描展品 QR Code，可以連續掃描多件</li>
        <li>到「借用」填寫 Email、借用事由與預計歸還日期後送出</li>
        <li>歸還時逐件掃描展品即可，可以分批歸還</li>
      </ol>
    </section>`;
  bindScanControls();
}

// ---- 借用 ----

export async function borrow() {
  const live = current();
  const s = store.get();
  view.innerHTML = loadingHtml;
  const cfg = await getConfig();
  if (!live()) return;

  const admin = Boolean(s.adminKey && cfg.admin);
  const people = admin ? cfg.borrowers || [] : s.recent;
  const me = admin ? null : s.me;

  view.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>借用清單</h2><span class="tag tag-info">${s.borrow.length} 件</span></div>
      ${s.borrow.length
        ? `<ul class="list">${s.borrow.map((i) => `
            <li><div class="main">${itemLine(i)}</div>
              <button class="btn btn-sm" type="button" data-remove="${esc(i.item_id)}">移除</button></li>`).join('')}</ul>`
        : '<p class="empty">還沒有展品，請掃描要借用的展品。</p>'}
      ${scanControlsHtml('borrow', '掃描更多展品')}
    </section>
    ${s.borrow.length ? `
      <form class="card" id="checkout">
        <h2>借用資訊</h2>
        ${admin ? '<p class="notice">管理者代填：請填寫實際借用人的資料，紀錄會標示由你代填。</p>' : ''}
        ${borrowerFieldsHtml({ domain: cfg.emailDomain, people, email: me?.email, name: me?.name })}
        ${reasonFieldsHtml(cfg.reasons)}
        <button class="btn btn-primary btn-lg btn-block" type="submit">確認借用 ${s.borrow.length} 件</button>
      </form>` : ''}`;

  bindScanControls();
  view.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      store.update({ borrow: store.get().borrow.filter((i) => i.item_id !== button.dataset.remove) });
      route();
    });
  });

  const form = document.getElementById('checkout');
  if (!form) return;
  bindBorrowerFields(form, { domain: cfg.emailDomain, people });
  bindReasonFields(form);
  form.addEventListener('input', () => { form.dataset.dirty = '1'; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    await withBusy(form.querySelector('[type=submit]'), '送出中…', async () => {
      try {
        const res = await api('checkout', {
          borrowerEmail: f.email.value,
          borrowerName: f.name.value,
          reason: readReason(form),
          expectedReturnDate: f.expected.value,
          itemIds: store.get().borrow.map((i) => i.item_id),
        });
        if (!admin) store.rememberBorrower(res.borrowerEmail, res.borrowerName);
        store.update({ borrow: [] });
        showCheckoutDone(res);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function showCheckoutDone(res) {
  view.innerHTML = `
    <section class="card success">
      <div class="big" aria-hidden="true">✓</div>
      <h1>借用完成</h1>
      <p class="muted">借用單號 ${esc(res.loanId)}</p>
    </section>
    <section class="card">
      <dl class="info">
        <dt>借用者</dt><dd>${esc(res.borrowerName)}<br><span class="small muted">${esc(res.borrowerEmail)}</span></dd>
        <dt>預計歸還</dt><dd>${esc(res.expectedReturnDate)}</dd>
      </dl>
      <ul class="list">${res.items.map((i) => `<li><div class="main">${itemLine(i)}</div></li>`).join('')}</ul>
      <p class="small muted">逾期未歸還時，系統會寄 Email 提醒。歸還時掃描展品的 QR Code 即可。</p>
    </section>
    <a class="btn btn-primary btn-block" href="#/">回首頁</a>`;
  window.scrollTo(0, 0);
}

// ---- 歸還 ----

export function giveBack() {
  const s = store.get();
  view.innerHTML = `
    <section class="card">
      <div class="card-head"><h2>歸還清單</h2><span class="tag tag-info">${s.ret.length} 件</span></div>
      ${s.ret.length
        ? `<ul class="list">${s.ret.map((i) => `
            <li><div class="main">${itemLine(i, `<div class="sub">借用者 ${esc(i.borrower)}・預計 ${esc(i.expected)} ${i.overdue ? statusTag('', true) : ''}</div>`)}</div>
              <button class="btn btn-sm" type="button" data-remove="${esc(i.item_id)}">移除</button></li>`).join('')}</ul>`
        : '<p class="empty">還沒有展品，請逐件掃描要歸還的展品。</p>'}
      ${scanControlsHtml('return', '掃描要歸還的展品')}
    </section>
    ${s.ret.length ? `<button class="btn btn-primary btn-lg btn-block" type="button" id="do-return">確認歸還 ${s.ret.length} 件</button>` : ''}`;

  bindScanControls();
  view.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      store.update({ ret: store.get().ret.filter((i) => i.item_id !== button.dataset.remove) });
      route();
    });
  });
  const submit = document.getElementById('do-return');
  if (!submit) return;
  submit.addEventListener('click', () => withBusy(submit, '送出中…', async () => {
    try {
      const res = await api('checkin', { itemIds: store.get().ret.map((i) => i.item_id) });
      store.update({ ret: [] });
      showReturnDone(res);
    } catch (err) {
      toast(err.message, 'error');
    }
  }));
}

function showReturnDone(res) {
  view.innerHTML = `
    <section class="card success">
      <div class="big" aria-hidden="true">✓</div>
      <h1>歸還完成</h1>
      <p class="muted">共 ${res.returned.length} 件</p>
    </section>
    <section class="card">
      <ul class="list">${res.returned.map((i) => `
        <li><div class="main">${itemLine(i, `<div class="sub">借用者 ${esc(i.borrower_name)}</div>`)}</div></li>`).join('')}</ul>
      ${res.loans.map((l) => `<p class="small ${l.remaining ? 'notice notice-warn' : 'muted'}">借用單 ${esc(l.loan_id)}：${
        l.remaining ? `尚有 ${l.remaining} 件未歸還，會繼續記在借用者名下` : '已全部歸還'}</p>`).join('')}
    </section>
    <a class="btn btn-primary btn-block" href="#/">回首頁</a>`;
  window.scrollTo(0, 0);
}

// ---- 我的借用 ----

export async function mine() {
  const live = current();
  view.innerHTML = loadingHtml;
  const cfg = await getConfig();
  if (!live()) return;
  const s = store.get();
  const domain = cfg.emailDomain;

  view.innerHTML = `
    <form class="card" id="mine-form">
      <h2>我的借用</h2>
      <div class="field">
        <label for="m-email">Email</label>
        ${domain
          ? `<div class="input-group"><input id="m-email" name="email" inputmode="email" autocapitalize="off" required
               value="${esc(stripDomain(s.me?.email || '', domain))}"><span class="addon">@${esc(domain)}</span></div>`
          : `<input id="m-email" name="email" type="email" required value="${esc(s.me?.email || '')}">`}
      </div>
      <button class="btn btn-primary btn-block" type="submit">查詢</button>
    </form>
    <div id="mine-result"></div>`;

  const form = document.getElementById('mine-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    showMyLoans(form.elements.email.value);
  });
  if (s.me?.email) showMyLoans(s.me.email);
}

async function showMyLoans(email) {
  const live = current();
  const box = document.getElementById('mine-result');
  box.innerHTML = loadingHtml;
  let rows;
  try {
    rows = await api('myLoans', { email });
  } catch (err) {
    box.innerHTML = `<p class="notice notice-warn">${esc(err.message)}</p>`;
    return;
  }
  if (!live()) return;
  if (!rows.length) {
    box.innerHTML = '<section class="card"><p class="empty">目前沒有借用中的展品。</p></section>';
    return;
  }

  const groups = new Map();
  rows.forEach((r) => {
    if (!groups.has(r.loan_id)) groups.set(r.loan_id, []);
    groups.get(r.loan_id).push(r);
  });
  box.innerHTML = [...groups.values()].map((items) => {
    const first = items[0];
    const overdue = items.some((r) => r.overdue);
    return `
      <section class="card">
        <div class="card-head">
          <h3>${esc(first.reason)}</h3>
          ${overdue ? statusTag('', true) : `<span class="tag">${items.length} 件</span>`}
        </div>
        <p class="small muted">借用單 ${esc(first.loan_id)}・借出 ${esc(String(first.borrowed_at).slice(0, 10))}・預計歸還 ${esc(first.expected_return_date)}</p>
        <ul class="list">${items.map((r) => `
          <li><div class="main">${itemLine({ item_id: r.item_id, name: r.item_name })}</div></li>`).join('')}</ul>
      </section>`;
  }).join('') + '<p class="small muted">歸還時請到「歸還」逐件掃描展品的 QR Code。</p>';
}
