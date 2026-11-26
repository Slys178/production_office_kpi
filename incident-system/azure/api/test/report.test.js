const { test } = require("node:test");
const assert = require("node:assert");
const { submitReport } = require("../src/report");

const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString("base64");
const base = { type: "Near Miss", site: "Ansty", department: "CNC", date: "2026-11-26", time: "11:00", description: "Test", name: "Tester", elapsed: 9000, website: "", photos: [] };
const injury = { ...base, type: "Incident", anyoneHurt: "Yes", injuredName: "Secret Name", injuryType: "Cut", firstAid: "Yes", hospital: "No", ambulance: "No" };

function fakes(mailFails) {
  const saved = { reports: [], photos: [], mail: [], logs: [] };
  let ref = 0;
  return {
    saved,
    deps: {
      store: { nextRef: async () => ++ref, savePhoto: async (n) => saved.photos.push(n), saveReport: async (n, r) => saved.reports.push(r) },
      mail: { send: async (to, m) => { if (mailFails) throw new Error("down"); saved.mail.push({ to, ...m }); } },
      settings: { supervisors: "s@x.test", managers: "m@x.test; s@x.test", directors: "d@x.test" },
      log: (m) => saved.logs.push(m),
    },
  };
}

test("saves a near miss with a photo and emails supervisors and managers only", async () => {
  const f = fakes();
  assert.deepStrictEqual(await submitReport({ ...base, photos: [{ base64: jpg }] }, f.deps), { ok: true, ref: 1 });
  assert.deepStrictEqual(f.saved.photos, ["1/photo-1.jpg"]);
  assert.deepStrictEqual(f.saved.mail[0].to, ["s@x.test", "m@x.test"]);
});

for (const key of ["hospital", "ambulance"]) {
  test(`adds directors when ${key} is Yes, without personal details in the email`, async () => {
    const f = fakes();
    await submitReport({ ...injury, [key]: "Yes" }, f.deps);
    const m = f.saved.mail[0];
    assert.ok(m.to.includes("d@x.test"));
    assert.match(m.subject, /^SERIOUS/);
    assert.doesNotMatch(m.subject + m.body, /Secret|Cut/);
  });
}

test("first aid alone is not serious", async () => {
  const f = fakes();
  await submitReport(injury, f.deps);
  assert.ok(!f.saved.mail[0].to.includes("d@x.test"));
});

test("keeps the report if email fails", async () => {
  const f = fakes(true);
  assert.strictEqual((await submitReport(base, f.deps)).ok, true);
  assert.strictEqual(f.saved.reports.length, 1);
  assert.strictEqual(f.saved.logs.length, 1);
});

test("rejects spam, bad input and non-photos without saving", async () => {
  for (const bad of [{ website: "x" }, { elapsed: 10 }, { site: "Elsewhere" }, { description: " " }, { photos: [{ base64: Buffer.from("<svg>").toString("base64") }] }]) {
    const f = fakes();
    assert.strictEqual((await submitReport({ ...base, ...bad }, f.deps)).ok, false, JSON.stringify(bad));
    assert.strictEqual(f.saved.reports.length, 0);
  }
});
