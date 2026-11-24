import CODE from "../apps-script/Code.gs?raw";
import { addDays, kindFor, plan, readSheet, type Settings } from "../src/core/reminders.ts";
import { SAMPLE_SHEET, SAMPLE_TODAY, SETTINGS } from "../src/core/sample.ts";
import { makeTemplateAgent } from "../src/agent.ts";
import { anthropicModel } from "../src/harness/models/anthropic.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let sheet: (string | number)[][] = structuredClone(SAMPLE_SHEET);
const settings: Settings = structuredClone(SETTINGS);

// ---- the sheet grid ----
function drawSheet() {
  const t = $("sheet");
  t.replaceChildren();
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.append(Object.assign(document.createElement("th"), { className: "rn", textContent: "" }));
  sheet[0].forEach((h, i) => hr.append(Object.assign(document.createElement("th"), { textContent: `${"ABCDEFG"[i]}  ${h}` })));
  thead.append(hr);
  const tbody = document.createElement("tbody");
  sheet.slice(1).forEach((row, r) => {
    const tr = document.createElement("tr");
    tr.append(Object.assign(document.createElement("th"), { className: "rn", textContent: String(r + 2) }));
    row.forEach((v, c) => {
      const td = document.createElement("td");
      const input = document.createElement("input");
      input.value = c === 3 || c === 5 ? toDmy(String(v)) : String(v);
      input.setAttribute("aria-label", `${sheet[0][c]}, row ${r + 2}`);
      if (c === 2) input.inputMode = "decimal";
      input.addEventListener("change", () => {
        sheet[r + 1][c] = c === 3 || c === 5 ? fromDmy(input.value) : c === 2 ? Number(input.value.replace(/[₹,]/g, "")) || input.value : input.value;
        update();
      });
      td.append(input);
      if (c === 4) td.className = /^paid$/i.test(String(v).trim()) ? "paid" : "unpaid";
      tr.append(td);
    });
    tbody.append(tr);
  });
  t.append(thead, tbody);
}
const toDmy = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").reverse().join("-") : s);
const fromDmy = (s: string) => { const m = s.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s.trim(); };

// ---- what goes out today ----
function update() {
  readSchedule();
  const today = $<HTMLInputElement>("today").value || SAMPLE_TODAY;
  let entries;
  try {
    entries = readSheet(sheet);
  } catch (e) {
    $("skips").textContent = e instanceof Error ? e.message : String(e);
    return;
  }
  const { send, skip } = plan(entries, today, settings);
  $("out-count").textContent = `${send.length} to send`;
  $("skips").replaceChildren(...skip.map((s) => Object.assign(document.createElement("p"), { className: "skip", textContent: `Row ${s.entry.row} (${s.entry.name || "no name"}) skipped: ${s.reason}.` })));
  const quiet = entries.filter((e) => !send.some((s) => s.entry.row === e.row) && !skip.some((s) => s.entry.row === e.row));
  $("emails").replaceChildren(
    ...send.map((r) => {
      const card = document.createElement("article");
      card.className = `mail k-${r.kind}`;
      if (r.entry.lang === "hi") card.lang = "hi";
      const meta = document.createElement("div");
      meta.className = "meta";
      const tag = document.createElement("span");
      tag.className = "tag-k";
      tag.textContent = r.kind === "upcoming" ? "Before due" : r.kind === "due" ? "Due today" : `${r.daysLate} days late`;
      const to = document.createElement("span");
      to.textContent = `To ${r.entry.email}`;
      meta.append(tag, to);
      const subj = document.createElement("h3");
      subj.textContent = r.subject;
      const body = document.createElement("pre");
      body.textContent = r.body;
      card.append(meta, subj, body);
      return card;
    }),
  );
  if (!send.length) $("emails").append(Object.assign(document.createElement("p"), { className: "none", textContent: "Nothing goes out this morning. Try another date." }));
  const why = quiet.map((e) => `${e.name}: ${/^paid$/i.test(e.status) ? "paid" : e.lastReminded === today ? "already reminded today" : "not a reminder day"}`);
  if (why.length) $("emails").append(Object.assign(document.createElement("p"), { className: "quiet", textContent: `No email: ${why.join(" · ")}.` }));
  drawSheet();
  drawTimeline();
}

// ---- schedule ----
function readSchedule() {
  const n = (id: string, d: number) => { const v = Number($<HTMLInputElement>(id).value); return Number.isFinite(v) && $<HTMLInputElement>(id).value !== "" ? Math.max(0, v) : d; };
  const after = $<HTMLInputElement>("s-after").value.split(/[,\s]+/).filter(Boolean).map(Number).filter((x) => Number.isFinite(x) && x >= 0);
  settings.schedule = { before: n("s-before", 3), after: after.length ? after : [0], thenEvery: n("s-every", 7), maxAfter: n("s-max", 45) };
  settings.business = $<HTMLInputElement>("s-biz").value.trim() || "Your business";
  settings.payLink = $<HTMLInputElement>("s-link").value.trim();
}

function drawTimeline() {
  const s = settings.schedule;
  const from = -Math.max(s.before, 3) - 1, to = Math.min(s.maxAfter, 60) + 2;
  const cells = [];
  for (let d = from; d <= to; d++) {
    const k = kindFor(d, s);
    const c = document.createElement("span");
    c.className = `day${k ? ` k-${k}` : ""}${d === 0 ? " zero" : ""}`;
    c.title = k ? `${d < 0 ? `${-d} days before` : d === 0 ? "Due date" : `${d} days late`}: email` : "";
    if (k || d === 0) c.textContent = d === 0 ? "Due" : d > 0 ? `+${d}` : String(d);
    cells.push(c);
  }
  $("timeline").replaceChildren(...cells);
}

function fillSchedule() {
  const s = settings.schedule;
  $<HTMLInputElement>("s-before").value = String(s.before);
  $<HTMLInputElement>("s-after").value = s.after.join(", ");
  $<HTMLInputElement>("s-every").value = String(s.thenEvery);
  $<HTMLInputElement>("s-max").value = String(s.maxAfter);
  $<HTMLInputElement>("s-biz").value = settings.business;
  $<HTMLInputElement>("s-link").value = settings.payLink;
}

for (const id of ["s-before", "s-after", "s-every", "s-max", "s-biz", "s-link", "today"]) $(id).addEventListener("input", update);
$("add").addEventListener("click", () => { sheet.push(["", "", "", addDays($<HTMLInputElement>("today").value || SAMPLE_TODAY, 7), "Unpaid", "", "English"]); update(); });
$("reset").addEventListener("click", () => { sheet = structuredClone(SAMPLE_SHEET); Object.assign(settings, structuredClone(SETTINGS)); fillSchedule(); $<HTMLInputElement>("today").value = SAMPLE_TODAY; update(); });

// ---- install ----
$("code").textContent = CODE;
$("code-lines").textContent = `${CODE.split("\n").length} lines`;
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(CODE); $("copy").textContent = "Copied"; }
  catch { const r = document.createRange(); r.selectNodeContents($("code")); getSelection()?.removeAllRanges(); getSelection()?.addRange(r); $("copy").textContent = "Selected, press ⌘C"; }
  setTimeout(() => ($("copy").textContent = "Copy code"), 1800);
});

// ---- Claude: templates in your tone ----
try { const k = sessionStorage.getItem("sr2-key"); if (k) $<HTMLInputElement>("api-key").value = k; } catch {}
$("write").addEventListener("click", async () => {
  const key = $<HTMLInputElement>("api-key").value.trim();
  const st = $("tone-status");
  if (!key) { st.textContent = "Paste an Anthropic API key first."; return; }
  try { sessionStorage.setItem("sr2-key", key); } catch {}
  const btn = $<HTMLButtonElement>("write");
  btn.disabled = true;
  st.textContent = "Claude is writing…";
  try {
    const { agent, state } = makeTemplateAgent(anthropicModel({ apiKey: key, browser: true, maxTokens: 6000 }), settings, (e) => {
      if (e.kind === "tool_result") st.textContent = e.isError ? "One message didn't pass the check. Claude is fixing it…" : "Saved a message…";
    });
    const r = await agent.run(`Business: ${settings.business}. ${$<HTMLTextAreaElement>("tone-desc").value.trim()}`);
    if (state.saved.size) {
      settings.templates = state.templates;
      update();
      st.textContent = `Claude wrote ${state.saved.size} of 6 messages. The previews above now use them.`;
    } else {
      const err = r.trace.find((e) => e.kind === "error");
      st.textContent = err && err.kind === "error"
        ? (/fetch|network|connection/i.test(err.message) ? "Couldn't reach the Claude API from this page. Open the hosted site if this preview blocks outside requests." : err.message)
        : `Stopped: ${r.status}.`;
    }
  } finally {
    btn.disabled = false;
  }
});

$<HTMLInputElement>("today").value = SAMPLE_TODAY;
fillSchedule();
update();
