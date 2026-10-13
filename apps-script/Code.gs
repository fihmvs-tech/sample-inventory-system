/**
 * Web App 進入點：前端以 POST 傳入 JSON {action, ...參數}，回傳 {ok, data} 或 {ok:false, error}。
 * 前端用 Content-Type: text/plain 送出，避開 CORS 預檢請求。
 */

function doGet() {
  return json_({ ok: true, data: { service: 'sample-inventory-system', time: nowText_() } });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const route = routes_()[req.action];
    if (!route) throw new Error('未知的動作：' + req.action);
    if (route.admin && !isAdmin_(req.adminKey)) throw new Error('管理者金鑰錯誤，請重新登入管理者模式');
    const data = route.write ? withLock_(function () { return route.handler(req); }) : route.handler(req);
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

// 放在函式內建立，確保其他 .gs 檔的函式都已載入。
function routes_() {
  return {
    getConfig: { handler: apiGetConfig_ },
    getItem: { handler: apiGetItem_ },
    myLoans: { handler: apiMyLoans_ },
    checkout: { handler: apiCheckout_, write: true },
    checkin: { handler: apiCheckin_, write: true },
    verifyAdmin: { handler: function () { return { admin: true }; }, admin: true },
    listItems: { handler: apiListItems_, admin: true },
    saveItem: { handler: apiSaveItem_, admin: true, write: true },
    setItemStatus: { handler: apiSetItemStatus_, admin: true, write: true },
    deleteItem: { handler: apiDeleteItem_, admin: true, write: true },
    transfer: { handler: apiTransfer_, admin: true, write: true },
    getHistory: { handler: apiGetHistory_, admin: true },
    listOverdue: { handler: apiListOverdue_, admin: true },
    sendReminders: { handler: sendOverdueReminders_, admin: true, write: true },
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function apiGetConfig_(req) {
  const s = settings_();
  const admin = isAdmin_(req.adminKey);
  const config = {
    reasons: s.REASONS.split(',').map(function (r) { return r.trim(); }).filter(Boolean),
    emailDomain: s.EMAIL_DOMAIN.trim().replace(/^@/, ''),
    admin: admin,
  };
  // 借用者名單含 Email，只給管理者（代填時的下拉選單）。
  if (admin) {
    config.borrowers = openTable_(SHEET.BORROWERS).rows
      .sort(function (a, b) { return String(b.last_used_at).localeCompare(String(a.last_used_at)); })
      .map(function (r) { return { email: r.email, name: r.name }; });
  }
  return config;
}

// ---- 權限與輸入驗證 ----

function isAdmin_(key) {
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return !!real && !!key && String(key) === real;
}

function adminOperator_(req) {
  const name = String(req.operatorName || '').trim();
  return name ? '管理者(' + name + ')' : '管理者';
}

function normalizeEmail_(input, settings) {
  let email = String(input || '').trim().toLowerCase();
  const domain = String(settings.EMAIL_DOMAIN || '').trim().replace(/^@/, '').toLowerCase();
  if (email && email.indexOf('@') < 0 && domain) email += '@' + domain;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email 格式不正確：' + (input || '（空白）'));
  return email;
}

function normalizeItemId_(input) {
  const id = String(input || '').trim().toUpperCase();
  if (!/^[A-Z0-9._-]{1,40}$/.test(id)) throw new Error('展品編號格式不正確：' + (input || '（空白）'));
  return id;
}

function normalizeItemIds_(input) {
  if (!Array.isArray(input) || !input.length) throw new Error('請至少選擇一件展品');
  const seen = {};
  return input.map(normalizeItemId_).filter(function (id) {
    if (seen[id]) return false;
    seen[id] = true;
    return true;
  });
}
