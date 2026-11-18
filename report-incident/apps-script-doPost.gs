/**
 * ADD THIS to the existing report app's Code.gs in Apps Script (do not replace anything).
 * It lets the GitHub-hosted page send a report to the same submitReport() as before,
 * so the log row, private photo folder, reference number, rate limit and emails
 * all behave exactly as they do today.
 *
 * Then: Deploy > Manage deployments > pencil icon > Version: "New version" > Deploy.
 * (Execute as: Me | Who has access: Anyone) and copy the Web app URL ending /exec
 * into report-config.js -> endpoint.
 */
function doPost(e) {
  var result;
  try {
    var p = JSON.parse(e.postData.contents);
    result = submitReport(p);
  } catch (err) {
    console.error(err);
    result = { ok: false, error: 'Something went wrong. Please tell a supervisor.' };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
