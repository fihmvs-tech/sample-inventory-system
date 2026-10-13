// 在瀏覽器中模擬 Apps Script 會用到的 Google 服務（SpreadsheetApp、Utilities…），
// 讓 apps-script/*.gs 原封不動地在瀏覽器執行。用途：示範模式與自動化測試。
// 只實作本專案用到的 API；時區固定以 UTC+8（Asia/Taipei，無日光節約）計算。

const TZ = 'Asia/Taipei';
const OFFSET_MS = 8 * 3600 * 1000;

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function formatDate(date, _tz, fmt) {
  const d = new Date(date.getTime() + OFFSET_MS);
  const parts = {
    yyyy: d.getUTCFullYear(),
    yy: pad(d.getUTCFullYear() % 100),
    MM: pad(d.getUTCMonth() + 1),
    dd: pad(d.getUTCDate()),
    HH: pad(d.getUTCHours()),
    mm: pad(d.getUTCMinutes()),
    ss: pad(d.getUTCSeconds()),
  };
  return fmt.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, (t) => parts[t]);
}

function parseDate(text, _tz, fmt) {
  const order = [];
  const pattern = fmt.replace(/yyyy|MM|dd|HH|mm|ss/g, (t) => {
    order.push(t);
    return t === 'yyyy' ? '(\\d{4})' : '(\\d{2})';
  });
  const m = new RegExp('^' + pattern + '$').exec(text);
  if (!m) throw new Error('Unparseable date: ' + text);
  const v = { yyyy: 1970, MM: 1, dd: 1, HH: 0, mm: 0, ss: 0 };
  order.forEach((t, i) => { v[t] = Number(m[i + 1]); });
  return new Date(Date.UTC(v.yyyy, v.MM - 1, v.dd, v.HH, v.mm, v.ss) - OFFSET_MS);
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1) {
      throw new Error(`Invalid range (${row}, ${col}, ${numRows}, ${numCols})`);
    }
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const src = this.sheet.data[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = src[this.col - 1 + c];
        line.push(v === undefined || v === null ? '' : v instanceof Date ? new Date(v) : v);
      }
      out.push(line);
    }
    return out;
  }
  getValue() {
    return this.getValues()[0][0];
  }
  setValues(values) {
    if (values.length !== this.numRows || values.some((r) => r.length !== this.numCols)) {
      throw new Error('setValues: dimensions do not match the range');
    }
    values.forEach((line, r) => {
      const target = (this.sheet.data[this.row - 1 + r] ||= []);
      line.forEach((v, c) => { target[this.col - 1 + c] = v instanceof Date ? new Date(v) : v; });
    });
    for (let i = 0; i < this.sheet.data.length; i++) this.sheet.data[i] ||= [];
    return this;
  }
  setValue(v) {
    return this.setValues([[v]]);
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

class FakeSheet {
  constructor(name, data = []) {
    this.name = name;
    this.data = data;
  }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.data.length; r > 0; r--) {
      if ((this.data[r - 1] || []).some((v) => v !== '' && v !== undefined && v !== null)) return r;
    }
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.data.forEach((row) => {
      (row || []).forEach((v, c) => { if (v !== '' && v !== undefined && v !== null) max = Math.max(max, c + 1); });
    });
    return max;
  }
  getMaxRows() { return Math.max(1000, this.data.length); }
  deleteRow(row) { this.data.splice(row - 1, 1); return this; }
  getRange(row, col, numRows = 1, numCols = 1) { return new FakeRange(this, row, col, numRows, numCols); }
  getDataRange() {
    return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }
  setFrozenRows() { return this; }
}

class FakeSpreadsheet {
  constructor(sheets = [new FakeSheet('工作表1')]) {
    this.sheets = sheets;
  }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }
  deleteSheet(sheet) { this.sheets = this.sheets.filter((s) => s !== sheet); }
}

// ---- 序列化（示範模式把資料存在 localStorage） ----

function encodeCell(v) {
  return v instanceof Date ? { $d: v.getTime() } : v;
}

function decodeCell(v) {
  return v && typeof v === 'object' && '$d' in v ? new Date(v.$d) : v;
}

export function serialize(state) {
  return JSON.stringify({
    sheets: state.spreadsheet.sheets.map((s) => ({ name: s.name, data: s.data.map((r) => (r || []).map(encodeCell)) })),
    props: state.props,
    mails: state.mails,
  });
}

export function deserialize(text) {
  const raw = JSON.parse(text);
  return {
    spreadsheet: new FakeSpreadsheet(raw.sheets.map((s) => new FakeSheet(s.name, s.data.map((r) => r.map(decodeCell))))),
    props: raw.props || {},
    mails: raw.mails || [],
    triggers: [],
  };
}

export function freshState() {
  return { spreadsheet: new FakeSpreadsheet(), props: {}, mails: [], triggers: [] };
}

/**
 * 把模擬服務裝到 target（通常是 window）上。之後載入的 .gs 腳本會使用 state 裡的資料。
 */
export function installFakes(target, state) {
  target.SpreadsheetApp = {
    getActiveSpreadsheet: () => state.spreadsheet,
    openById: () => state.spreadsheet,
  };
  target.Session = { getScriptTimeZone: () => TZ };
  target.Utilities = {
    formatDate,
    parseDate,
    getUuid: () => crypto.randomUUID(),
  };
  target.LockService = {
    getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }),
  };
  target.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (k in state.props ? state.props[k] : null),
      setProperty: (k, v) => { state.props[k] = String(v); },
      deleteProperty: (k) => { delete state.props[k]; },
    }),
  };
  target.MailApp = {
    sendEmail: (message) => { state.mails.push({ ...message, sentAt: new Date().toISOString() }); },
  };
  target.ContentService = {
    MimeType: { JSON: 'application/json' },
    createTextOutput: (content) => ({ getContent: () => content, setMimeType() { return this; } }),
  };
  target.Logger = { log: (...args) => console.log('[Apps Script]', ...args) };
  target.ScriptApp = {
    getProjectTriggers: () => state.triggers.slice(),
    deleteTrigger: (t) => { state.triggers = state.triggers.filter((x) => x !== t); },
    newTrigger: (handler) => {
      const spec = { handler };
      const builder = {
        timeBased: () => builder,
        everyDays: (n) => { spec.everyDays = n; return builder; },
        atHour: (h) => { spec.atHour = h; return builder; },
        inTimezone: (tz) => { spec.tz = tz; return builder; },
        create: () => {
          const trigger = { ...spec, getHandlerFunction: () => handler };
          state.triggers.push(trigger);
          return trigger;
        },
      };
      return builder;
    },
  };
  return state;
}

// apps-script/ 裡的檔案，依載入順序排列。
export const GAS_FILES = ['Config', 'Db', 'Items', 'Loans', 'Notify', 'Setup', 'Code'];

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error('無法載入 ' + src));
    document.head.appendChild(el);
  });
}
