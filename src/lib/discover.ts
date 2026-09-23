import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "./ai";
import { normalizeWebsite } from "./geo";

/**
 * Coverage helpers for seeding: OpenStreetMap lists most churches but knows
 * the website of only a fraction. Claude's web search fills the gap — once,
 * at seed time, never in the request path.
 */

const SEARCH_TOOL: Anthropic.Tool = { type: "web_search_20260209", name: "web_search", max_uses: 3 } as unknown as Anthropic.Tool;

const SOCIAL = /facebook\.com|instagram\.com|youtube\.com|yelp\.com|twitter\.com|x\.com|linkedin\.com|wikipedia\.org|churchfinder|yellowpages|mapquest|google\.com|bing\.com|tiktok\.com|zillow|foursquare|churchangel|joinmychurch|churchstaffing|faithstreet|usachurches|thechurchfinder/i;

function textOf(msg: Anthropic.Message): string {
  return msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
}

/** The official website of one church, or null. */
export async function findChurchWebsite(name: string, locality: string): Promise<string | null> {
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 600,
    tools: [SEARCH_TOOL],
    output_config: { effort: "low" },
    system:
      "You find the official website of a specific church. Search once or twice. Reply with ONLY the URL on a single line, or the single word NONE if you cannot find an official site (a Facebook page, a denomination directory listing or a third-party church finder is NOT an official site). Do not add any other words.",
    messages: [{ role: "user", content: `Church: ${name}\nLocation: ${locality}, Montgomery County, Maryland` }],
  });
  const text = textOf(res).trim();
  const m = text.match(/https?:\/\/[^\s)>\]]+/);
  if (!m || /\bNONE\b/.test(text) && !m) return null;
  const url = normalizeWebsite(m[0].replace(/[.,;]+$/, ""));
  if (!url || SOCIAL.test(url)) return null;
  return url;
}

export interface Discovered {
  name: string;
  website: string;
  note: string;
}

/** Churches and ministries that show up when you search for help in a place. */
export async function discoverByQuery(query: string): Promise<Discovered[]> {
  const res = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 2500,
    tools: [{ ...SEARCH_TOOL, max_uses: 4 } as Anthropic.Tool],
    output_config: { effort: "low" },
    system:
      "You research churches and church-run ministries in Montgomery County, Maryland that offer help to the public. Use web search. Then list what you found as lines in exactly this format, one per line, nothing else:\nNAME | OFFICIAL_WEBSITE_URL | one short note on what they offer\nOnly include organisations with an official website (not Facebook, not directory listings). Only include organisations located in Montgomery County, Maryland. Up to 12 lines.",
    messages: [{ role: "user", content: query }],
  });
  const out: Discovered[] = [];
  for (const line of textOf(res).split("\n")) {
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length < 2) continue;
    const url = normalizeWebsite(parts[1].replace(/[.,;]+$/, ""));
    if (!url || SOCIAL.test(url) || !/^https?:\/\/[^/]+\.[a-z]{2,}/i.test(url)) continue;
    out.push({ name: parts[0].replace(/^[-*\d.\s]+/, ""), website: url, note: parts[2] ?? "" });
  }
  return out;
}
