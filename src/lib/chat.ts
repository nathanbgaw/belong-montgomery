import Anthropic from "@anthropic-ai/sdk";
import { anthropic, MODEL } from "./ai";
import { CATEGORIES, labelFor } from "./categories";
import { createNeed, offersInBox, resourcesForChurches, searchResources } from "./db";
import { boundingBox, geocodeAddress, haversineMiles, lookupZip, normalizeHost } from "./geo";
import { COUNTY, COUNTY_LABEL, inCounty } from "./county";
import { nearbyChurches } from "./osm";
import { scanChurch, ScanError } from "./scan";
import type { NearbyChurch, ResourceRow } from "./types";

/**
 * The needs chat. A manual tool loop (no beta dependency, streamed text) with
 * six tools that do real work: resolve a zip, find churches around it, read
 * their websites on the fly, pull the resources we've stored, look at what
 * churches have offered on the board, and — only with consent — post the need.
 *
 * Everything the model can say about a church traces back to a tool result;
 * the system prompt forbids inventing programs or phone numbers.
 */

export const SYSTEM_PROMPT = `You are the front door of Belong ${COUNTY}, a free guide to help offered by churches and church-run ministries in ${COUNTY_LABEL}. It is run for Project Belong Maryland, a nonprofit that mobilizes churches around foster, kinship and struggling families. Behind you is a database of what those churches and ministries publish on their own websites, read recently, plus a board where churches post what they can give and people post what they need.

Your job: understand what the person needs, find real help close to them, and say plainly how to reach it.

How to work:
1. Read the need. If it's clear, don't interrogate — at most one short clarifying question, and only if it changes where you'd send them.
2. Find out where they are. A zip code is best; a neighborhood or town in the county ("Wheaton", "Germantown", "near Takoma Park") is fine — call find_place with whatever they give. If they give nothing, ask once. Never search without a location.
3. Search the database first: call search_resources with the best category and a few keywords, and find_nearby_churches for what's around them. Then, if the database is thin for their need and there are unread church websites nearby, call scan_churches on up to 6 of the closest — reading is quick and the results are cached for everyone after you. Call search_offers too; churches post there directly.
4. Answer with specific places: name, what they offer, when, how to get it, the phone or contact IF a tool result gave one, and distance. Lead with the best 2–4 fits, nearest first when quality is equal. Say when an item is "inferred" ("looks like they may have… worth a call"). Ministries (kind: ministry) such as Manna Food Center or the HELP organizations often cover the whole county — include them when they fit, and say they aren't a congregation.
5. If nothing fits exactly, say so and give the nearest adjacent help — a benevolence fund for a rent question, a church office to call when nothing is listed — plus nearby churches with no website, since small pantries often never make it online. Montgomery County's own line is 311 (240-777-0311); Maryland's is 211. Mention them when a need is bigger than a church can carry (eviction, domestic violence, medical crisis). If someone is in danger, 911.
6. Always suggest calling ahead; hours change and a website is the last thing a church updates.
7. Offer once to post the need (anonymously) to the board so churches can see it — call post_need only after they clearly say yes. Never store a name unless they give it and ask to be contacted.

Rules:
- Never invent a program, hour, address, phone number or person. If a tool result doesn't contain it, you don't know it.
- Warm, plain, short. This may be someone having the worst week of their year, on a phone. No jargon, no preaching, no long lists.
- Don't ask for personal details beyond the need and a location.
- Light markdown: bold place names, short bullets. No headers.
- If they're outside the county, still help with the same tools (they work anywhere in the US) but say this guide is built for ${COUNTY_LABEL}.`;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "find_place",
    description: `Resolve where the person is: a 5-digit zip, or a neighborhood/town name in or near ${COUNTY_LABEL} (e.g. 'Wheaton', 'downtown Silver Spring', 'Germantown'). Returns coordinates and a label. Call this before anything location-based.`,
    input_schema: { type: "object", properties: { place: { type: "string", description: "Zip code or place name as the person gave it" } }, required: ["place"] },
  },
  {
    name: "search_resources",
    description: `Search the ${COUNTY} County database of resources read from church and ministry websites. Filter by one category and/or a few keywords (e.g. ['pantry','groceries']). Returns matching resources with the organisation, contact, schedule, and distance from the person if a place has been resolved. Fast — use this first.`,
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: [...CATEGORIES], description: "Best single category, or omit" },
        keywords: { type: "array", items: { type: "string" }, description: "2–5 short keywords; omit for category-only" },
      },
    },
  },
  {
    name: "find_nearby_churches",
    description:
      "Churches and ministries near the resolved place, combining our directory with OpenStreetMap. Returns each one's distance, whether its website has been read, how many resources we have, tags, phone. Radius in miles (default 6, max 25). Call find_place first.",
    input_schema: {
      type: "object",
      properties: { radius_miles: { type: "number" } },
    },
  },
  {
    name: "scan_churches",
    description:
      "Read the public websites of up to 6 churches right now and extract what they offer the community. Pass the exact 'website' values from find_nearby_churches. Slow (10–30s); results are cached for a month, so already-scanned churches return instantly.",
    input_schema: {
      type: "object",
      properties: { websites: { type: "array", items: { type: "string" }, maxItems: 6 } },
      required: ["websites"],
    },
  },
  {
    name: "get_church_resources",
    description: "Return the full resource list for scanned churches, by the 'key' values from find_nearby_churches or scan_churches.",
    input_schema: { type: "object", properties: { keys: { type: "array", items: { type: "string" } } }, required: ["keys"] },
  },
  {
    name: "search_offers",
    description: "Things churches have posted directly on the board that they can provide, near the resolved place.",
    input_schema: { type: "object", properties: { radius_miles: { type: "number" } } },
  },
  {
    name: "post_need",
    description: "Post the person's need to the public board (anonymous unless they ask to be contacted). ONLY call after they clearly agree.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", enum: [...CATEGORIES] },
        description: { type: "string", description: "The need in their words, with any names removed" },
        contact_ok: { type: "boolean" },
        contact: { type: "string", description: "Phone or email, only if they asked to be contacted" },
      },
      required: ["category", "description", "contact_ok"],
    },
  },
];

export interface ChatContext {
  status: (text: string) => void;
  /** Churches touched this turn, keyed by host, for the UI's cards and deck. */
  touched: Map<string, NearbyChurch>;
  place: { zip: string; city: string; state: string; lat: number; lng: number; label?: string } | null;
}

async function resolvePlace(input: string): Promise<ChatContext["place"] | null> {
  const zip = await lookupZip(input);
  if (zip) return { ...zip, label: `${zip.city}, ${zip.state} ${zip.zip}` };
  const cleaned = input.replace(/\b(near|around|in|downtown)\b/gi, " ").trim();
  if (!cleaned) return null;
  const g = await geocodeAddress(`${cleaned}, ${COUNTY_LABEL}`);
  if (!g || !inCounty(g.lat, g.lng)) {
    const g2 = await geocodeAddress(`${cleaned}, Maryland`);
    if (!g2) return null;
    return { zip: "", city: cleaned, state: "MD", lat: g2.lat, lng: g2.lng, label: `${cleaned}, MD` };
  }
  return { zip: "", city: cleaned, state: "MD", lat: g.lat, lng: g.lng, label: `${cleaned}, ${COUNTY} County, MD` };
}

function summarizeNearby(c: NearbyChurch, resourceCount?: number) {
  return {
    key: c.key,
    slug: c.scanned?.slug ?? null,
    name: c.name,
    kind: c.scanned?.kind ?? "church",
    distance_miles: Number(c.distanceMiles.toFixed(1)),
    website: c.website,
    scanned: c.scanned?.status === "scanned",
    unreadable: c.scanned?.status === "unreadable",
    resource_count: resourceCount ?? null,
    tags: c.scanned?.tags?.map(labelFor) ?? [],
    denomination: c.denomination,
    phone: c.phone,
    address: c.address,
  };
}

function summarizeResource(r: ResourceRow) {
  return {
    title: r.title,
    category: labelFor(r.category),
    description: r.description,
    schedule: r.schedule,
    how_to_access: r.how_to_access,
    contact: r.contact,
    confidence: r.confidence,
    source: r.source_url,
  };
}

export async function runTool(name: string, input: Record<string, unknown>, ctx: ChatContext): Promise<unknown> {
  switch (name) {
    case "find_place": {
      ctx.status(`Locating "${input.place}"…`);
      const place = await resolvePlace(String(input.place));
      if (!place) return { error: "Couldn't place that. Ask for a zip code or a town/neighborhood name." };
      ctx.place = place;
      return { ...place, in_county: inCounty(place.lat, place.lng) };
    }
    case "search_resources": {
      const kws = Array.isArray(input.keywords) ? input.keywords.map(String) : [];
      const cat = typeof input.category === "string" ? input.category : null;
      ctx.status(`Searching the ${COUNTY} County database${cat ? ` for ${labelFor(cat)}` : ""}${kws.length ? ` (${kws.join(", ")})` : ""}…`);
      const hits = await searchResources({ county: COUNTY, category: cat, keywords: kws, limit: 80 });
      const p = ctx.place;
      const rows = hits
        .map((h) => {
          const d = p && h.church.lat != null && h.church.lng != null ? haversineMiles(p.lat, p.lng, h.church.lat, h.church.lng) : null;
          return { ...h, distance_miles: d == null ? null : Number(d.toFixed(1)) };
        })
        .sort((a, b) => (a.distance_miles ?? 99) - (b.distance_miles ?? 99))
        .slice(0, 30);
      for (const h of rows) {
        const host = h.church.website ? normalizeHost(h.church.website) : null;
        if (host && !ctx.touched.has(host)) {
          ctx.touched.set(host, {
            key: host, name: h.church.name, website: h.church.website, host, lat: h.church.lat ?? 0, lng: h.church.lng ?? 0,
            distanceMiles: h.distance_miles ?? 0, address: h.church.address, phone: h.church.phone, denomination: null,
            scanned: { ...(h.church as unknown as NearbyChurch["scanned"]), status: "scanned", slug: h.church.slug, kind: h.church.kind } as NearbyChurch["scanned"],
          });
        }
      }
      ctx.status(`${rows.length} matching resource${rows.length === 1 ? "" : "s"} in the database`);
      return {
        count: rows.length,
        resources: rows.map((h) => ({
          organisation: h.church.name, kind: h.church.kind, key: h.church.website ? normalizeHost(h.church.website) : h.church.slug,
          distance_miles: h.distance_miles, address: h.church.address, phone: h.church.phone, website: h.church.website,
          ...summarizeResource(h),
        })),
      };
    }
    case "find_nearby_churches": {
      const place = ctx.place;
      if (!place) return { error: "Call find_place first." };
      const radius = Math.min(25, Math.max(2, Number(input.radius_miles ?? 6)));
      ctx.status(`Finding churches within ${radius} miles of ${place.label ?? place.city}…`);
      const list = await nearbyChurches(place.lat, place.lng, radius);
      const scanned = list.filter((c) => c.scanned?.status === "scanned");
      const counts = new Map<string, number>();
      if (scanned.length) {
        const rs = await resourcesForChurches(scanned.map((c) => c.scanned!.id));
        for (const r of rs) counts.set(r.church_id, (counts.get(r.church_id) ?? 0) + 1);
      }
      for (const c of list) ctx.touched.set(c.key, c);
      const withSites = list.filter((c) => c.website && c.scanned?.status !== "scanned");
      const noSite = list.filter((c) => !c.website);
      ctx.status(`${list.length} churches nearby · ${scanned.length} already read · ${withSites.length} with websites not yet read`);
      return {
        place,
        radius_miles: radius,
        counts: { total: list.length, scanned: scanned.length, unread_with_website: withSites.length, no_website: noSite.length },
        churches: list.slice(0, 40).map((c) => summarizeNearby(c, c.scanned ? counts.get(c.scanned.id) ?? 0 : undefined)),
      };
    }
    case "scan_churches": {
      const websites = (Array.isArray(input.websites) ? input.websites : []).map(String).slice(0, 6);
      const results = await Promise.all(
        websites.map(async (w) => {
          const host = normalizeHost(w) ?? w;
          const hint = [...ctx.touched.values()].find((c) => c.host === host);
          try {
            const r = await scanChurch(w, {
              onStatus: (t) => ctx.status(t),
              hint: hint ? { lat: hint.lat, lng: hint.lng, name: hint.name, address: hint.address, phone: hint.phone } : undefined,
            });
            const touched = ctx.touched.get(host) ?? ctx.touched.get(hint?.key ?? "");
            const distance = ctx.place && r.church.lat != null && r.church.lng != null
              ? haversineMiles(ctx.place.lat, ctx.place.lng, r.church.lat, r.church.lng)
              : touched?.distanceMiles ?? 0;
            ctx.touched.set(host, {
              key: host,
              name: r.church.name,
              website: r.church.website,
              host,
              lat: r.church.lat ?? touched?.lat ?? 0,
              lng: r.church.lng ?? touched?.lng ?? 0,
              distanceMiles: distance,
              address: r.church.address,
              phone: r.church.phone,
              denomination: r.church.denomination,
              scanned: r.church,
            });
            return {
              key: host,
              name: r.church.name,
              status: "scanned",
              cached: r.cached,
              distance_miles: Number(distance.toFixed(1)),
              phone: r.church.phone,
              address: r.church.address,
              summary: r.church.summary,
              resources: r.resources.map(summarizeResource),
            };
          } catch (e) {
            const msg = e instanceof Error ? e.message : "failed";
            ctx.status(`Couldn't read ${host} — ${e instanceof ScanError ? "site not readable" : "error"}`);
            return { key: host, status: e instanceof ScanError ? "unreadable" : "error", error: msg, phone: hint?.phone ?? null, address: hint?.address ?? null };
          }
        })
      );
      return { results };
    }
    case "get_church_resources": {
      const keys = (Array.isArray(input.keys) ? input.keys : []).map(String);
      const churches = keys.map((k) => ctx.touched.get(k)).filter((c): c is NearbyChurch => Boolean(c?.scanned));
      const rs = await resourcesForChurches(churches.map((c) => c.scanned!.id));
      ctx.status(`Pulling resources for ${churches.length} church${churches.length === 1 ? "" : "es"}…`);
      return {
        churches: churches.map((c) => ({
          key: c.key,
          name: c.name,
          distance_miles: Number(c.distanceMiles.toFixed(1)),
          phone: c.phone,
          address: c.address,
          website: c.website,
          summary: c.scanned!.summary,
          resources: rs.filter((r) => r.church_id === c.scanned!.id).map(summarizeResource),
        })),
      };
    }
    case "search_offers": {
      const place = ctx.place;
      if (!place) return { error: "Call find_place first." };
      const radius = Math.min(25, Math.max(2, Number(input.radius_miles ?? 10)));
      ctx.status("Checking what churches have posted on the board…");
      const offers = await offersInBox(boundingBox(place.lat, place.lng, radius));
      return {
        offers: offers
          .map((o) => ({
            church: o.church_name,
            website: o.website,
            category: labelFor(o.category),
            description: o.description,
            distance_miles: o.lat != null && o.lng != null ? Number(haversineMiles(place.lat, place.lng, o.lat, o.lng).toFixed(1)) : null,
            contact_name: o.contact_name,
            has_contact_email: Boolean(o.contact_email),
          }))
          .filter((o) => o.distance_miles == null || o.distance_miles <= radius),
      };
    }
    case "post_need": {
      const place = ctx.place;
      ctx.status("Posting the need to the board…");
      const need = await createNeed({
        zip: place?.zip || null,
        lat: place?.lat ?? null,
        lng: place?.lng ?? null,
        category: (CATEGORIES as readonly string[]).includes(String(input.category)) ? String(input.category) : "other",
        description: String(input.description).slice(0, 2000),
        contact_ok: Boolean(input.contact_ok),
        contact: input.contact_ok && input.contact ? String(input.contact).slice(0, 200) : null,
      });
      return { ok: true, id: need.id, posted_at: need.created_at };
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

export interface ChatTurnResult {
  text: string;
  history: Anthropic.MessageParam[];
  churches: ReturnType<typeof summarizeNearby>[];
  place: ChatContext["place"];
}

const MAX_ITERATIONS = 10;

export async function runChatTurn(
  history: Anthropic.MessageParam[],
  userMessage: string,
  handlers: { status: (text: string) => void; delta: (text: string) => void },
  /** The place resolved on an earlier turn, so the model needn't re-resolve it. */
  previousPlace: ChatContext["place"] = null
): Promise<ChatTurnResult> {
  const client = anthropic();
  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: userMessage }];
  const ctx: ChatContext = { status: handlers.status, touched: new Map(), place: previousPlace };
  let finalText = "";

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 8000,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
      output_config: { effort: "medium" },
    });
    let turnText = "";
    stream.on("text", (delta) => {
      turnText += delta;
      handlers.delta(delta);
    });
    const message = await stream.finalMessage();
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "refusal") {
      finalText = turnText || "I can't help with that one, but I'm glad to help find food, clothing, counseling or other support nearby.";
      break;
    }
    if (message.stop_reason !== "tool_use") {
      finalText = turnText;
      break;
    }
    const toolUses = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (t) => {
        try {
          const out = await runTool(t.name, (t.input ?? {}) as Record<string, unknown>, ctx);
          return { type: "tool_result" as const, tool_use_id: t.id, content: JSON.stringify(out) };
        } catch (e) {
          return { type: "tool_result" as const, tool_use_id: t.id, content: JSON.stringify({ error: e instanceof Error ? e.message : "failed" }), is_error: true };
        }
      })
    );
    messages.push({ role: "user", content: results });
  }

  const scannedNearby = [...ctx.touched.values()]
    .filter((c) => c.scanned?.status === "scanned")
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, 12);
  const counts = new Map<string, number>();
  for (const r of await resourcesForChurches(scannedNearby.map((c) => c.scanned!.id)).catch(() => [] as ResourceRow[])) {
    counts.set(r.church_id, (counts.get(r.church_id) ?? 0) + 1);
  }
  const churches = scannedNearby.map((c) => summarizeNearby(c, counts.get(c.scanned!.id) ?? 0));

  return { text: finalText, history: messages, churches, place: ctx.place };
}
