/**
 * Apps Script compatibility shim.
 *
 * index.html is the original Apps Script page and calls google.script.run.<fn>()
 * with .withSuccessHandler() / .withFailureHandler(). Outside Apps Script that API
 * doesn't exist, so this recreates it and routes the calls to backend.js.
 * Classic (non-module) script on purpose: it must exist before the page script runs.
 */
(function () {
  function runner(ok, fail) {
    var r = {
      withSuccessHandler: function (f) { return runner(f, fail); },
      withFailureHandler: function (f) { return runner(ok, f); },
    };
    ["getData", "getPhoto", "saveCloseOut"].forEach(function (name) {
      r[name] = function () {
        var args = [].slice.call(arguments);
        import("./backend.js")
          .then(function (m) { return m[name].apply(null, args); })
          .then(
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
