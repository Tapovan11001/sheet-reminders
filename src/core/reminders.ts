// Who gets a payment reminder today, and what it says. Plain logic with no Google APIs,
// so the same code runs in tests, in the web simulator and inside Apps Script.

export interface Entry {
  row: number; // sheet row number, for writing back
  name: string;
  email: string;
  amount: number;
  due: string; // YYYY-MM-DD
  status: string; // "Paid" stops reminders
  lastReminded: string; // YYYY-MM-DD or ""
  lang: "en" | "hi";
}

export interface Schedule {
  before: number; // days before the due date for the first nudge
  after: number[]; // days after the due date for follow-ups
  thenEvery: number; // after the last follow-up, repeat every N days (0 = stop)
  maxAfter: number; // stop following up this many days after the due date
}

export const DEFAULT_SCHEDULE: Schedule = { before: 3, after: [0, 3, 7], thenEvery: 7, maxAfter: 45 };

export interface Settings {
  business: string;
  payLink: string; // UPI or payment page, optional
  schedule: Schedule;
  templates: Record<"en" | "hi", Record<Kind, string>>;
}

export type Kind = "upcoming" | "due" | "overdue";

export interface Reminder {
  entry: Entry;
  kind: Kind;
  daysLate: number;
  subject: string;
  body: string;
}

export interface Skip {
  entry: Entry;
  reason: string;
}

export const DEFAULT_TEMPLATES: Settings["templates"] = {
  en: {
    upcoming: "Hi {name},\n\nA quick reminder that ₹{amount} is due on {due}.{paylink}\n\nIf you've already paid, please ignore this.\n\nThanks,\n{business}",
    due: "Hi {name},\n\n₹{amount} is due today ({due}).{paylink}\n\nIf you've already paid, please reply with the reference and we'll update our records.\n\nThanks,\n{business}",
    overdue: "Hi {name},\n\n₹{amount} was due on {due}, {days} days ago, and we haven't received it yet.{paylink}\n\nIf there's a problem, just reply to this email and we'll work it out.\n\nThanks,\n{business}",
  },
  hi: {
    upcoming: "नमस्ते {name},\n\nयाद दिला दें कि ₹{amount} की राशि {due} को देय है।{paylink}\n\nअगर आप भुगतान कर चुके हैं, तो कृपया इसे नज़रअंदाज़ करें।\n\nधन्यवाद,\n{business}",
    due: "नमस्ते {name},\n\n₹{amount} की राशि आज ({due}) देय है।{paylink}\n\nअगर भुगतान हो चुका है, तो कृपया रेफ़रेंस नंबर भेज दें ताकि हम रिकॉर्ड अपडेट कर सकें।\n\nधन्यवाद,\n{business}",
    overdue: "नमस्ते {name},\n\n₹{amount} की राशि {due} को देय थी, यानी {days} दिन पहले, और अभी तक नहीं मिली है।{paylink}\n\nकोई परेशानी हो तो इस ईमेल का जवाब दें, हम मिलकर हल निकाल लेंगे।\n\nधन्यवाद,\n{business}",
  },
};

const SUBJECT: Record<"en" | "hi", Record<Kind, string>> = {
  en: { upcoming: "Payment reminder: ₹{amount} due on {due}", due: "Payment due today: ₹{amount}", overdue: "Overdue: ₹{amount} (due {due})" },
  hi: { upcoming: "भुगतान रिमाइंडर: ₹{amount}, देय तिथि {due}", due: "आज देय: ₹{amount}", overdue: "बकाया: ₹{amount} (देय तिथि {due})" },
};

export const PLACEHOLDERS = ["{name}", "{amount}", "{due}", "{days}", "{paylink}", "{business}"];

const DAY = 86400000;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);

export function prettyDate(d: string, lang: "en" | "hi" = "en"): string {
  const dt = new Date(d + "T00:00:00Z");
  return dt.toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

const money = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Which kind of reminder (if any) the schedule calls for on a given day. */
export function kindFor(daysLate: number, s: Schedule): Kind | null {
  if (daysLate === -s.before) return "upcoming";
  if (daysLate < 0) return null;
  if (daysLate > s.maxAfter) return null;
  if (s.after.includes(daysLate)) return daysLate === 0 ? "due" : "overdue";
  const last = Math.max(...s.after);
  if (s.thenEvery > 0 && daysLate > last && (daysLate - last) % s.thenEvery === 0) return "overdue";
  return null;
}

export function fill(t: string, e: Entry, daysLate: number, set: Settings): string {
  const link = set.payLink.trim() ? (e.lang === "hi" ? `\n\nभुगतान यहाँ करें: ${set.payLink.trim()}` : `\n\nYou can pay here: ${set.payLink.trim()}`) : "";
  return t
    .replaceAll("{name}", e.name.split(" ")[0] || e.name)
    .replaceAll("{amount}", money(e.amount))
    .replaceAll("{due}", prettyDate(e.due, e.lang))
    .replaceAll("{days}", String(daysLate))
    .replaceAll("{paylink}", link)
    .replaceAll("{business}", set.business);
}

/**
 * The whole decision for one day. Returns reminders to send and the rows skipped, with why.
 * A row never gets two emails on the same day, and "Paid" (in any case) always stops it.
 */
export function plan(entries: Entry[], today: string, set: Settings): { send: Reminder[]; skip: Skip[] } {
  const send: Reminder[] = [];
  const skip: Skip[] = [];
  for (const e of entries) {
    if (/^paid$/i.test(e.status.trim())) continue;
    if (!e.name.trim() && !e.email.trim()) continue;
    if (!isEmail(e.email)) { skip.push({ entry: e, reason: `"${e.email}" isn't a valid email` }); continue; }
    if (!(e.amount > 0)) { skip.push({ entry: e, reason: "amount is missing or zero" }); continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.due) || Number.isNaN(Date.parse(e.due))) { skip.push({ entry: e, reason: "due date is missing or unreadable" }); continue; }
    if (e.lastReminded === today) continue;
    const late = daysBetween(e.due, today);
    const kind = kindFor(late, set.schedule);
    if (!kind) continue;
    const t = set.templates[e.lang] ?? set.templates.en;
    send.push({ entry: e, kind, daysLate: late, subject: fill(SUBJECT[e.lang][kind], e, late, set), body: fill(t[kind], e, late, set) });
  }
  return { send, skip };
}

/** Checks a custom template: placeholders must be known, and {amount} and {due} must be there. */
export function templateProblems(t: string): string[] {
  const p: string[] = [];
  for (const m of t.match(/\{[^}]*\}/g) ?? []) if (!PLACEHOLDERS.includes(m)) p.push(`Unknown placeholder ${m}. Use ${PLACEHOLDERS.join(", ")}.`);
  for (const need of ["{amount}", "{due}"]) if (!t.includes(need)) p.push(`Needs ${need}, so the person knows what and when.`);
  if (t.length > 1200) p.push("Too long. Keep it under 1,200 characters.");
  return p;
}

/** Reads a sheet's values (header row first). Accepts Date objects from Sheets or text dates. */
export function readSheet(values: unknown[][]): Entry[] {
  const head = (values[0] ?? []).map((h) => String(h).trim().toLowerCase());
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const c = {
    name: col(["name", "student", "customer", "client"]),
    email: col(["email", "e-mail", "email id"]),
    amount: col(["amount", "fee", "amount due", "balance"]),
    due: col(["due", "due date", "due on"]),
    status: col(["status", "paid?", "payment status"]),
    last: col(["last reminded", "last reminder", "reminded on"]),
    lang: col(["language", "lang"]),
  };
  for (const [k, v] of Object.entries(c)) if (v < 0 && !["last", "lang", "status"].includes(k)) throw new Error(`The sheet needs a "${k}" column. Found: ${values[0]?.join(", ")}`);
  return values.slice(1).map((r, i) => ({
    row: i + 2,
    name: String(r[c.name] ?? "").trim(),
    email: String(r[c.email] ?? "").trim(),
    amount: Number(String(r[c.amount] ?? "").replace(/[₹,\s]/g, "")) || 0,
    due: toIso(r[c.due]),
    status: c.status >= 0 ? String(r[c.status] ?? "") : "",
    lastReminded: c.last >= 0 ? toIso(r[c.last]) : "",
    lang: c.lang >= 0 && /^(hi|hindi|हिंदी)$/i.test(String(r[c.lang] ?? "").trim()) ? "hi" : "en",
  }));
}

function toIso(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // Sheets gives local-midnight dates; use the local calendar date.
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
}
