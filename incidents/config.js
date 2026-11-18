/**
 * Incidents — standalone configuration.
 * Everything the incidents module needs lives here, so it can be moved to Azure
 * (Static Web App / App Service) without touching the main KPI app.
 */
export const CONFIG = {
  incidents: {
    // Google Sheet that incident rows are appended to
    writeSheetId: "1DUpbMPbQFDFMSEZ4OiJDqy3mOd1WDAOZJgFyBQfH6B8",
    writeRange: "Form responses 1!A:AB",
    // Optional Drive folder for photo uploads ("" = My Drive root)
    driveFolderId: "",
    sites: ["Bayton Road", "Ansty", "Ibstock Road"],
    types: ["Near Miss or Unsafe Event", "Injury"],
    bodyParts: [
      "Finger", "Hand", "Wrist", "Arm", "Shoulder", "Head", "Eye", "Face",
      "Back", "Leg", "Knee", "Foot", "Toe", "Other",
    ],
  },

  // Google OAuth (token flow). Only the scopes incidents actually uses.
  // NOTE: when hosting on Azure, add the new site URL to "Authorised JavaScript
  // origins" on this OAuth client in Google Cloud Console.
  google: {
    clientId: "965947227076-hrls555o1pv7coftc80qng6chgtf0sh7.apps.googleusercontent.com",
    scopes:
      "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets",
  },

  // Local-device backup of reports (per browser / per origin)
  localStorageKey: "po_incidents_v1",
};
