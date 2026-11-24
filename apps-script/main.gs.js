// ---- Google Sheets side. Everything above this line is generated from src/core/reminders.ts. ----

const SHEET = "Payments";
const LOG = "Reminder log";
const SETTINGS = "Settings";
const HEADERS = ["Name", "Email", "Amount", "Due date", "Status", "Last reminded", "Language"];

/** Adds a "Reminders" menu when the sheet opens. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Reminders")
    .addItem("Preview today's reminders", "previewReminders")
    .addItem("Send today's reminders now", "sendReminders")
    .addSeparator()
    .addItem("Set up sheets and daily 9 AM run", "setup")
    .addItem("Stop the daily run", "removeTrigger")
    .addToUi();
}

/** Creates the three sheets if they're missing and installs one daily trigger. Safe to run twice. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.getRange("D:D").setNumberFormat("dd-mm-yyyy");
    sh.getRange("F:F").setNumberFormat("dd-mm-yyyy");
    sh.getRange("E2:E").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Unpaid", "Paid"], true).build());
  }
  let st = ss.getSheetByName(SETTINGS);
  if (!st) {
    st = ss.insertSheet(SETTINGS);
    st.getRange(1, 1, 6, 2).setValues([
      ["Business name", ss.getName()],
      ["Payment link (UPI or page, optional)", ""],
      ["First reminder, days before due", DEFAULT_SCHEDULE.before],
      ["Follow-ups, days after due (comma separated)", DEFAULT_SCHEDULE.after.join(", ")],
      ["Then repeat every N days (0 = stop)", DEFAULT_SCHEDULE.thenEvery],
      ["Stop after this many days late", DEFAULT_SCHEDULE.maxAfter],
    ]);
    st.setColumnWidth(1, 320);
  }
  if (!ss.getSheetByName(LOG)) {
    const lg = ss.insertSheet(LOG);
    lg.getRange(1, 1, 1, 6).setValues([["Sent at", "Row", "Name", "Email", "Type", "Subject"]]).setFontWeight("bold");
    lg.setFrozenRows(1);
  }
  removeTrigger();
  ScriptApp.newTrigger("sendReminders").timeBased().everyDays(1).atHour(9).create();
  SpreadsheetApp.getUi().alert("Done. Reminders will go out every day around 9 AM. Use the Reminders menu to preview or send now.");
}

function removeTrigger() {
  for (const t of ScriptApp.getProjectTriggers()) if (t.getHandlerFunction() === "sendReminders") ScriptApp.deleteTrigger(t);
}

function readSettings_() {
  const st = SpreadsheetApp.getActive().getSheetByName(SETTINGS);
  const v = st ? st.getRange(1, 2, 6, 1).getValues().map((r) => r[0]) : [];
  const n = (x, d) => (x === "" || x === null || x === undefined || Number.isNaN(Number(x)) ? d : Number(x));
  const after = String(v[3] ?? "").split(/[,\s]+/).filter(Boolean).map(Number).filter((x) => x >= 0);
  return {
    business: String(v[0] || SpreadsheetApp.getActive().getName()),
    payLink: String(v[1] || ""),
    schedule: {
      before: n(v[2], DEFAULT_SCHEDULE.before),
      after: after.length ? after : DEFAULT_SCHEDULE.after,
      thenEvery: n(v[4], DEFAULT_SCHEDULE.thenEvery),
      maxAfter: n(v[5], DEFAULT_SCHEDULE.maxAfter),
    },
    templates: DEFAULT_TEMPLATES,
  };
}

function today_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function todaysPlan_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET);
  if (!sh) throw new Error('No "' + SHEET + '" sheet. Run Reminders > Set up first.');
  const entries = readSheet(sh.getDataRange().getValues());
  return { sh, result: plan(entries, today_(), readSettings_()) };
}

function previewReminders() {
  const { result } = todaysPlan_();
  const lines = result.send.map((r) => "• " + r.entry.name + " <" + r.entry.email + ">: " + r.subject);
  const skips = result.skip.map((s) => "• Row " + s.entry.row + " skipped: " + s.reason);
  SpreadsheetApp.getUi().alert((lines.length ? "Would send " + lines.length + " today:\n" + lines.join("\n") : "Nothing to send today.") + (skips.length ? "\n\n" + skips.join("\n") : ""));
}

/** The daily job. Sends, then writes "Last reminded" and a log line for each one. */
function sendReminders() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const { sh, result } = todaysPlan_();
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((h) => String(h).trim().toLowerCase());
    let lastCol = head.indexOf("last reminded") + 1;
    if (!lastCol) {
      lastCol = head.length + 1;
      sh.getRange(1, lastCol).setValue("Last reminded").setFontWeight("bold");
    }
    const log = SpreadsheetApp.getActive().getSheetByName(LOG);
    const today = today_();
    let quota = MailApp.getRemainingDailyQuota();
    for (const r of result.send) {
      if (quota <= 0) break;
      MailApp.sendEmail({ to: r.entry.email, subject: r.subject, body: r.body, name: readSettings_().business });
      quota--;
      sh.getRange(r.entry.row, lastCol).setValue(today);
      if (log) log.appendRow([new Date(), r.entry.row, r.entry.name, r.entry.email, r.kind, r.subject]);
    }
  } finally {
    lock.releaseLock();
  }
}
