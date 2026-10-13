/**
 * 初始化與維護：在 Apps Script 編輯器手動執行這些函式。
 *   setup()          建立工作表、預設設定、管理者金鑰與每日催還排程（可重複執行）
 *   showAdminKey()   在執行紀錄中顯示管理者金鑰
 *   resetAdminKey()  產生新的管理者金鑰（舊金鑰立即失效）
 */

function setup() {
  const ss = spreadsheet_();
  Object.keys(HEADERS).forEach(function (name) { ensureSheet_(ss, name, HEADERS[name]); });
  removeEmptyDefaultSheet_(ss);
  seedSettings_();
  ensureAdminKey_();
  installReminderTrigger_();
  Logger.log('初始化完成。管理者金鑰請執行 showAdminKey() 查看。');
}

function showAdminKey() {
  Logger.log('管理者金鑰：' + ensureAdminKey_());
}

function resetAdminKey() {
  PropertiesService.getScriptProperties().deleteProperty('ADMIN_KEY');
  Logger.log('新的管理者金鑰：' + ensureAdminKey_());
}

function ensureAdminKey_() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('ADMIN_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty('ADMIN_KEY', key);
  }
  return key;
}

// 建立工作表；已存在時只補上缺少的欄位，不動既有資料。
function ensureSheet_(ss, name, headers) {
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  const lastCol = sheet.getLastColumn();
  const current = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const missing = headers.filter(function (h) { return current.indexOf(h) < 0; });
  const existing = current.filter(Boolean);
  if (missing.length) {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  const all = existing.concat(missing);
  sheet.getRange(1, 1, 1, all.length).setFontWeight('bold').setBackground('#f1f3f4');
  sheet.setFrozenRows(1);
  all.forEach(function (h, i) {
    if (TEXT_COLUMNS.indexOf(h) >= 0 && sheet.getMaxRows() > 1) {
      sheet.getRange(2, i + 1, sheet.getMaxRows() - 1, 1).setNumberFormat('@');
    }
  });
  return sheet;
}

// 新試算表預設的空白「工作表1」用不到，順手刪掉。
function removeEmptyDefaultSheet_(ss) {
  ss.getSheets().forEach(function (sheet) {
    const name = sheet.getName();
    if (!HEADERS[name] && /^(Sheet1|工作表1|工作表 1)$/.test(name) && sheet.getLastRow() === 0) {
      ss.deleteSheet(sheet);
    }
  });
}

function seedSettings_() {
  const settings = openTable_(SHEET.SETTINGS);
  const have = indexBy_(settings.rows, 'key');
  insertRows_(settings, DEFAULT_SETTINGS
    .filter(function (s) { return !have[s[0]]; })
    .map(function (s) { return { key: s[0], value: s[1], description: s[2] }; }));
}

function installReminderTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'sendOverdueReminders'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  const hour = Math.min(23, Math.max(0, parseInt(settings_().REMINDER_HOUR, 10) || 17));
  ScriptApp.newTrigger('sendOverdueReminders').timeBased().everyDays(1).atHour(hour).inTimezone(tz_()).create();
}
