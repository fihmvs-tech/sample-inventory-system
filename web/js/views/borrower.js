// 借用者畫面：首頁、借用清單、歸還清單、我的借用。
// 每個畫面都把「下一步」放在最顯眼的位置：掃完 → 前往清單 → 填寫／確認 → 完成。

import { api, getConfig } from '../api.js';
import * as store from '../store.js';
import { openScanner, parseItemId } from '../scanner.js';
import { current, go, route } from '../router.js';
import {
  view, esc, toast, statusTag, loadingHtml, withBusy, stripDomain, ICONS,
  borrowerFieldsHtml, bindBorrowerFields, reasonFieldsHtml, bindReasonFields, readReason,
} from '../ui.js';

const SCAN_TITLES = { auto: '掃描展品', borrow: '掃描要借用的展品', return: '掃描要歸還的展品' };

// 代填模式（#/borrow/proxy）中加入展品時，留在代填模式。
function borrowHash() {
  return location.hash.startsWith('#/borrow') ? location.hash : '#/borrow';
}

export function listHash(list) {
  return list === 'borrow' ? borrowHash() : '#/return';
}

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

// 掃描畫面底部的「下一步」按鈕，依目前清單件數即時更新。
function scanActions(mode) {
  return () => {
    const s = store.get();
    const actions = [];
    if (mode !== 'return' && s.borrow.length) {
      actions.push({ key: 'borrow', label: mode === 'borrow' ? `完成，回到借用清單（${s.borrow.length} 件）` : `前往借用清單（${s.borrow.length} 件）填寫送出 →` });
    }
    if (mode !== 'borrow' && s.ret.length) {
      actions.push({ key: 'return', label: mode === 'return' ? `完成，回到歸還清單（${s.ret.length} 件）` : `前往歸還清單（${s.ret.length} 件）確認歸還 →` });
    }
    return actions;
  };
}

function startScanner(mode) {
  openScanner({
    title: SCAN_TITLES[mode],
    onScan: (id) => addScanned(id, mode),
    actions: scanActions(mode),
    onAction: (list) => go(listHash(list)),
    // 在首頁或其他頁掃完直接按「完成」：有新加入的展品就帶到對應清單；在清單頁則留在原頁。
    onClose: (added) => {
      if (mode !== 'auto' || !added.size) route();
      else go(listHash(added.has('borrow') ? 'borrow' : 'return'));
    },
  });
}

function manualFormHtml(mode, hidden) {
  return `
    <form class="inline-form mt" data-manual="${mode}" ${hidden ? 'hidden' : ''}>
      <input name="id" placeholder="輸入展品編號，例如 A31" autocomplete="off" autocapitalize="characters" aria-label="展品編號">
      <button class="btn" type="submit">加入</button>
    </form>`;
}

// 清單頁的小型控制列：再掃一件、輸入編號（點了才展開）。
function listScanControlsHtml(mode) {
  return `
    <div class="btn-row mt">
      <button class="btn" type="button" data-scan="${mode}">${ICONS.scan}再掃一件</button>
      <button class="btn" type="button" data-manual-toggle>輸入編號</button>
    </div>
    ${manualFormHtml(mode, true)}`;
}

function bindScanControls(root = view) {
  root.querySelectorAll('[data-scan]').forEach((button) => {
    button.addEventListener('click', () => startScanner(button.dataset.scan));
  });
  root.querySelectorAll('[data-manual-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const form = root.querySelector('[data-manual]');
      form.hidden = !form.hidden;
      if (!form.hidden) form.elements.id.focus();
    });
  });
  root.querySelectorAll('[data-manual]').forEach((form) => {
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
        go(listHash(result.list));
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function itemLine(i, extra = '') {
  return `<div class="title"><span class="item-id">${esc(i.item_id)}</span> ${esc(i.name)}</div>${extra}`;
}

function removableList(items, extra) {
  return `<ul class="list">${items.map((i) => `
    <li><div class="main">${itemLine(i, extra ? extra(i) : '')}</div>
      <button class="btn btn-sm" type="button" data-remove="${esc(i.item_id)}" aria-label="從清單移除 ${esc(i.item_id)}">移除</button></li>`).join('')}</ul>`;
}

function bindRemove(listKey) {
  view.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      store.update({ [listKey]: store.get()[listKey].filter((i) => i.item_id !== button.dataset.remove) });
      route();
    });
  });
}

function emptyStateHtml(mode) {
  const borrow = mode === 'borrow';
  return `
    <section class="card empty-state">
      <h2>${borrow ? '還沒有要借的展品' : '還沒有要歸還的展品'}</h2>
      <p class="muted">${borrow ? '掃描展品上的 QR Code，就會加入借用清單。可以連續掃描多件。' : '逐件掃描要歸還的展品，可以只還其中幾件。'}</p>
      <button class="btn btn-primary btn-lg btn-block" type="button" data-scan="${mode}">${ICONS.scan}掃描 QR Code</button>
      ${manualFormHtml(mode, false)}
    </section>`;
}

// ---- 首頁 ----

function nextStepHtml(list, items) {
  const borrow = list === 'borrow';
  const shown = items.slice(0, 3).map((i) => `<li><span class="item-id">${esc(i.item_id)}</span> ${esc(i.name)}</li>`).join('');
  const more = items.length > 3 ? `<li class="muted">…等共 ${items.length} 件</li>` : '';
  return `
    <section class="card next-step">
      <span class="eyebrow">下一步</span>
      <h2>${borrow ? `借用清單有 ${items.length} 件還沒送出` : `歸還清單有 ${items.length} 件還沒確認`}</h2>
      <ul class="mini-list">${shown}${more}</ul>
      <a class="btn btn-primary btn-lg btn-block" href="${borrow ? '#/borrow' : '#/return'}">${borrow ? '填寫借用資料並送出' : '確認歸還'} →</a>
    </section>`;
}

export function home() {
  const s = store.get();
  const pending = [];
  if (s.borrow.length) pending.push(nextStepHtml('borrow', s.borrow));
  if (s.ret.length) pending.push(nextStepHtml('return', s.ret));

  view.innerHTML = `
    ${pending.join('')}
    <section class="card">
      <h1>${pending.length ? '繼續掃描' : '掃碼借還展品'}</h1>
      <p class="muted">掃描展品上的 QR Code：在庫的展品會放進借用清單，借出中的展品會放進歸還清單。</p>
      <button class="btn btn-primary btn-lg btn-block" type="button" data-scan="auto">${ICONS.scan}掃描 QR Code</button>
      ${manualFormHtml('auto', false)}
    </section>
    ${pending.length ? '' : `
      <section class="card">
        <h2>使用方式</h2>
        <ol class="steps">
          <li>掃描展品的 QR Code，可以連續掃描多件</li>
          <li>按「填寫借用資料並送出」，填 Email、借用事由與預計歸還日</li>
          <li>歸還時逐件掃描展品，按「確認歸還」，可以分批歸還</li>
        </ol>
      </section>`}`;
  bindScanControls();
}

// ---- 借用 ----

// #/borrow 是自己借用；管理者從 #/borrow/proxy 進入（或勾選表單上的選項）就是幫同仁代填。
export async function borrow(arg) {
  const live = current();
  const s = store.get();
  view.innerHTML = loadingHtml;
  const cfg = await getConfig();
  if (!live()) return;

  const admin = Boolean(s.adminKey && cfg.admin);
  const proxy = admin && arg === 'proxy';
  const people = proxy ? cfg.borrowers || [] : s.recent;
  const me = proxy ? null : s.me;
  const n = s.borrow.length;

  view.innerHTML = `
    ${proxy ? '<p class="notice">代填模式：掃描要借給同仁的展品，再填寫同仁的資料送出。紀錄會標示由你代填。</p>' : ''}
    ${n ? `
      <section class="card">
        <div class="card-head"><h2><span class="step-num">1</span>確認要借的展品</h2><span class="tag tag-info">${n} 件</span></div>
        ${removableList(s.borrow)}
        ${listScanControlsHtml('borrow')}
      </section>
      <form class="card" id="checkout">
        <h2><span class="step-num">2</span>填寫借用資訊</h2>
        ${admin ? `
          <label class="switch-row" for="f-proxy">
            <input type="checkbox" id="f-proxy" ${proxy ? 'checked' : ''}>
            <span><b>管理者幫同仁代填</b><br><span class="small muted">勾選代表幫同仁代填，請填寫實際借用人的資料；不勾選代表你自己借用</span></span>
          </label>` : ''}
        ${borrowerFieldsHtml({ domain: cfg.emailDomain, people, email: me?.email, name: me?.name })}
        ${reasonFieldsHtml(cfg.reasons)}
        <button class="btn btn-primary btn-lg btn-block" type="submit">確認借用 ${n} 件</button>
        <p class="small muted form-foot">送出後就完成借用。逾期未歸還時，系統會寄 Email 提醒。</p>
      </form>` : emptyStateHtml('borrow')}`;

  bindScanControls();
  bindRemove('borrow');

  const form = document.getElementById('checkout');
  if (!form) return;
  const proxySwitch = document.getElementById('f-proxy');
  if (proxySwitch) {
    proxySwitch.addEventListener('change', () => go(proxySwitch.checked ? '#/borrow/proxy' : '#/borrow'));
  }
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
          // 不帶管理者密碼，後端就不會把管理者自己的借用記成代填。
          ...(proxy ? {} : { adminKey: '' }),
        });
        if (!proxy) store.rememberBorrower(res.borrowerEmail, res.borrowerName);
        store.update({ borrow: [] });
        showCheckoutDone(res, proxy);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

function showCheckoutDone(res, proxy) {
  view.innerHTML = `
    <section class="card success">
      <div class="big" aria-hidden="true">✓</div>
      <h1>${proxy ? '代填完成' : '借用完成'}</h1>
      <p class="muted">借用單號 ${esc(res.loanId)}</p>
    </section>
    <section class="card">
      <dl class="info">
        <dt>借用者</dt><dd>${esc(res.borrowerName)}<br><span class="small muted">${esc(res.borrowerEmail)}</span></dd>
        <dt>預計歸還</dt><dd>${esc(res.expectedReturnDate)}</dd>
        ${proxy ? `<dt>登記方式</dt><dd>管理者（${esc(store.get().operatorName)}）代填</dd>` : ''}
      </dl>
      <ul class="list">${res.items.map((i) => `<li><div class="main">${itemLine(i)}</div></li>`).join('')}</ul>
      <p class="small muted">逾期未歸還時，系統會寄 Email 提醒。歸還時掃描展品的 QR Code 即可。</p>
    </section>
    <div class="btn-col">
      ${proxy
        ? '<a class="btn btn-primary btn-lg btn-block" href="#/borrow/proxy">繼續代填其他展品</a><a class="btn btn-block" href="#/admin">回管理頁</a>'
        : '<a class="btn btn-primary btn-lg btn-block" href="#/">完成</a><a class="btn btn-block" href="#/mine">查看我的借用</a>'}
    </div>`;
  window.scrollTo(0, 0);
}

// ---- 歸還 ----

export function giveBack() {
  const s = store.get();
  const n = s.ret.length;
  view.innerHTML = n ? `
    <section class="card">
      <div class="card-head"><h2><span class="step-num">1</span>確認要歸還的展品</h2><span class="tag tag-info">${n} 件</span></div>
      ${removableList(s.ret, (i) => `<div class="sub">借用者 ${esc(i.borrower)}・預計 ${esc(i.expected)} ${i.overdue ? statusTag('', true) : ''}</div>`)}
      ${listScanControlsHtml('return')}
    </section>
    <section class="card">
      <h2><span class="step-num">2</span>送出歸還</h2>
      <p class="small muted">按下後，這 ${n} 件會登記為已歸還。同一張借用單還沒歸還的展品，會繼續記在借用者名下。</p>
      <button class="btn btn-primary btn-lg btn-block" type="button" id="do-return">確認歸還 ${n} 件</button>
    </section>` : emptyStateHtml('return');

  bindScanControls();
  bindRemove('ret');
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
    <div class="btn-col">
      <a class="btn btn-primary btn-lg btn-block" href="#/">完成</a>
      <a class="btn btn-block" href="#/return">繼續歸還其他展品</a>
    </div>`;
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
      <p class="small muted">輸入借用時填的 Email，查看還沒歸還的展品與到期日。</p>
      <div class="field">
        <label for="m-email">Email</label>
        ${domain
          ? `<div class="input-group"><input id="m-email" name="email" inputmode="email" autocapitalize="off" required
               value="${esc(stripDomain(s.me?.email || '', domain))}"><span class="addon">@${esc(domain)}</span></div>`
          : `<input id="m-email" name="email" type="email" autocomplete="email" required value="${esc(s.me?.email || '')}">`}
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

  const overdueCount = rows.filter((r) => r.overdue).length;
  const earliest = rows.map((r) => r.expected_return_date).filter(Boolean).sort()[0];
  const groups = new Map();
  rows.forEach((r) => {
    if (!groups.has(r.loan_id)) groups.set(r.loan_id, []);
    groups.get(r.loan_id).push(r);
  });

  box.innerHTML = `
    <section class="card summary ${overdueCount ? 'summary-warn' : ''}">
      <div><b>借用中 ${rows.length} 件</b>${overdueCount ? `，其中 <b>${overdueCount} 件已逾期</b>` : ''}</div>
      <div class="small muted">最早到期：${esc(earliest || '—')}</div>
    </section>
    ${[...groups.values()].map((items) => {
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
    }).join('')}
    <section class="card">
      <h2>要歸還了嗎？</h2>
      <p class="small muted">歸還時要逐件掃描實體展品，可以只還其中幾件。</p>
      <button class="btn btn-primary btn-block" type="button" data-scan="return">${ICONS.scan}掃描要歸還的展品</button>
    </section>`;
  bindScanControls(box);
}
