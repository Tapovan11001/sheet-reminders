import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_SCHEDULE, kindFor, plan, readSheet, templateProblems, addDays } from "../src/core/reminders.ts";
import { SAMPLE_SHEET, SAMPLE_TODAY, SETTINGS } from "../src/core/sample.ts";

test("schedule: 3 days before, on the day, 3 and 7 after, then weekly until 45", () => {
  const days = [];
  for (let late = -10; late <= 60; late++) if (kindFor(late, DEFAULT_SCHEDULE)) days.push(late);
  assert.deepEqual(days, [-3, 0, 3, 7, 14, 21, 28, 35, 42]);
  assert.equal(kindFor(-3, DEFAULT_SCHEDULE), "upcoming");
  assert.equal(kindFor(0, DEFAULT_SCHEDULE), "due");
  assert.equal(kindFor(14, DEFAULT_SCHEDULE), "overdue");
});

test("sample day: who gets what, and who is skipped", () => {
  const { send, skip } = plan(readSheet(SAMPLE_SHEET), SAMPLE_TODAY, SETTINGS);
  assert.deepEqual(send.map((r) => [r.entry.name, r.kind]), [
    ["Riya Sharma", "upcoming"],
    ["Kabir Singh", "due"],
    ["Ananya Iyer", "overdue"],
    ["Mohit Verma", "overdue"],
  ]);
  // Sara: paid. Dev: bad email. Ishita: due in 10 days. Arjun: already reminded today. Meera: past the 45-day cut-off.
  assert.deepEqual(skip.map((s) => [s.entry.name, s.reason]), [["Dev Patel", '"dev.patel@example" isn\'t a valid email']]);
  const kabir = send[1];
  assert.match(kabir.subject, /आज देय: ₹4,500/);
  assert.match(kabir.body, /नमस्ते Kabir/);
  assert.match(kabir.body, /upi:\/\/pay/);
  assert.match(send[3].body, /14 दिन पहले/);
  assert.match(send[2].subject, /^Overdue: ₹6,000/);
});

test("over 60 days, each unpaid row gets exactly the scheduled emails, never two in a day", () => {
  const entries = readSheet(SAMPLE_SHEET);
  const count = new Map<string, number>();
  for (let i = 0; i < 60; i++) {
    const day = addDays(SAMPLE_TODAY, i);
    const { send } = plan(entries, day, SETTINGS);
    for (const r of send) {
      count.set(r.entry.name, (count.get(r.entry.name) ?? 0) + 1);
      r.entry.lastReminded = day;
    }
    assert.equal(new Set(send.map((r) => r.entry.row)).size, send.length);
  }
  assert.equal(count.get("Sara Khan"), undefined); // paid
  assert.equal(count.get("Ishita Rao"), 9); // her whole schedule fits in the window
  assert.equal(count.get("Meera Joshi"), undefined); // already past the cut-off
});

test("Sheets values: Date objects, DD-MM-YYYY text, ₹ and commas", () => {
  const [e] = readSheet([["Student", "Email", "Fee", "Due Date", "Status"], ["A B", "a@b.co", "₹4,500", new Date(2026, 11, 13) as unknown as string, "unpaid"]]);
  assert.deepEqual([e.amount, e.due, e.lang, e.row], [4500, "2026-12-13", "en", 2]);
  assert.equal(readSheet([["Name", "Email", "Amount", "Due"], ["A", "a@b.co", 1, "13/12/2026"]])[0].due, "2026-12-13");
  assert.throws(() => readSheet([["Name", "Amount"]]), /needs a "email" column/);
});

test("custom templates are checked", () => {
  assert.deepEqual(templateProblems("Hi {name}, ₹{amount} due {due}."), []);
  assert.match(templateProblems("Hi {nam}, ₹{amount} due {due}.")[0], /Unknown placeholder \{nam\}/);
  assert.match(templateProblems("Hi {name}, please pay.").join(), /Needs \{amount\}/);
});

test("the generated Code.gs runs in a fake Apps Script and writes back to the sheet", () => {
  const code = readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  const sheetValues = SAMPLE_SHEET.map((r) => [...r]);
  const sent: { to: string; subject: string }[] = [];
  const logRows: unknown[][] = [];
  const range = (r: number, c: number, nr = 1, nc = 1) => ({
    getValues: () => sheetValues.slice(r - 1, r - 1 + nr).map((row) => row.slice(c - 1, c - 1 + nc)),
    setValue: (v: string) => { (sheetValues[r - 1] ??= [])[c - 1] = v; return range(r, c); },
    setFontWeight: () => range(r, c),
  });
  const payments = {
    getDataRange: () => ({ getValues: () => sheetValues }),
    getRange: range,
    getLastColumn: () => sheetValues[0].length,
  };
  const settings = { getRange: () => ({ getValues: () => [["Vidya Tuition Centre"], [""], [3], ["0, 3, 7"], [7], [45]] }) };
  const log = { appendRow: (r: unknown[]) => logRows.push(r) };
  const env = {
    SpreadsheetApp: { getActive: () => ({ getSheetByName: (n: string) => ({ Payments: payments, Settings: settings, "Reminder log": log })[n] ?? null, getName: () => "Fees" }) },
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: (o: { to: string; subject: string }) => sent.push(o) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: { formatDate: () => SAMPLE_TODAY },
    Session: { getScriptTimeZone: () => "Asia/Kolkata" },
  };
  const run = new Function(...Object.keys(env), code + "\nsendReminders(); sendReminders();");
  run(...Object.values(env));
  assert.deepEqual(sent.map((s) => s.to), ["riya.parent@example.com", "kabir.s@example.com", "ananya.i@example.com", "mohit.v@example.com"]); // second run sends nothing
  assert.equal(sheetValues[1][5], SAMPLE_TODAY);
  assert.equal(logRows.length, 4);
});
