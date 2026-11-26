/** POST /api/report - open to anyone (no sign-in), used by report-incident/. */
const { app } = require("@azure/functions");
const { submitReport } = require("../report");
const { azureStore, azureMail } = require("../azure-adapters");

const MAX_BODY = 56 * 1024 * 1024; // 4 photos of 10 MB, base64 encoded
let store;

app.http("report", {
  methods: ["POST"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    try {
      if (Number(request.headers.get("content-length") || 0) > MAX_BODY) {
        return { status: 413, jsonBody: { ok: false, error: "The photos are too large." } };
      }
      let payload;
      try {
        payload = JSON.parse(await request.text());
      } catch (_) {
        return { status: 400, jsonBody: { ok: false, error: "The report could not be read." } };
      }
      store = store || azureStore();
      const result = await submitReport(payload, {
        store,
        mail: azureMail(),
        settings: {
          supervisors: process.env.EMAIL_SUPERVISORS,
          managers: process.env.EMAIL_MANAGERS,
          directors: process.env.EMAIL_DIRECTORS,
          logUrl: process.env.INCIDENT_LOG_URL,
        },
        log: (m) => context.error(m),
      });
      return { jsonBody: result };
    } catch (e) {
      context.error(e);
      return { status: 500, jsonBody: { ok: false, error: "Something went wrong. Please tell a supervisor." } };
    }
  },
});
