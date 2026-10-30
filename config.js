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
    secondFix: {
      id: "1Bm_7Zeo2d2ZG3oDM-9F6fZ5X3QWvWmgkU4DumHfusb4",
      gidDaily: "0",
    },
  },

  // Google Drive / Identity
  drive: {
    clientId: "965947227076-hrls555o1pv7coftc80qng6chgtf0sh7.apps.googleusercontent.com",
    apiKey: "AIzaSyDxn2lFqZ0MeJR5ZkZrqpEnauq0j_EYlOI",
    scopes: "https://www.googleapis.com/auth/drive.readonly",
  },

  // Team members
  // SA = calendar-only (0 hours)
  // DK = temporary helper: same hours as SF; last week on capacity is W/C 19 Oct 2026
  people: [
    { initials: "SF", name: "Simon Faulks",        holidayName: "Simon Faulks",        color: "#4a90e2" },
    { initials: "LA", name: "Liam Aiello",          holidayName: "Liam Aiello",          color: "#2ecc71" },
    { initials: "AS", name: "Adam Stanislawski",    holidayName: "Adam Stanislawski",    color: "#f5a623" },
    { initials: "DF", name: "Dominika Formanowicz", holidayName: "Dominika Formanowicz", color: "#e74c3c" },
    { initials: "DK", name: "Dave King",            holidayName: "Dave King",            color: "#1abc9c" },
    { initials: "SA", name: "Simon Askew",          holidayName: "Simon Askew",          color: "#9b59b6" },
  ],

  // Working hours per person
  hours: {
    SF: { MonThu: 9, Fri: 6.5 },
    LA: { MonThu: 9, Fri: 6.5 },
    AS: { MonThu: 10.625, Fri: 0 },
    DF: { MonThu: 6, Fri: 3.5 },
    DK: { MonThu: 9, Fri: 6.5 },
    SA: { MonThu: 0, Fri: 0 },
  },

  // KPI targets & timing
  baseRate: 56 / 9,
  refreshMs: 3 * 60 * 1000,
  forecastWeeks: 8,
  trendWeeks: 4,

  // Default weekly stairs demand when no loads are entered yet
  defaultWeeklyStairs: 770,

  // Loads pagination
  loadsPageSize: 12,

  // Fully excluded from KPI display AND team capacity (calendar only)
  excludeFromKpiDisplay: "SA",

  // Temporary helpers: no personal dial / finish card
  hideIndividualKpi: ["DK"],

  // Last Monday (W/C) each temporary helper still counts in forecast capacity.
  // After this week they are excluded. Format: YYYY-MM-DD (that week's Monday).
  temporaryHelperLastWeek: {
    DK: "2026-10-19",
  },
};

/** @typedef {typeof CONFIG.people[number]} Person */
/** @typedef {keyof typeof CONFIG.hours} PersonInitials */
