/**
 * Cutistic – Feedback receiver (Google Apps Script web app).
 * Paste into the Google Sheet: Extensions → Apps Script, then Deploy → Web app
 * (Execute as: Me, Who has access: Anyone). Put the /exec URL in VITE_FEEDBACK_URL.
 */

// true = you get an email for every new feedback (free Gmail: up to 100 emails / day).
const EMAIL_ALERTS = true;
const SHEET_NAME = 'Feedback';
const HEADERS = ['Date', 'Type', 'Message', 'Name', 'Email', 'Browser', 'OS', 'Screen', 'Window', 'Language', 'WebGL2', 'WebGPU', 'WebCodecs', 'Cores', 'Memory', 'Page', 'Status'];

function doPost(e) {
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const message = clean(d.message, 5000);
    if (message.length < 10) return reply({ ok: false, error: 'Message is too short.' });

    // Simple flood protection: at most 30 messages a minute in total.
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get('rate') || 0);
    if (n >= 30) return reply({ ok: false, error: 'Too many messages right now – please try again in a minute.' });
    cache.put('rate', String(n + 1), 60);

    const t = d.tech || {};
    const row = [
      new Date(), clean(d.kind, 30), message, clean(d.name, 100), clean(d.email, 200),
      clean(t.browser, 60), clean(t.os, 60), clean(t.screen, 40), clean(t.window, 40), clean(t.language, 20),
      clean(t.webgl2, 5), clean(t.webgpu, 5), clean(t.webcodecs, 5), clean(t.cores, 5), clean(t.memory, 10), clean(t.page, 100),
      'New',
    ];
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      sheet().appendRow(row);
    } finally {
      lock.releaseLock();
    }

    if (EMAIL_ALERTS) {
      try {
        MailApp.sendEmail({
          to: Session.getEffectiveUser().getEmail(),
          subject: 'Cutistic feedback: ' + row[1],
          body: message + '\n\nName: ' + (row[3] || '-') + '\nEmail: ' + (row[4] || '-') + '\nBrowser: ' + (row[5] || '-') + ' / ' + (row[6] || '-') +
            '\n\nAll feedback: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl(),
          replyTo: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(row[4]) ? row[4] : undefined,
        });
      } catch (mailErr) {
        // Daily email quota reached: the row is saved anyway.
      }
    }
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: 'Could not save your feedback. Please try again.' });
  }
}

// Opening the /exec URL in a browser shows this – handy to check the deployment works.
function doGet() {
  return reply({ ok: true, service: 'Cutistic feedback' });
}

function sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#2fbf71').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(3, 420);
    sh.getRange('C:C').setWrap(true);
    sh.getRange('A:A').setNumberFormat('yyyy-mm-dd hh:mm');
  }
  return sh;
}

// Text only, trimmed, length-capped; a leading = + - @ would make the Sheet run it as a formula.
function clean(v, max) {
  let s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
