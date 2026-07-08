// 交大野协｜0710-0712 顺朝五台小主人抽签
// Vercel 版后端：把本文件粘贴到 Google Sheet -> 扩展程序 -> Apps Script -> Code.gs
// 部署为 Web 应用后，把 /exec 链接填到 Vercel 前端 index.html 顶部的 API_URL。

const CONFIG = {
  SHEET_NAME: '抽签结果',
  ADMIN_KEY: 'REPLACE_WITH_ADMIN_PASSWORD',
  ANGELS: ['粥','雨停','卡丁车','宋昊南','原平安','丁田','07','果子','菜狗','尺波','jim','kk','方言','小灵通','洞拐','果冻','洋芋','x10','佩奇','彬彬']
};

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = String(p.action || '').trim();
  let data;
  try {
    if (action === 'draw') data = drawAngel(p.name, p.userAgent);
    else if (action === 'mine') data = getMyResult(p.name);
    else if (action === 'admin') data = getAdminResults(p.key);
    else if (action === 'reset') data = resetAllResults(p.key);
    else data = { ok: true, message: '交大野协抽签 API 已部署' };
  } catch (err) {
    data = { ok: false, message: err && err.message ? err.message : '服务异常' };
  }
  return output_(data, p.callback);
}

function output_(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    return ContentService
      .createTextOutput(String(callback).replace(/[^a-zA-Z0-9_.$]/g, '') + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function drawAngel(ownerName, userAgent) {
  const name = String(ownerName || '').trim();
  if (!name) return { ok: false, message: '请先填写姓名 / 花名。' };

  const lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    const sheet = getSheet_();
    const rows = readRows_(sheet);
    const norm = normalize_(name);

    const existing = rows.find(r => r.norm === norm);
    if (existing) {
      return { ok: true, already: true, owner: existing.owner, angel: existing.angel, total: CONFIG.ANGELS.length, remaining: CONFIG.ANGELS.length - rows.length };
    }

    const assigned = new Set(rows.map(r => r.angel));
    let remaining = CONFIG.ANGELS.filter(a => !assigned.has(a));
    if (remaining.length === 0) return { ok: false, message: '20 支签已经全部抽完。' };

    let candidates = remaining.filter(a => normalize_(a) !== norm);
    if (candidates.length === 0) candidates = remaining;

    const angel = candidates[Math.floor(Math.random() * candidates.length)];
    sheet.appendRow([new Date(), name, norm, angel, userAgent || '']);

    return { ok: true, already: false, owner: name, angel: angel, total: CONFIG.ANGELS.length, remaining: remaining.length - 1 };
  } finally {
    lock.releaseLock();
  }
}

function getMyResult(ownerName) {
  const name = String(ownerName || '').trim();
  if (!name) return { ok: false, found: false };
  const rows = readRows_(getSheet_());
  const row = rows.find(r => r.norm === normalize_(name));
  if (!row) return { ok: true, found: false };
  return { ok: true, found: true, owner: row.owner, angel: row.angel };
}

function getAdminResults(key) {
  if (String(key || '') !== CONFIG.ADMIN_KEY) {
    return { ok: false, message: '管理员密码不正确。' };
  }
  const rows = readRows_(getSheet_()).map(r => ({
    time: formatTime_(r.time),
    owner: r.owner,
    angel: r.angel
  }));
  return {
    ok: true,
    rows: rows,
    total: CONFIG.ANGELS.length,
    drawn: rows.length,
    remaining: Math.max(CONFIG.ANGELS.length - rows.length, 0)
  };
}

function resetAllResults(key) {
  if (String(key || '') !== CONFIG.ADMIN_KEY) {
    return { ok: false, message: '管理员密码不正确。' };
  }
  const sheet = getSheet_();
  sheet.clear();
  sheet.appendRow(['抽签时间', '抽签人/小天使姓名花名', '标准化姓名', '抽中的小主人', '设备信息']);
  return { ok: true };
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['抽签时间', '抽签人/小天使姓名花名', '标准化姓名', '抽中的小主人', '设备信息']);
  }
  return sheet;
}

function readRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  return values
    .filter(r => r[1] && r[3])
    .map(r => ({ time: r[0], owner: String(r[1]), norm: String(r[2]), angel: String(r[3]), ua: String(r[4] || '') }));
}

function normalize_(v) {
  return String(v || '').trim().replace(/\s+/g, '').toLowerCase();
}

function formatTime_(d) {
  if (!d) return '';
  return Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}
