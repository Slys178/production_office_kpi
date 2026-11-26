/**
 * Incident Log (managers app) — standalone configuration.
 * Mirrors the constants at the top of the original Apps Script Code.gs.
 */
export const CONFIG = {
  logSheetId: "1GlPcGP7ByU8SDv3XetsZn0oM33fnoUIrLLoEciBhaFg", // same ID as the report app
  sheetName: "Incidents",
  managers: ["simon.askew@staircraftgroup.com"], // add more managers here later

  // Restricted Google Drive folder for uploaded documents: the part of its web address
  // after /folders/. Leave empty until it is set up (uploads then say so).
  uploadFolderId: "",

  // Columns the case form writes. Missing headers are added to the sheet on first save.
  editable: [
    "Status",
    "Site",
    "Title",
    "Specific Location",
    "Sub Type",
    "Potential Severity",
    "Investigation Level",
    "Person Type",
    "Investigation",
    "Assigned To",
    "RIDDOR",
    "RIDDOR Date",
    "LTI",
    "Lost Days",
    "Actions Taken",
    "Corrective Action",
  ],

  // Google OAuth client (token flow). Replaces Apps Script's "Execute as: Me".
  // NOTE: add the hosting URL (and http://localhost:8000 for testing) to
  // "Authorised JavaScript origins" on this client in Google Cloud Console.
  google: {
    clientId: "965947227076-hrls555o1pv7coftc80qng6chgtf0sh7.apps.googleusercontent.com",
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",     // read log + write close-out
      "https://www.googleapis.com/auth/drive.readonly",   // read photos uploaded by the report app
      "https://www.googleapis.com/auth/userinfo.email",   // who is signed in (manager check)
    ].join(" "),
  },
};

// Writing into the upload folder needs Drive access; only asked for once the folder is set.
if (CONFIG.uploadFolderId) CONFIG.google.scopes += " https://www.googleapis.com/auth/drive";
