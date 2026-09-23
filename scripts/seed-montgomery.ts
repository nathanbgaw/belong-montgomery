/**
 * Seed Montgomery County, Maryland — as exhaustively as free sources allow.
 *
 *   A. OpenStreetMap: every Christian place of worship inside the county
 *      boundary (data/montgomery-osm.json, refreshed with --refresh-osm).
 *   B. Churches OSM lists without a website: Claude web search finds the
 *      official site (cached in data/montgomery-websites.json).
 *   C. Discovery: web searches for "churches with food pantries in Wheaton"
 *      and the like, to catch churches OSM misses (data/montgomery-discovered.json).
 *   D. Church-founded ministries and partner nonprofits, curated below.
 *
 * Then everything with a website goes through the shared scan pipeline with
 * county = "Montgomery". Rerunnable: cached lookups and scans are skipped.
 *
 *   npm run seed:montgomery -- --concurrency 5 --limit 400
 */
import fs from "node:fs";
import path from "node:path";
import { scanChurch, ScanError } from "../src/lib/scan";
import { getChurchByHost } from "../src/lib/db";
import { normalizeHost, normalizeWebsite } from "../src/lib/geo";
import { discoverByQuery, findChurchWebsite } from "../src/lib/discover";

const DATA = path.join(process.cwd(), "data");
const COUNTY = "Montgomery";

const MINISTRIES: { name: string; website: string }[] = [
  { name: "Manna Food Center", website: "https://www.mannafood.org/" },
  { name: "Shepherd's Table", website: "https://www.shepherdstable.org/" },
  { name: "Interfaith Works", website: "https://www.iworksmc.org/" },
  { name: "A Wider Circle", website: "https://awidercircle.org/" },
  { name: "Bethesda Cares", website: "https://www.bethesdacares.org/" },
  { name: "Community Ministries of Rockville", website: "https://www.cmrocks.org/" },
  { name: "Gaithersburg HELP", website: "https://www.gaithersburghelp.org/" },
  { name: "Germantown HELP", website: "https://www.germantownhelp.org/" },
  { name: "Olney HELP", website: "https://www.olneyhelp.org/" },
  { name: "Bethesda Help", website: "https://www.bethesdahelp.org/" },
  { name: "WUMCO Help", website: "https://www.wumcohelp.org/" },
  { name: "Mid-County United Ministries", website: "https://www.mumhelp.org/" },
  { name: "Upcounty Community Resources", website: "https://www.upcountyresources.org/" },
  { name: "Nourish Now", website: "https://www.nourishnow.org/" },
  { name: "Catholic Charities of the Archdiocese of Washington", website: "https://www.catholiccharitiesdc.org/" },
  { name: "Lutheran Social Services of the National Capital Area", website: "https://lssnca.org/" },
  { name: "Stepping Stones Shelter", website: "https://www.steppingstonesshelter.org/" },
  { name: "Montgomery County Coalition for the Homeless", website: "https://www.mcch.net/" },
  { name: "So What Else", website: "https://www.sowhatelse.org/" },
  { name: "St. Camillus Food Pantry", website: "https://www.stcamillusfoodpantry.org/" },
  { name: "Rebuilding Together Montgomery County", website: "https://www.rebuildingtogethermc.org/" },
  { name: "Cornerstone Montgomery", website: "https://www.cornerstonemontgomery.org/" },
  { name: "Identity, Inc.", website: "https://www.identity-youth.org/" },
  { name: "The Salvation Army Montgomery County", website: "https://easternusa.salvationarmy.org/national-capital/montgomery-county/" },
  { name: "Rainbow Place Shelter", website: "https://www.rainbowplace.org/" },
  { name: "Crossroads Community Food Network", website: "https://crossroadscommunityfoodnetwork.org/" },
  { name: "Ministries United Silver Spring Takoma Park (MUSST)", website: "https://www.musst.org/" },
  { name: "Silver Spring Interfaith Housing Coalition", website: "https://www.ssihc.org/" },
];

const AREAS = ["Silver Spring", "Wheaton", "Takoma Park", "Bethesda", "Chevy Chase", "Rockville", "Gaithersburg", "Germantown", "Olney", "Potomac", "Damascus", "Clarksburg", "Burtonsville", "Kensington", "Montgomery Village", "Aspen Hill", "Poolesville", "Colesville"];
const TOPICS = ["food pantries", "clothing closets and free clothing", "rent, utility or emergency financial assistance", "counseling, grief and recovery support groups", "help for immigrants, ESL classes and Spanish-speaking ministries", "tutoring, youth programs and after-school help", "foster care and adoption support ministries", "diapers, baby supplies and help for new parents", "seniors programs and transportation help"];

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
}
const CONCURRENCY = arg("concurrency", 5);
const LIMIT = arg("limit", 400);
const SKIP_SEARCH = process.argv.includes("--no-search");

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8")) as T;
  } catch {
    return fallback;
  }
}
function writeJson(file: string, v: unknown) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(v, null, 1));
}

interface OsmEl { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }
interface Item { url: string; kind: "church" | "ministry"; hint: { lat?: number; lng?: number; name: string; address?: string | null; phone?: string | null } }

async function pool<T>(items: T[], n: number, fn: (t: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

(async () => {
  const t0 = Date.now();
  const osm = readJson<{ elements: OsmEl[] }>("montgomery-osm.json", { elements: [] }).elements.filter((e) => e.tags?.name);
  console.log(`A. OSM: ${osm.length} named churches in the county`);

  const items = new Map<string, Item>();
  const add = (url: string, kind: Item["kind"], hint: Item["hint"]) => {
    const w = normalizeWebsite(url); const h = w && normalizeHost(w);
    if (!w || !h || items.has(h)) return false;
    items.set(h, { url: w, kind, hint }); return true;
  };
  const addr = (t: Record<string, string>) => [[t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" "), t["addr:city"], "MD", t["addr:postcode"]].filter(Boolean).join(", ") || null;
  const pos = (e: OsmEl) => e.center ?? (e.lat != null ? { lat: e.lat, lon: e.lon! } : null);

  const noSite: OsmEl[] = [];
  for (const e of osm) {
    const t = e.tags!; const p = pos(e); if (!p) continue;
    const site = t.website ?? t["contact:website"] ?? t.url;
    if (site) add(site, "church", { lat: p.lat, lng: p.lon, name: t.name, address: addr(t), phone: t.phone ?? t["contact:phone"] ?? null });
    else noSite.push(e);
  }
  console.log(`   ${items.size} with a website tag · ${noSite.length} without`);

  // B. Find websites for the rest.
  const found = readJson<Record<string, string | null>>("montgomery-websites.json", {});
  if (!SKIP_SEARCH) {
    const todo = noSite.filter((e) => !(`${e.type}/${e.id}` in found));
    console.log(`B. Looking up websites for ${todo.length} churches (${Object.keys(found).length} cached)…`);
    let done = 0;
    await pool(todo, 4, async (e) => {
      const t = e.tags!; const key = `${e.type}/${e.id}`;
      try { found[key] = await findChurchWebsite(t.name, t["addr:city"] ?? "Montgomery County"); }
      catch (err) { console.log(`   ! ${t.name}: ${(err as Error).message}`); return; }
      if (++done % 10 === 0) { writeJson("montgomery-websites.json", found); console.log(`   … ${done}/${todo.length}`); }
    });
    writeJson("montgomery-websites.json", found);
  }
  let addedB = 0;
  for (const e of noSite) {
    const site = found[`${e.type}/${e.id}`]; const p = pos(e); const t = e.tags!;
    if (site && p && add(site, "church", { lat: p.lat, lng: p.lon, name: t.name, address: addr(t), phone: t.phone ?? null })) addedB++;
  }
  console.log(`   ${addedB} websites found by search`);

  // C. Discovery searches.
  const discovered = readJson<Record<string, { name: string; website: string; note: string }[]>>("montgomery-discovered.json", {});
  if (!SKIP_SEARCH) {
    const queries = [
      ...AREAS.map((a) => `churches and church ministries offering food pantries, clothing or assistance in ${a}, Maryland`),
      ...TOPICS.map((t) => `churches or church-run ministries in Montgomery County, Maryland offering ${t}`),
    ].filter((q) => !(q in discovered));
    console.log(`C. Discovery: ${queries.length} searches (${Object.keys(discovered).length} cached)…`);
    await pool(queries, 3, async (q) => {
      try { discovered[q] = await discoverByQuery(q); console.log(`   ${discovered[q].length} ← ${q.slice(0, 70)}`); }
      catch (err) { console.log(`   ! ${(err as Error).message}`); }
      writeJson("montgomery-discovered.json", discovered);
    });
  }
  let addedC = 0;
  for (const list of Object.values(discovered)) for (const d of list) if (add(d.website, "church", { name: d.name })) addedC++;
  console.log(`   ${addedC} new organisations from discovery`);

  // D. Ministries.
  let addedD = 0;
  for (const m of MINISTRIES) if (add(m.website, "ministry", { name: m.name })) addedD++;
  console.log(`D. ${addedD} ministries`);

  const todo = [...items.values()].slice(0, LIMIT);
  console.log(`\n${todo.length} sites to scan (concurrency ${CONCURRENCY})\n`);
  let ok = 0, cached = 0, unreadable = 0, failed = 0, resources = 0;
  await pool(todo, CONCURRENCY, async (item) => {
    const host = normalizeHost(item.url)!;
    const existing = await getChurchByHost(host).catch(() => null);
    if (existing?.status === "unreadable") { unreadable++; return; }
    try {
      const r = await scanChurch(item.url, { hint: item.hint, county: COUNTY, kind: item.kind });
      if (r.cached) { cached++; console.log(`  = ${r.church.name}`); }
      else { ok++; resources += r.resources.length; console.log(`  + ${r.church.name} — ${r.resources.length} resources (${host})`); }
    } catch (e) {
      if (e instanceof ScanError) { unreadable++; console.log(`  - ${host}: ${e.message.slice(0, 80)}`); }
      else { failed++; console.log(`  ! ${host}: ${(e as Error).message.slice(0, 80)}`); }
    }
  });
  console.log(`\ndone in ${((Date.now() - t0) / 60000).toFixed(1)} min — scanned ${ok}, cached ${cached}, unreadable ${unreadable}, failed ${failed}, new resources ${resources}`);
})();
