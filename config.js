/**
 * Application configuration
 * Keep all magic numbers, sheet IDs, API credentials and static data here.
 */

export const CONFIG = {
  // Google Sheets
  sheets: {
    projectTracking: {
      id: "15aEtpNIDILzw_2n_KYWkBCefakqSt36jzGWredct3J4",
      gid: "1766737074",
    },
    holidays: {
      id: "1NYHtbL_-mepijGGXT7LRetqhEttLyaMYzOcKHzPzvB8",
      gid: "1781913538",
    },
    errors: {
      id: "1D5UT_gjWHN3LHHa0E1RfaWHuHB6badAVk80tB5tawns",
      gid: "360224276",
    },
    replacementParts: {
      id: "1my_N8O8D7d_UGODBMGxJNmTXvaH41mGtF7Q4Z7GQ9J4",
      gid: "0",
    },
  },

  // Google Drive / Identity
  drive: {
    clientId: "965947227076-hrls555o1pv7coftc80qng6chgtf0sh7.apps.googleusercontent.com",
    apiKey: "AIzaSyDxn2lFqZ0MeJR5ZkZrqpEnauq0j_EYlOI",
    scopes: "https://www.googleapis.com/auth/drive.readonly",
  },

  // Team members
  people: [
    { initials: "SF", name: "Simon Faulks",        holidayName: "Simon Faulks",        color: "#4a90e2" },
    { initials: "LA", name: "Liam Aiello",          holidayName: "Liam Aiello",          color: "#2ecc71" },
    { initials: "AS", name: "Adam Stanislawski",    holidayName: "Adam Stanislawski",    color: "#f5a623" },
    { initials: "DF", name: "Dominika Formanowicz", holidayName: "Dominika Formanowicz", color: "#e74c3c" },
  ],

  // Working hours per person
  hours: {
    SF: { MonThu: 9, Fri: 6.5 },
    LA: { MonThu: 9, Fri: 6.5 },
    AS: { MonThu: 9, Fri: 6.5 },
    DF: { MonThu: 6, Fri: 3.5 },
  },

  // KPI targets & timing
  // Target increased from 54 to 56
  baseRate: 56 / 9,
  refreshMs: 3 * 60 * 1000,
  forecastWeeks: 8,
  trendWeeks: 4,

  // Loads pagination
  loadsPageSize: 12,
};

/** @typedef {typeof CONFIG.people[number]} Person */
/** @typedef {keyof typeof CONFIG.hours} PersonInitials */
