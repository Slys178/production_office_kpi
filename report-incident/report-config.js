/**
 * Report an incident — settings (classic script so the page and shim can read it).
 * sites / departments mirror the lists at the top of the Apps Script Code.gs;
 * the server checks reports against ITS copy, so keep the two in step.
 */
window.REPORT_CONFIG = {
  // The Apps Script web app "/exec" URL that saves reports (see README.md, step 1-2).
  // Leave empty until that is set up: the form will then say reporting is not connected.
  endpoint: "window.REPORT_CONFIG = {
  // The Apps Script web app "/exec" URL that saves reports (see README.md, step 1-2).
  // Leave empty until that is set up: the form will then say reporting is not connected.
  endpoint: "https://script.google.com/a/macros/staircraftgroup.com/s/AKfycbwvrKdagsSZMQrP2y2wWc-WwUJIwW5eRoezvoYOsEP_zmDriC0zljbhViqfTWws9jth/exec",",

  sites: ["Bayton Road", "Ansty", "Ibstock Road"],
  departments: {
    "Bayton Road": ["CNC", "1st Fix Assembly", "2nd Fix Assembly", "Paintline", "1st Fix Crosscut", "2nd Fix Crosscut", "Storage/Racking"],
    "Ansty": ["CNC", "1st Fix Assembly", "2nd Fix Assembly", "Paintline", "1st Fix Crosscut", "2nd Fix Crosscut", "Storage/Racking"],
    "Ibstock Road": ["CNC", "1st Fix Assembly", "2nd Fix Assembly", "Paintline", "1st Fix Crosscut", "2nd Fix Crosscut", "Storage/Racking"],
  },
};
