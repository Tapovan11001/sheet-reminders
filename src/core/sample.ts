// A small tuition centre's fee sheet. Names and emails are made up.
import { DEFAULT_SCHEDULE, DEFAULT_TEMPLATES, addDays, type Settings } from "./reminders.ts";

export const SAMPLE_TODAY = "2026-12-10";

export const SETTINGS: Settings = {
  business: "Vidya Tuition Centre",
  payLink: "upi://pay?pa=vidyatuition@okaxis&pn=Vidya%20Tuition",
  schedule: DEFAULT_SCHEDULE,
  templates: DEFAULT_TEMPLATES,
};

const d = (n: number) => addDays(SAMPLE_TODAY, n);

/** Header row plus data, the way Sheets returns getValues(). */
export const SAMPLE_SHEET: (string | number)[][] = [
  ["Name", "Email", "Amount", "Due date", "Status", "Last reminded", "Language"],
  ["Riya Sharma", "riya.parent@example.com", 4500, d(3), "Unpaid", "", "English"],
  ["Kabir Singh", "kabir.s@example.com", 4500, d(0), "Unpaid", "", "Hindi"],
  ["Ananya Iyer", "ananya.i@example.com", 6000, d(-3), "Unpaid", d(-3), "English"],
  ["Mohit Verma", "mohit.v@example.com", 4500, d(-14), "Unpaid", d(-7), "Hindi"],
  ["Sara Khan", "sara.k@example.com", 6000, d(-7), "Paid", d(-3), "English"],
  ["Dev Patel", "dev.patel@example", 4500, d(-7), "Unpaid", "", "English"],
  ["Ishita Rao", "ishita.r@example.com", 4500, d(10), "Unpaid", "", "English"],
  ["Arjun Nair", "arjun.n@example.com", 6000, d(-1), "Unpaid", d(0), "English"],
  ["Meera Joshi", "meera.j@example.com", 4500, d(-60), "Unpaid", d(-42), "English"],
];
