// Google Apps Script the user pastes into their sheet (Extensions → Apps Script)
// and deploys as a Web app. It lets the tools append/update rows, and can
// trigger a workflow webhook whenever a new row is added.
export const APPS_SCRIPT = `// My Tools ↔ Google Sheets bridge
// 1. Extensions → Apps Script → paste this → Save
// 2. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → Deploy
// 3. Copy the /exec URL into My Tools → Settings → "Apps Script web app URL"
// Optional: to trigger a workflow on every new row, set WORKFLOW_WEBHOOK below
// and add a trigger: Triggers → Add → onRowAdded → From spreadsheet → On change.
const WORKFLOW_WEBHOOK = ""; // e.g. https://your-app.vercel.app/api/hooks/abc123?key=xyz

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
function headers_(sh, keys) {
  let head = sh.getLastColumn() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].filter(String) : [];
  const missing = keys.filter(k => head.indexOf(k) < 0);
  if (missing.length) { head = head.concat(missing); sh.getRange(1, 1, 1, head.length).setValues([head]); }
  return head;
}
function doPost(e) {
  const b = JSON.parse(e.postData.contents || "{}");
  const sh = sheet_(b.sheet || "Sheet1");
  const rows = b.rows || (b.row ? [b.row] : []);
  const keys = b.columns || Object.keys(rows[0] || {});
  const head = headers_(sh, keys);
  if (b.action === "update" && b.matchColumn) {
    const col = head.indexOf(b.matchColumn) + 1;
    const data = sh.getDataRange().getValues();
    let updated = 0;
    rows.forEach(r => {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][col - 1]) === String(r[b.matchColumn])) {
          head.forEach((h, j) => { if (r[h] !== undefined) sh.getRange(i + 1, j + 1).setValue(r[h]); });
          updated++; return;
        }
      }
      sh.appendRow(head.map(h => r[h] !== undefined ? r[h] : ""));
    });
    return out_({ ok: true, updated });
  }
  rows.forEach(r => sh.appendRow(head.map(h => r[h] !== undefined ? r[h] : "")));
  return out_({ ok: true, appended: rows.length });
}
function doGet(e) {
  const sh = sheet_((e.parameter && e.parameter.sheet) || "Sheet1");
  const [head, ...data] = sh.getDataRange().getValues();
  return out_({ rows: data.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]]))) });
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// Fires the workflow webhook with the newest row (needs the On change trigger).
function onRowAdded(e) {
  if (!WORKFLOW_WEBHOOK || (e && e.changeType && e.changeType !== "INSERT_ROW" && e.changeType !== "EDIT")) return;
  const sh = SpreadsheetApp.getActiveSheet();
  const props = PropertiesService.getScriptProperties();
  const k = "last_" + sh.getName(), last = Number(props.getProperty(k) || 1), n = sh.getLastRow();
  if (n <= last) return;
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  for (let i = last + 1; i <= n; i++) {
    const r = sh.getRange(i, 1, 1, head.length).getValues()[0];
    const row = Object.fromEntries(head.map((h, j) => [h, r[j]]));
    row._row = i; row._sheet = sh.getName();
    UrlFetchApp.fetch(WORKFLOW_WEBHOOK, { method: "post", contentType: "application/json", payload: JSON.stringify(row), muteHttpExceptions: true });
  }
  props.setProperty(k, String(n));
}
`;
