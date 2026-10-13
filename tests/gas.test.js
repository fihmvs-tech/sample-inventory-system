// 以模擬的 Google 服務執行 apps-script/*.gs，驗證借還流程。
// 開啟 http://localhost:8080/tests/ 即可執行；結果也會放在 window.testResults。

import { installFakes, freshState, GAS_FILES, loadScript } from '../web/js/demo/gas-fakes.js';

const ADMIN = 'test-admin-key';
let state;

function reset() {
  state = installFakes(window, freshState());
  state.props.ADMIN_KEY = ADMIN;
  window.setup();
}

function call(action, params = {}, admin = false) {
  const body = { action, ...params };
  if (admin) body.adminKey = ADMIN;
  return JSON.parse(window.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
}

function ok(action, params, admin) {
  const res = call(action, params, admin);
  if (!res.ok) throw new Error(`${action} 失敗：${res.error}`);
  return res.data;
}

function fails(action, params, admin, pattern) {
  const res = call(action, params, admin);
  if (res.ok) throw new Error(`${action} 應該失敗卻成功了`);
  if (pattern && !pattern.test(res.error)) throw new Error(`${action} 錯誤訊息不符：${res.error}`);
  return res.error;
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}：預期 ${e}，實際 ${a}`);
}

function sheetRows(name) {
  const sheet = state.spreadsheet.getSheetByName(name);
  const [headers, ...rows] = sheet.getDataRange().getValues();
  return rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

function addDays(days) {
  return window.Utilities.formatDate(new Date(Date.now() + days * 86400000), 'Asia/Taipei', 'yyyy-MM-dd');
}

function seedItems(ids) {
  ids.forEach((id) => ok('saveItem', { item: { item_id: id, name: `展品 ${id}` }, isNew: true }, true));
}

function borrow(ids, extra = {}) {
  return ok('checkout', {
    borrowerEmail: 'bob@example.com', borrowerName: 'Bob', reason: '展覽出國-日本',
    expectedReturnDate: addDays(7), itemIds: ids, ...extra,
  });
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('setup 建立五張工作表、預設設定與每日排程', () => {
  eq(state.spreadsheet.getSheets().map((s) => s.getName()), ['Items', 'Loans', 'Logs', 'Borrowers', 'Settings'], '工作表');
  eq(sheetRows('Settings').map((r) => r.key), ['REASONS', 'EMAIL_DOMAIN', 'ADMIN_EMAILS', 'REMINDER_HOUR', 'APP_URL'], '設定鍵');
  eq(state.triggers.map((t) => [t.handler, t.atHour]), [['sendOverdueReminders', 17]], '排程');
  window.setup();
  eq(sheetRows('Settings').length, 5, '重複執行 setup 不會重複寫入設定');
  eq(state.triggers.length, 1, '重複執行 setup 不會重複建立排程');
});

test('非管理者不能新增展品，管理者可以', () => {
  fails('saveItem', { item: { item_id: 'A01', name: 'x' } }, false, /管理者密碼/);
  ok('saveItem', { item: { item_id: 'a01', name: '展示螢幕' }, isNew: true }, true);
  eq(ok('getItem', { itemId: 'A01' }).status, '在庫', '新展品狀態（編號自動轉大寫）');
  fails('saveItem', { item: { item_id: 'A01', name: '重複' }, isNew: true }, true, /已存在/);
  eq(sheetRows('Logs').map((r) => r.action), ['新增'], '日誌');
});

test('一次借用多件：每件一列借用紀錄、展品改為借出', () => {
  seedItems(['A01', 'A02', 'A03']);
  const res = borrow(['A01', 'A02', 'A03', 'A01']);
  eq(res.items.map((i) => i.item_id), ['A01', 'A02', 'A03'], '重複掃描的展品只算一次');
  const loans = sheetRows('Loans');
  eq(loans.length, 3, '借用紀錄列數');
  eq(new Set(loans.map((r) => r.loan_id)).size, 1, '同一張借用單');
  eq(loans.every((r) => r.status === '借出中' && r.operator === 'bob@example.com'), true, '借用紀錄狀態');
  const item = ok('getItem', { itemId: 'A02' });
  eq([item.status, item.current_borrower_name, item.expected_return_date], ['借出', 'Bob', addDays(7)], '展品狀態');
  eq('current_borrower_email' in item, false, '公開查詢不回傳借用者 Email');
  eq(sheetRows('Borrowers').map((r) => r.email), ['bob@example.com'], '常用借用者');
});

test('借用驗證：已借出、查無編號、日期錯誤都整批拒絕', () => {
  seedItems(['A01', 'A02']);
  borrow(['A01']);
  const err = fails('checkout', {
    borrowerEmail: 'amy@example.com', borrowerName: 'Amy', reason: '客戶拜訪',
    expectedReturnDate: addDays(3), itemIds: ['A01', 'A02', 'Z99'],
  }, false);
  eq(/A01 目前狀態為「借出」/.test(err) && /查無展品編號 Z99/.test(err), true, '錯誤訊息列出所有問題');
  eq(ok('getItem', { itemId: 'A02' }).status, '在庫', '整批拒絕時 A02 沒有被借出');
  fails('checkout', { borrowerEmail: 'amy@example.com', borrowerName: 'Amy', reason: 'x', expectedReturnDate: addDays(-1), itemIds: ['A02'] }, false, /不能早於今天/);
  fails('checkout', { borrowerEmail: 'amy', borrowerName: 'Amy', reason: 'x', expectedReturnDate: addDays(1), itemIds: ['A02'] }, false, /Email 格式不正確/);
});

test('設定 EMAIL_DOMAIN 後只輸入前綴即可', () => {
  seedItems(['A01']);
  const sheet = state.spreadsheet.getSheetByName('Settings');
  const row = sheetRows('Settings').findIndex((r) => r.key === 'EMAIL_DOMAIN') + 2;
  sheet.getRange(row, 2).setValue('example.com');
  eq(ok('getConfig').emailDomain, 'example.com', 'getConfig');
  eq(borrow(['A01'], { borrowerEmail: 'Carol' }).borrowerEmail, 'carol@example.com', '自動補上網域');
});

test('管理者代填：借用紀錄標示操作者', () => {
  seedItems(['A01']);
  ok('checkout', {
    borrowerEmail: 'bob@example.com', borrowerName: 'Bob', reason: '客戶拜訪',
    expectedReturnDate: addDays(1), itemIds: ['A01'], adminKey: ADMIN, operatorName: '小王',
  });
  eq(sheetRows('Loans')[0].operator, '管理者(小王)代填', '操作者');
  eq(ok('getConfig', {}, true).borrowers, [{ email: 'bob@example.com', name: 'Bob' }], '管理者看得到借用者名單');
  eq('borrowers' in ok('getConfig'), false, '一般使用者看不到借用者名單');
});

test('分批歸還：借 10 件、還 5 件 → 部分歸還；剩下 5 件移轉去美國；全部還完 → 完全歸還', () => {
  const ids = Array.from({ length: 10 }, (_, i) => `J${String(i + 1).padStart(2, '0')}`);
  seedItems(ids);
  const first = borrow(ids);

  const r1 = ok('checkin', { itemIds: ids.slice(0, 5) });
  eq(r1.loans, [{ loan_id: first.loanId, remaining: 5 }], '第一次歸還後剩 5 件');
  eq(ok('getItem', { itemId: 'J01' }).status, '在庫', 'J01 已歸還');
  eq(ok('getItem', { itemId: 'J06' }).status, '借出', 'J06 仍借出');
  eq(ok('myLoans', { email: 'BOB@example.com' }).length, 5, 'Bob 名下剩 5 件');

  const moved = ok('transfer', {
    itemIds: ids.slice(5), borrowerEmail: 'bob@example.com', borrowerName: 'Bob',
    reason: '展覽出國-美國', expectedReturnDate: addDays(20),
  }, true);
  const loans = sheetRows('Loans');
  eq(loans.filter((r) => r.loan_id === first.loanId).map((r) => r.status),
    ['已歸還', '已歸還', '已歸還', '已歸還', '已歸還', '已移轉', '已移轉', '已移轉', '已移轉', '已移轉'], '原借用單');
  eq(loans.filter((r) => r.loan_id === moved.loanId && r.status === '借出中').length, 5, '新借用單 5 件');
  eq(ok('getItem', { itemId: 'J06' }).expected_return_date, addDays(20), '預計歸還日已更新');

  const r2 = ok('checkin', { itemIds: ids.slice(5) });
  eq(r2.loans, [{ loan_id: moved.loanId, remaining: 0 }], '全部結清');
  const actions = sheetRows('Logs').filter((r) => r.item_id === 'J01' || r.item_id === 'J06').map((r) => `${r.item_id}:${r.action}`);
  eq(actions, ['J01:新增', 'J06:新增', 'J01:借出', 'J06:借出', 'J01:部分歸還', 'J06:移轉', 'J06:完全歸還'], '日誌');
  fails('checkin', { itemIds: ['J01'] }, false, /不需要歸還/);
});

test('單品履歷：依時間由新到舊列出所有異動', () => {
  seedItems(['A31']);
  borrow(['A31']);
  ok('checkin', { itemIds: ['A31'] });
  ok('setItemStatus', { itemId: 'A31', status: '送修', note: '螢幕刮傷' }, true);
  const h = ok('getHistory', { itemId: 'A31' }, true);
  eq(h.logs.map((r) => r.action), ['送修', '完全歸還', '借出', '新增'], '履歷');
  eq(h.logs[0].detail, '在庫 → 送修；螢幕刮傷', '送修說明');
  eq(h.loans.length, 1, '借用紀錄');
  fails('getHistory', { itemId: 'A31' }, false, /管理者密碼/);
});

test('送修中的展品不能借用；借出中的展品不能直接改狀態', () => {
  seedItems(['A01', 'A02']);
  ok('setItemStatus', { itemId: 'A01', status: '送修' }, true);
  fails('checkout', { borrowerEmail: 'bob@example.com', borrowerName: 'Bob', reason: 'x', expectedReturnDate: addDays(1), itemIds: ['A01'] }, false, /送修/);
  borrow(['A02']);
  fails('setItemStatus', { itemId: 'A02', status: '遺失' }, true, /借出中/);
  fails('setItemStatus', { itemId: 'A02', status: '借出' }, true, /不支援/);
});

test('逾期催還：超過預計歸還日才寄信，依借用者合併，並記錄次數', () => {
  seedItems(['A01', 'A02', 'A03', 'A04']);
  borrow(['A01', 'A02']);
  borrow(['A03'], { borrowerEmail: 'amy@example.com', borrowerName: 'Amy' });
  borrow(['A04'], { borrowerEmail: 'amy@example.com', borrowerName: 'Amy' });

  // 直接改試算表：A01、A02 預計昨天歸還（逾期），A03 今天到期（尚未逾期），A04 不變。
  const sheet = state.spreadsheet.getSheetByName('Loans');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = headers.indexOf('expected_return_date') + 1;
  const parse = (d) => window.Utilities.parseDate(d, 'Asia/Taipei', 'yyyy-MM-dd');
  sheetRows('Loans').forEach((r, i) => {
    if (r.item_id === 'A01' || r.item_id === 'A02') sheet.getRange(i + 2, col).setValue(parse(addDays(-1)));
    if (r.item_id === 'A03') sheet.getRange(i + 2, col).setValue(parse(addDays(0)));
  });

  eq(ok('listOverdue', {}, true).map((r) => r.item_id), ['A01', 'A02'], '逾期清單');
  const res = window.sendOverdueReminders();
  eq(res.sent, [{ email: 'bob@example.com', items: 2 }], '寄送結果');
  eq(state.mails.length, 1, '只寄一封');
  eq(/A01/.test(state.mails[0].htmlBody) && /A02/.test(state.mails[0].htmlBody) && /1 天/.test(state.mails[0].htmlBody), true, '信件內容');
  eq(sheetRows('Loans').filter((r) => r.item_id === 'A01').map((r) => r.reminder_count), [1], '催還次數');
  eq(sheetRows('Logs').filter((r) => r.action === '催還通知').length, 2, '催還日誌');
});

test('信件內容會跳脫 HTML', () => {
  seedItems(['A01']);
  borrow(['A01'], { borrowerName: '<b>Bob</b>' });
  const sheet = state.spreadsheet.getSheetByName('Loans');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.getRange(2, headers.indexOf('expected_return_date') + 1)
    .setValue(window.Utilities.parseDate(addDays(-3), 'Asia/Taipei', 'yyyy-MM-dd'));
  window.sendOverdueReminders();
  eq(state.mails[0].htmlBody.includes('&lt;b&gt;Bob&lt;/b&gt;'), true, '姓名已跳脫');
});

test('刪除展品：從主檔移除、保留歷史並記錄日誌；借出中不能刪', () => {
  seedItems(['A01', 'A02', 'A03']);
  borrow(['A02']);
  ok('checkin', { itemIds: ['A02'] });
  borrow(['A03']);

  fails('deleteItem', { itemId: 'A01' }, false, /管理者密碼/);
  const res = ok('deleteItem', { itemId: 'a02', operatorName: '小王' }, true);
  eq(res, { item_id: 'A02', name: '展品 A02' }, '回傳');
  eq(sheetRows('Items').map((r) => r.item_id), ['A01', 'A03'], '主檔只剩 A01、A03');
  fails('getItem', { itemId: 'A02' }, false, /查無展品編號 A02/);
  eq(sheetRows('Loans').filter((r) => r.item_id === 'A02').length, 1, '借用紀錄保留');
  const del = sheetRows('Logs').filter((r) => r.item_id === 'A02').map((r) => r.action);
  eq(del, ['新增', '借出', '完全歸還', '刪除'], '日誌');
  eq(sheetRows('Logs').slice(-1)[0].operator, '管理者(小王)', '刪除者');

  fails('deleteItem', { itemId: 'A03' }, true, /借出中/);
  fails('deleteItem', { itemId: 'Z99' }, true, /查無展品編號/);
  eq(ok('getItem', { itemId: 'A03' }).status, '借出', '刪除 A02 後其他列不受影響');

  ok('saveItem', { item: { item_id: 'A02', name: '重新建立' }, isNew: true }, true);
  eq(ok('getItem', { itemId: 'A02' }).name, '重新建立', '刪除後可用同編號重新建立');
});

test('管理者密碼：8 碼小寫英數、不分大小寫、重設後舊密碼失效', () => {
  delete state.props.ADMIN_KEY;
  const key = window.ensureAdminKey_();
  eq(/^[a-km-np-z2-9]{8}$/.test(key), true, `格式（${key}）`);
  eq(window.ensureAdminKey_(), key, '已有密碼時不會重新產生');
  eq(call('verifyAdmin', { adminKey: key.toUpperCase() }).ok, true, '大寫也能登入');
  eq(call('verifyAdmin', { adminKey: ` ${key} ` }).ok, true, '前後空白會忽略');
  window.resetAdminKey();
  eq(state.props.ADMIN_KEY !== key && /^[a-km-np-z2-9]{8}$/.test(state.props.ADMIN_KEY), true, '重設後換成新的 8 碼密碼');
  eq(call('verifyAdmin', { adminKey: key }).ok, false, '舊密碼失效');
  eq(new Set(Array.from({ length: 200 }, () => window.newAdminKey_())).size, 200, '200 次產生都不重複');
});

test('未知動作與錯誤的管理者密碼會回傳錯誤', () => {
  fails('dropTables', {}, false, /未知的動作/);
  eq(call('verifyAdmin', { adminKey: 'wrong' }).ok, false, '錯誤密碼');
  eq(call('verifyAdmin', {}, true).ok, true, '正確密碼');
  state.props.ADMIN_KEY = '';
  eq(call('verifyAdmin', { adminKey: '' }).ok, false, '未設定密碼時，空字串不能通過');
});

async function run() {
  for (const name of GAS_FILES) await loadScript(`../apps-script/${name}.gs`);
  const results = [];
  for (const t of tests) {
    reset();
    try {
      t.fn();
      results.push({ name: t.name, pass: true });
    } catch (err) {
      results.push({ name: t.name, pass: false, error: err.message });
    }
  }
  const list = document.getElementById('results');
  results.forEach((r) => {
    const li = document.createElement('li');
    li.className = r.pass ? 'pass' : 'fail';
    li.textContent = r.pass ? `✓ ${r.name}` : `✗ ${r.name}\n${r.error}`;
    list.appendChild(li);
  });
  const passed = results.filter((r) => r.pass).length;
  document.getElementById('summary').textContent = `${passed} / ${results.length} 通過`;
  window.testResults = results;
}

run().catch((err) => {
  document.getElementById('summary').textContent = '測試無法執行：' + err.message;
  window.testResults = [{ name: 'load', pass: false, error: err.message }];
});
