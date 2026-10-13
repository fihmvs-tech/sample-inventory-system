/**
 * 借用、歸還（含分批歸還）、移轉與借用查詢。
 */

function newLoanId_(loans) {
  const used = {};
  loans.rows.forEach(function (r) { used[r.loan_id] = true; });
  const base = 'L' + Utilities.formatDate(new Date(), tz_(), 'yyMMdd-HHmmss');
  let id = base;
  for (let n = 2; used[id]; n++) id = base + '-' + n;
  return id;
}

function openLoanFor_(loans, itemId) {
  return loans.rows.find(function (r) { return r.item_id === itemId && r.status === LOAN_STATUS.OPEN; });
}

function upsertBorrower_(email, name) {
  const borrowers = openTable_(SHEET.BORROWERS);
  const existing = borrowers.rows.find(function (r) { return String(r.email).toLowerCase() === email; });
  const patch = { email: email, name: name, last_used_at: nowText_() };
  if (existing) updateRow_(borrowers, existing, patch);
  else insertRows_(borrowers, [patch]);
}

// 共用的借用資訊驗證：借用者、事由、預計歸還日。
function loanDetails_(req, settings) {
  const email = normalizeEmail_(req.borrowerEmail, settings);
  const name = String(req.borrowerName || '').trim();
  if (!name) throw new Error('請輸入借用者姓名');
  const reason = String(req.reason || '').trim();
  if (!reason) throw new Error('請選擇或輸入借用事由');
  const expected = String(req.expectedReturnDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw new Error('請選擇預計歸還日期');
  if (expected < today_()) throw new Error('預計歸還日期不能早於今天');
  return { email: email, name: name, reason: reason, expected: expected };
}

// 所有展品都通過檢查才寫入，避免一張借用單只成功一半。
function assertAll_(problems) {
  if (problems.length) throw new Error(problems.join('\n'));
}

function apiCheckout_(req) {
  const settings = settings_();
  const d = loanDetails_(req, settings);
  const itemIds = normalizeItemIds_(req.itemIds);
  const operator = isAdmin_(req.adminKey) ? adminOperator_(req) + '代填' : d.email;

  const items = openTable_(SHEET.ITEMS);
  const byId = indexBy_(items.rows, 'item_id');
  assertAll_(itemIds
    .filter(function (id) { return !byId[id] || byId[id].status !== ITEM_STATUS.IN_STOCK; })
    .map(function (id) { return byId[id] ? id + ' 目前狀態為「' + byId[id].status + '」，無法借用' : '查無展品編號 ' + id; }));

  const loans = openTable_(SHEET.LOANS);
  const loanId = newLoanId_(loans);
  const now = nowText_();
  insertRows_(loans, itemIds.map(function (id) {
    return {
      loan_id: loanId, item_id: id, item_name: byId[id].name,
      borrower_email: d.email, borrower_name: d.name, reason: d.reason,
      expected_return_date: d.expected, borrowed_at: now, operator: operator,
      status: LOAN_STATUS.OPEN, reminder_count: 0,
    };
  }));
  itemIds.forEach(function (id) {
    updateRow_(items, byId[id], {
      status: ITEM_STATUS.ON_LOAN,
      current_borrower_email: d.email,
      current_borrower_name: d.name,
      current_loan_id: loanId,
      expected_return_date: d.expected,
      updated_at: now,
    });
  });
  writeLogs_(itemIds.map(function (id) {
    return {
      action: ACTION.CHECKOUT, item_id: id, loan_id: loanId, borrower_email: d.email, operator: operator,
      detail: '事由：' + d.reason + '；預計歸還：' + d.expected,
    };
  }));
  upsertBorrower_(d.email, d.name);

  return {
    loanId: loanId,
    borrowerEmail: d.email,
    borrowerName: d.name,
    expectedReturnDate: d.expected,
    items: itemIds.map(function (id) { return { item_id: id, name: byId[id].name }; }),
  };
}

function apiCheckin_(req) {
  const itemIds = normalizeItemIds_(req.itemIds);
  const operator = isAdmin_(req.adminKey) ? adminOperator_(req) : '掃碼歸還';

  const items = openTable_(SHEET.ITEMS);
  const byId = indexBy_(items.rows, 'item_id');
  assertAll_(itemIds
    .filter(function (id) { return !byId[id] || byId[id].status !== ITEM_STATUS.ON_LOAN; })
    .map(function (id) { return byId[id] ? id + ' 目前狀態為「' + byId[id].status + '」，不需要歸還' : '查無展品編號 ' + id; }));

  const loans = openTable_(SHEET.LOANS);
  const now = nowText_();
  const returned = itemIds.map(function (id) {
    const item = byId[id];
    const loan = openLoanFor_(loans, id);
    if (loan) updateRow_(loans, loan, { status: LOAN_STATUS.RETURNED, returned_at: now, return_operator: operator });
    const info = {
      item_id: id,
      name: item.name,
      loan_id: loan ? loan.loan_id : item.current_loan_id,
      borrower_email: item.current_borrower_email,
      borrower_name: item.current_borrower_name,
    };
    updateRow_(items, item, {
      status: ITEM_STATUS.IN_STOCK,
      current_borrower_email: '',
      current_borrower_name: '',
      current_loan_id: '',
      expected_return_date: '',
      updated_at: now,
    });
    return info;
  });

  // 整批處理完再判斷：該借用單還有未還的展品就是「部分歸還」，否則「完全歸還」。
  const remaining = {};
  returned.forEach(function (r) {
    if (!(r.loan_id in remaining)) {
      remaining[r.loan_id] = loans.rows.filter(function (l) {
        return l.loan_id === r.loan_id && l.status === LOAN_STATUS.OPEN;
      }).length;
    }
  });
  writeLogs_(returned.map(function (r) {
    const left = remaining[r.loan_id];
    return {
      action: left ? ACTION.PARTIAL_RETURN : ACTION.FULL_RETURN,
      item_id: r.item_id, loan_id: r.loan_id, borrower_email: r.borrower_email, operator: operator,
      detail: left ? '借用單尚有 ' + left + ' 件未歸還' : '借用單已全部結清',
    };
  }));

  return {
    returned: returned.map(function (r) {
      return { item_id: r.item_id, name: r.name, loan_id: r.loan_id, borrower_name: r.borrower_name };
    }),
    loans: Object.keys(remaining).map(function (id) { return { loan_id: id, remaining: remaining[id] }; }),
  };
}

// 例：借 10 件去日本、還 5 件，剩下 5 件改帶去美國 → 把剩下的 5 件移轉到新的借用單（借用者可相同）。
function apiTransfer_(req) {
  const settings = settings_();
  const d = loanDetails_(req, settings);
  const itemIds = normalizeItemIds_(req.itemIds);
  const operator = adminOperator_(req);

  const items = openTable_(SHEET.ITEMS);
  const byId = indexBy_(items.rows, 'item_id');
  const loans = openTable_(SHEET.LOANS);
  assertAll_(itemIds
    .filter(function (id) { return !byId[id] || byId[id].status !== ITEM_STATUS.ON_LOAN || !openLoanFor_(loans, id); })
    .map(function (id) { return byId[id] ? id + ' 目前不是借出中，無法移轉' : '查無展品編號 ' + id; }));

  const loanId = newLoanId_(loans);
  const now = nowText_();
  const logs = [];
  const newRows = itemIds.map(function (id) {
    const old = openLoanFor_(loans, id);
    updateRow_(loans, old, { status: LOAN_STATUS.TRANSFERRED, returned_at: now, return_operator: operator });
    updateRow_(items, byId[id], {
      current_borrower_email: d.email,
      current_borrower_name: d.name,
      current_loan_id: loanId,
      expected_return_date: d.expected,
      updated_at: now,
    });
    logs.push({
      action: ACTION.TRANSFER, item_id: id, loan_id: loanId, borrower_email: d.email, operator: operator,
      detail: old.loan_id + '（' + old.borrower_name + '）→ ' + loanId + '（' + d.name + '）；事由：' + d.reason + '；預計歸還：' + d.expected,
    });
    return {
      loan_id: loanId, item_id: id, item_name: byId[id].name,
      borrower_email: d.email, borrower_name: d.name, reason: d.reason,
      expected_return_date: d.expected, borrowed_at: now, operator: operator,
      status: LOAN_STATUS.OPEN, reminder_count: 0,
    };
  });
  insertRows_(loans, newRows);
  writeLogs_(logs);
  upsertBorrower_(d.email, d.name);
  return { loanId: loanId, items: itemIds };
}

function openLoanView_(r) {
  return {
    loan_id: r.loan_id,
    item_id: r.item_id,
    item_name: r.item_name,
    borrower_email: r.borrower_email,
    borrower_name: r.borrower_name,
    reason: r.reason,
    borrowed_at: r.borrowed_at,
    expected_return_date: r.expected_return_date,
    overdue: isOverdue_(r.expected_return_date),
  };
}

function apiMyLoans_(req) {
  const email = normalizeEmail_(req.email, settings_());
  return openTable_(SHEET.LOANS).rows
    .filter(function (r) { return r.status === LOAN_STATUS.OPEN && String(r.borrower_email).toLowerCase() === email; })
    .map(openLoanView_);
}

function apiListOverdue_() {
  return openTable_(SHEET.LOANS).rows
    .filter(function (r) { return r.status === LOAN_STATUS.OPEN && isOverdue_(r.expected_return_date); })
    .map(openLoanView_);
}
