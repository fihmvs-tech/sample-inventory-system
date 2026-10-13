/**
 * 試算表存取層：把每張工作表當成一個以標題列為欄位的資料表。
 */

function spreadsheet_() {
  // 綁定在試算表上的腳本直接用目前的試算表；獨立腳本則在指令碼屬性設定 SPREADSHEET_ID。
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function tz_() {
  return Session.getScriptTimeZone();
}

function nowText_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
}

function today_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function isDateColumn_(header) {
  return /_date$/.test(header);
}

function isTimeColumn_(header) {
  return /_at$/.test(header) || header === 'timestamp';
}

// 儲存格 → 程式：日期一律轉成字串，讓比較與 JSON 輸出都單純。
function fromCell_(header, value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, tz_(), isDateColumn_(header) ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
  }
  if (TEXT_COLUMNS.indexOf(header) >= 0 && value !== '') return String(value);
  return value;
}

// 程式 → 儲存格：日期字串轉回 Date，試算表上才會是可排序、可篩選的日期。
function toCell_(header, value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' && value) {
    if (isDateColumn_(header) && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return Utilities.parseDate(value, tz_(), 'yyyy-MM-dd');
    }
    if (isTimeColumn_(header) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
      return Utilities.parseDate(value, tz_(), 'yyyy-MM-dd HH:mm:ss');
    }
  }
  return value;
}

function openTable_(name) {
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('找不到工作表「' + name + '」，請先在 Apps Script 編輯器執行 setup()');
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i].every(function (cell) { return cell === ''; })) continue;
    const row = { _row: i + 1 };
    headers.forEach(function (h, j) { row[h] = fromCell_(h, values[i][j]); });
    rows.push(row);
  }
  return { name: name, sheet: sheet, headers: headers, rows: rows };
}

function insertRows_(table, objects) {
  if (!objects.length) return;
  const values = objects.map(function (o) {
    return table.headers.map(function (h) { return toCell_(h, o[h]); });
  });
  const start = table.sheet.getLastRow() + 1;
  table.sheet.getRange(start, 1, values.length, table.headers.length).setValues(values);
  objects.forEach(function (o, i) {
    o._row = start + i;
    table.rows.push(o);
  });
}

// 整列寫回（一次 API 呼叫），比逐格 setValue 快很多。
function updateRow_(table, row, patch) {
  Object.assign(row, patch);
  const values = table.headers.map(function (h) { return toCell_(h, row[h]); });
  table.sheet.getRange(row._row, 1, 1, table.headers.length).setValues([values]);
}

function indexBy_(rows, key) {
  const map = {};
  rows.forEach(function (r) { map[r[key]] = r; });
  return map;
}

function writeLogs_(entries) {
  if (!entries.length) return;
  const ts = nowText_();
  insertRows_(openTable_(SHEET.LOGS), entries.map(function (e) {
    return Object.assign({ timestamp: ts }, e);
  }));
}

function settings_() {
  const map = {};
  DEFAULT_SETTINGS.forEach(function (s) { map[s[0]] = s[1]; });
  openTable_(SHEET.SETTINGS).rows.forEach(function (r) {
    if (r.key) map[r.key] = String(r.value);
  });
  return map;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}
