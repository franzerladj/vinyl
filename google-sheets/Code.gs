/**
 * Crate → Google Sheets
 *
 * Einrichtung:
 * 1. Neues Google Sheet anlegen → Erweiterungen → Apps Script
 * 2. Diesen Code einfügen, SECRET unten ändern, speichern
 * 3. Bereitstellen → Neue Bereitstellung → Typ „Web-App“
 *    Ausführen als: Ich · Zugriff: Jeder
 * 4. Die Web-App-URL (…/exec) und das SECRET in Crate unter Einstellungen → Google Sheets eintragen
 */
const SECRET = "bitte-aendern";

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (body.secret !== SECRET) return json({ error: "Falsches Geheimwort" });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(body.sheets).forEach(function (name) {
    const rows = body.sheets[name];
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    sheet.clearContents();
    if (!rows.length) return;
    const width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    const padded = rows.map(function (r) {
      while (r.length < width) r.push("");
      return r;
    });
    sheet.getRange(1, 1, padded.length, width).setValues(padded);
    sheet.getRange(1, 1, 1, width).setFontWeight("bold");
    sheet.setFrozenRows(1);
  });
  return json({ ok: true });
}

function doGet(e) {
  if (e.parameter.secret !== SECRET) return json({ error: "Falsches Geheimwort" });
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(e.parameter.sheet || "Tracks");
  if (!sheet) return json({ error: "Blatt nicht gefunden" });
  return json({ rows: sheet.getDataRange().getValues() });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
