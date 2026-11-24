# Sheet Reminders

A Google Sheets automation that emails payment reminders on a schedule, in English or Hindi, and stops the moment a row is marked Paid. It runs inside your own Google account, with no server and no subscription.

**Live:** {{live-url}}

## How it works in 100 words

Lots of small businesses keep track of who owes them money in a Google Sheet, then chase each person by hand. Sheet Reminders does the chasing. You list each person's name, email, amount and due date. Every morning a small script inside your own Google account checks the sheet. It emails a friendly reminder three days before the due date, on the day, and on a few days after, in English or Hindi. The moment you mark a row Paid, the reminders stop. Every email it sends is written to a log, and Claude can rewrite the messages in your own tone.

_Created by Aarov Makhija._

## Why

Tuition centres, gyms, wholesalers and freelancers in India keep their dues in a spreadsheet and chase people one WhatsApp or email at a time. It's awkward, it's easy to forget someone, and it's easy to remind someone who already paid. The paid tools are made for bigger companies. Everyone already has a Google Sheet.

## What it does

- A **Payments** sheet with Name, Email, Amount, Due date, Status, Last reminded and Language.
- Every morning at about 9 AM, an Apps Script trigger checks each unpaid row and emails one reminder when the schedule calls for it. The default is 3 days before, on the due date, then 3 and 7 days after, then weekly until 45 days late. You change these in a **Settings** sheet.
- The message changes with the stage (before, due today, overdue) and the row's language (English or Hindi). It includes your UPI or payment link if you add one.
- Safe by default:
  - "Paid" (in any case) stops reminders for that row at once.
  - "Last reminded" is written back after each send, so a row never gets two emails on the same day. That holds even if the script runs twice.
  - Rows with a bad email, a missing amount or an unreadable date are skipped and listed, never guessed.
  - It stops when Gmail's daily quota runs out, and uses a lock so two runs can't overlap.
- Every email sent is appended to a **Reminder log** sheet.
- A **Reminders** menu in the sheet: preview today's emails, send now, set up, stop.
- **Your tone**: describe your business and Claude writes all six messages (three stages, two languages). The `set_template` tool rejects unknown placeholders, missing `{amount}` or `{due}`, and Hindi that isn't in Devanagari.

## How the code is put together

The decisions (who gets an email today, and what it says) live in [`src/core/reminders.ts`](src/core/reminders.ts). That file uses no Google APIs, so the tests and the web simulator run exactly the same logic. [`scripts/build-gs.mjs`](scripts/build-gs.mjs) strips the TypeScript types and joins it with [`apps-script/main.gs.js`](apps-script/main.gs.js), the small part that talks to Sheets and Gmail. The result is [`apps-script/Code.gs`](apps-script/Code.gs), the one file you paste into Apps Script.

One test loads the generated `Code.gs` into a fake Apps Script environment and runs the daily job twice. It checks that the right four people get emails, that "Last reminded" is written back, and that the second run sends nothing.

## Install it in your sheet

1. Open a Google Sheet, then go to **Extensions → Apps Script**.
2. Paste [`apps-script/Code.gs`](apps-script/Code.gs) and save.
3. Reload the sheet, then choose **Reminders → Set up sheets and daily 9 AM run**, and allow access.
4. Fill in **Payments** and **Settings**.
5. Use **Reminders → Preview today's reminders** to check what will be sent.

## Run it locally

```bash
npm install
npm test          # 6 tests: schedule, a sample day, 60 simulated days, Sheets values, templates, the real Code.gs in a fake Apps Script
npm run build:gs  # regenerate apps-script/Code.gs
npm run dev       # the simulator at localhost:5173
```

## Limits

- Email only. WhatsApp needs the WhatsApp Business API and a paid provider, which is the obvious next step.
- A free Google account can send about 100 emails a day through Apps Script.
- The custom templates from Claude are shown in the simulator. To use them in your sheet, paste them into `DEFAULT_TEMPLATES` for now.

## License

MIT
