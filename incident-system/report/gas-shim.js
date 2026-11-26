/**
 * Apps Script compatibility shim.
 *
 * index.html is the original Apps Script page and calls google.script.run.getConfig()
 * and google.script.run.submitReport(p) (with .withSuccessHandler / .withFailureHandler).
 * This recreates that API outside Apps Script:
 *   getConfig    -> answered from report-config.js
 *   submitReport -> POSTed to the Apps Script web app, which still does the saving
 *                   (log sheet row, private photo folder, reference number, emails).
 * Classic (non-module) script on purpose: it must exist before the page script runs.
 */
(function () {
  var C = window.REPORT_CONFIG || {};

  var api = {
    getConfig: function () {
      return Promise.resolve({ sites: C.sites || [], departments: C.departments || {} });
    },
    submitReport: function (p) {
      if (!C.endpoint) {
        return Promise.resolve({ ok: false, error: "Reporting is not connected yet. Please tell a supervisor." });
      }
      // text/plain keeps this a "simple" request, so the browser sends no CORS preflight
      // (Apps Script web apps cannot answer one).
      return fetch(C.endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(p),
        redirect: "follow",
      }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      });
    },
  };

  function runner(ok, fail) {
    var r = {
      withSuccessHandler: function (f) { return runner(f, fail); },
      withFailureHandler: function (f) { return runner(ok, f); },
    };
    Object.keys(api).forEach(function (name) {
      r[name] = function () {
        api[name].apply(null, arguments).then(
          function (res) { if (ok) ok(res); },
          function (e) { if (fail) fail(e); else console.error(name, e); }
        );
      };
    });
    return r;
  }

  window.google = window.google || {};
  window.google.script = { run: runner(null, null) };
})();
