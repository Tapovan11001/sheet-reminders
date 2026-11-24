import { Agent, defineTool, type ModelClient, type TraceEvent } from "./harness/index.ts";
import { PLACEHOLDERS, templateProblems, type Kind, type Settings } from "./core/reminders.ts";

export const SYSTEM = `You write payment reminder emails for a small Indian business. They are sent automatically from a Google Sheet.

The owner describes their business and the tone they want. Write three templates in both English and Hindi (Devanagari): "upcoming" (a few days before the due date), "due" (on the day) and "overdue" (after it). Save each with set_template.

Rules:
- Use only these placeholders: ${PLACEHOLDERS.join(" ")}. {amount} and {due} must appear in every template. {days} only makes sense in "overdue". Put {paylink} on its own after the main sentence; it expands to a "pay here" line or to nothing.
- Short: 3 to 5 sentences. Warm, never threatening, no late fees unless the owner mentions them. Sign off with {business}.
- Hindi should sound like a polite shopkeeper or teacher, not a translation.

When all six are saved, reply with one line saying so.`;

export function makeTemplateAgent(model: ModelClient, base: Settings, onEvent?: (e: TraceEvent) => void) {
  const state: { templates: Settings["templates"]; saved: Set<string> } = { templates: structuredClone(base.templates), saved: new Set() };
  const tools = [
    defineTool<{ lang: "en" | "hi"; kind: Kind; text: string }>({
      name: "set_template",
      description: "Save one template. It is checked for unknown placeholders and for {amount} and {due}.",
      input: {
        type: "object",
        properties: {
          lang: { type: "string", enum: ["en", "hi"] },
          kind: { type: "string", enum: ["upcoming", "due", "overdue"] },
          text: { type: "string" },
        },
        required: ["lang", "kind", "text"],
      },
      run: ({ lang, kind, text }) => {
        const p = templateProblems(text);
        if (kind !== "overdue" && text.includes("{days}")) p.push("{days} is only filled in for overdue reminders.");
        if (lang === "hi" && !/[ऀ-ॿ]/.test(text)) p.push("The Hindi template should be in Devanagari.");
        if (p.length) throw new Error(p.join(" "));
        state.templates[lang][kind] = text;
        state.saved.add(`${lang}/${kind}`);
        return { saved: `${lang}/${kind}`, remaining: 6 - state.saved.size };
      },
    }),
  ];
  const agent = new Agent({ model, system: SYSTEM, tools, limits: { maxSteps: 10 }, onEvent });
  return { agent, state };
}
