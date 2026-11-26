/**
 * Report handling rules. No Azure code in here, so it can be tested anywhere.
 * `store` and `mail` are passed in (see azure-adapters.js).
 */
const SITES = ["Bayton Road", "Ansty", "Ibstock Road"];
const DEPARTMENTS = ["CNC", "1st Fix Assembly", "2nd Fix Assembly", "Paintline", "1st Fix Crosscut", "2nd Fix Crosscut", "Storage/Racking"];
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

class Rejected extends Error {}

const text = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
const yesNo = (v) => (v === "Yes" || v === "No" ? v : "");

/** Work out the photo type from its first bytes, not from what the browser claims. */
function photoType(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ["jpg", "image/jpeg"];
  if (b.subarray(0, 4).toString("hex") === "89504e47") return ["png", "image/png"];
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return ["webp", "image/webp"];
  if (b.toString("ascii", 4, 8) === "ftyp" && /^(heic|heix|mif1|msf1)$/.test(b.toString("ascii", 8, 12))) return ["heic", "image/heic"];
  return null;
}

function parseReport(p) {
  if (!p || typeof p !== "object") throw new Rejected("The report was empty.");
  // Spam traps used by the form: a hidden box, and forms filled in impossibly fast
  if (p.website || !(Number(p.elapsed) >= 3000)) throw new Rejected("Could not send. Please try again.");

  const r = {
    type: text(p.type, 20), site: text(p.site, 40), department: text(p.department, 60),
    date: text(p.date, 10), time: text(p.time, 5), description: text(p.description, 400), reporter: text(p.name, 80),
    anyoneHurt: "",
  };
  if (r.type !== "Incident" && r.type !== "Near Miss") throw new Rejected("Please choose Incident or Near Miss.");
  if (!SITES.includes(r.site)) throw new Rejected("Please choose the site.");
  if (!DEPARTMENTS.includes(r.department)) throw new Rejected("Please choose the site department.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || isNaN(Date.parse(r.date))) throw new Rejected("Please enter the date.");
  if (!/^\d{2}:\d{2}$/.test(r.time)) throw new Rejected("Please enter the time.");
  if (!r.description) throw new Rejected("Please describe what happened.");
  if (!r.reporter) throw new Rejected("Please enter your name.");

  if (r.type === "Incident") r.anyoneHurt = yesNo(p.anyoneHurt);
  if (r.anyoneHurt === "Yes") {
    Object.assign(r, {
      injuredPerson: text(p.injuredName, 80), lineManager: text(p.lineManager, 80),
      injuryType: text(p.injuryType === "Other" ? p.injuryOther || "Other" : p.injuryType, 100),
      bodyParts: text(p.bodyPart, 500),
      firstAid: yesNo(p.firstAid), firstAidBy: text(p.firstAidBy, 80), firstAidWhat: text(p.firstAidWhat, 200),
      hospital: yesNo(p.hospital), ambulance: yesNo(p.ambulance),
    });
  }

  const list = Array.isArray(p.photos) ? p.photos : [];
  if (list.length > MAX_PHOTOS) throw new Rejected("Please send no more than 4 photos.");
  const photos = list.map((ph) => {
    const bytes = Buffer.from(String((ph && ph.base64) || ""), "base64");
    if (bytes.length > MAX_PHOTO_BYTES) throw new Rejected("A photo is too large (10 MB limit).");
    const kind = photoType(bytes);
    if (!kind) throw new Rejected("One of the files is not a photo we can accept.");
    return { bytes, extension: kind[0], contentType: kind[1] };
  });
  return { report: r, photos };
}

/** Serious at the time of reporting. (High/Critical severity is set later, in the log.) */
const isSerious = (r) => r.hospital === "Yes" || r.ambulance === "Yes";

const emails = (list) => String(list || "").split(/[;,]/).map((s) => s.trim()).filter(Boolean);

/** Supervisors and managers always; directors as well when serious. */
function recipients(settings, serious) {
  const all = emails(settings.supervisors).concat(emails(settings.managers), serious ? emails(settings.directors) : []);
  return [...new Set(all.map((e) => e.toLowerCase()))];
}

/** Deliberately no names, injuries or description: email gets forwarded. */
function emailFor(ref, r, serious, logUrl) {
  return {
    subject: `${serious ? "SERIOUS: " : ""}${r.type} #${ref} - ${r.site}`,
    body: [
      `A ${r.type.toLowerCase()} has been reported${serious ? " and is marked SERIOUS (hospital or ambulance)" : ""}.`,
      "",
      `Reference: ${ref}`,
      `Site: ${r.site} / ${r.department}`,
      `When: ${r.date.split("-").reverse().join("/")} ${r.time}`,
      "",
      logUrl ? `Details are in the incident log: ${logUrl}` : "Details are in the incident log.",
    ].join("\n"),
  };
}

async function submitReport(payload, { store, mail, settings, log }) {
  let parsed;
  try {
    parsed = parseReport(payload);
  } catch (e) {
    if (e instanceof Rejected) return { ok: false, error: e.message };
    throw e;
  }
  const { report, photos } = parsed;
  const serious = isSerious(report);
  const ref = await store.nextRef();
  const names = [];
  for (let i = 0; i < photos.length; i++) {
    const name = `${ref}/photo-${i + 1}.${photos[i].extension}`;
    await store.savePhoto(name, photos[i].bytes, photos[i].contentType);
    names.push(name);
  }
  await store.saveReport(ref, { ...report, serious, status: "Open", photos: names.join("\n"), reported: new Date().toISOString() });

  // The report is saved by now, so an email problem must not tell the reporter it failed
  try {
    const to = recipients(settings, serious);
    if (!to.length) throw new Error("No email recipients are configured");
    await mail.send(to, emailFor(ref, report, serious, settings.logUrl));
  } catch (e) {
    log(`Report ${ref} saved, but the email was not sent: ${e.message}`);
  }
  return { ok: true, ref };
}

module.exports = { submitReport, parseReport, isSerious, recipients, SITES, DEPARTMENTS };
