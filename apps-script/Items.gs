/**
 * 展品主檔：查詢、新增／編輯、狀態變更、單品履歷。
 */

function isOverdue_(expectedDate) {
  return !!expectedDate && String(expectedDate) < today_();
}

function itemOverdue_(item) {
  return item.status === ITEM_STATUS.ON_LOAN && isOverdue_(item.expected_return_date);
}

// 不需管理者權限的查詢只回傳借用者姓名，不回傳 Email。
function publicItem_(item) {
  return {
    item_id: item.item_id,
    name: item.name,
    category: item.category,
    location: item.location,
    status: item.status,
    current_borrower_name: item.current_borrower_name,
    expected_return_date: item.expected_return_date,
    overdue: itemOverdue_(item),
  };
}

function findItem_(items, itemId) {
  const item = items.rows.find(function (r) { return r.item_id === itemId; });
  if (!item) throw new Error('查無展品編號 ' + itemId);
  return item;
}

function apiGetItem_(req) {
  const itemId = normalizeItemId_(req.itemId);
  return publicItem_(findItem_(openTable_(SHEET.ITEMS), itemId));
}

// 管理者看得到完整欄位（含借用者 Email）。
function adminItem_(item) {
  const out = Object.assign({}, item);
  delete out._row;
  out.overdue = itemOverdue_(item);
  return out;
}

function apiListItems_() {
  return openTable_(SHEET.ITEMS).rows.map(adminItem_);
}

function apiSaveItem_(req) {
  const input = req.item || {};
  const itemId = normalizeItemId_(input.item_id);
  const name = String(input.name || '').trim();
  if (!name) throw new Error('請輸入展品名稱');
  const fields = {
    name: name,
    category: String(input.category || '').trim(),
    location: String(input.location || '').trim(),
    note: String(input.note || '').trim(),
    updated_at: nowText_(),
  };

  const items = openTable_(SHEET.ITEMS);
  const existing = items.rows.find(function (r) { return r.item_id === itemId; });
  if (existing) {
    if (req.isNew) throw new Error('展品編號 ' + itemId + ' 已存在');
    updateRow_(items, existing, fields);
  } else {
    insertRows_(items, [Object.assign({ item_id: itemId, status: ITEM_STATUS.IN_STOCK, created_at: fields.updated_at }, fields)]);
  }
  writeLogs_([{
    action: existing ? ACTION.EDIT : ACTION.CREATE,
    item_id: itemId,
    operator: adminOperator_(req),
    detail: name,
  }]);
  return publicItem_(existing || items.rows[items.rows.length - 1]);
}

// 借出狀態只能透過借用／歸還流程改變，這裡只處理在庫、送修、遺失、報廢之間的切換。
function apiSetItemStatus_(req) {
  const itemId = normalizeItemId_(req.itemId);
  const status = String(req.status || '');
  const allowed = [ITEM_STATUS.IN_STOCK, ITEM_STATUS.REPAIR, ITEM_STATUS.LOST, ITEM_STATUS.RETIRED];
  if (allowed.indexOf(status) < 0) throw new Error('不支援的狀態：' + status);

  const items = openTable_(SHEET.ITEMS);
  const item = findItem_(items, itemId);
  if (item.status === ITEM_STATUS.ON_LOAN) throw new Error(itemId + ' 目前借出中，請先歸還再變更狀態');
  if (item.status === status) return publicItem_(item);

  const from = item.status;
  updateRow_(items, item, { status: status, updated_at: nowText_() });
  writeLogs_([{
    action: status === ITEM_STATUS.REPAIR ? ACTION.REPAIR : ACTION.STATUS,
    item_id: itemId,
    operator: adminOperator_(req),
    detail: from + ' → ' + status + (req.note ? '；' + String(req.note).trim() : ''),
  }]);
  return publicItem_(item);
}

function apiGetHistory_(req) {
  const itemId = normalizeItemId_(req.itemId);
  const item = findItem_(openTable_(SHEET.ITEMS), itemId);
  const strip = function (r) { const o = Object.assign({}, r); delete o._row; return o; };
  const logs = openTable_(SHEET.LOGS).rows
    .filter(function (r) { return r.item_id === itemId; })
    .map(strip)
    .reverse();
  const loans = openTable_(SHEET.LOANS).rows
    .filter(function (r) { return r.item_id === itemId; })
    .map(strip)
    .reverse();
  return { item: adminItem_(item), logs: logs, loans: loans };
}
