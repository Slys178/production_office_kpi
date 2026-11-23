/**
 * Incident Log (managers app) — standalone configuration.
 * Mirrors the constants at the top of the original Apps Script Code.gs.
 */
export const CONFIG = {
  logSheetId: "1GlPcGP7ByU8SDv3XetsZn0oM33fnoUIrLLoEciBhaFg", // same ID as the report app
  sheetName: "Incidents",
  managers: ["simon.askew@staircraftgroup.com"], // add more managers here later

  // Columns a manager may change from the case form (must exist as sheet headers).
  // Phase 1 = Corin investigation fields that sit on the LOG, not the shop-floor app.
  editable: [
    "Status",
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
