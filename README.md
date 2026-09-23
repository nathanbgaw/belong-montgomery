# Belong Montgomery

A chat that finds church and ministry help in **Montgomery County, Maryland**. Open-source demo for
[Project Belong Maryland](https://projectbelongmaryland.org).

**The front page is the chat.** A person says what they need and where they are; behind the chat is a
database of what the county's churches and church-founded ministries publish on their own websites,
plus a board where churches post what they can give and people post what they need.

```
"We're in Wheaton and my kids' school lunches aren't enough."
   → find_place          Wheaton → coordinates
   → search_resources    the county database: category=food, keywords=[pantry, groceries]
   → find_nearby_churches directory + OpenStreetMap within 6 miles
   → scan_churches       (only if the database is thin) read up to 6 unread church sites live
   → search_offers       what churches posted directly
   → an answer: 2–4 specific places, hours, how to get in, a phone number, distance — and "call first"
   → offer to post the need to the board (only posts after a clear yes)
```

Everything the chat says traces to a tool result. Every stored resource cites the page it came from and
is marked `stated` or `inferred`. Nothing is invented; when a website says nothing about help, the
inventory says so.

## The database

Built by `npm run seed:montgomery`, which is as exhaustive as free sources allow:

| Source | What it contributes |
|---|---|
| **OpenStreetMap** | every Christian place of worship inside the county boundary (~355), with the website tag where one exists (~78) |
| **Claude web search** | the official website for the ~277 churches OSM lists without one (cached in `data/montgomery-websites.json`) |
| **Discovery searches** | "churches with food pantries in Wheaton", "rent assistance ministries in Montgomery County" … — 27 queries, to catch churches OSM misses (`data/montgomery-discovered.json`) |
| **Curated ministries** | Manna Food Center, Shepherd's Table, Interfaith Works, A Wider Circle, the HELP organisations (Gaithersburg, Germantown, Olney, Bethesda, WUMCO), Mid-County United Ministries, Catholic Charities, LSSNCA, MCCH, and more (`scripts/seed-montgomery.ts`) |

Each site then goes through the same pipeline the chat uses live: crawl the homepage plus up to seven
ministry/outreach pages → Claude structured extraction (`claude-sonnet-5` by default) → geocode → store. Roughly
$0.03 of model usage per site on Sonnet; the web-search passes add a few dollars.

## Pages

| Path | What |
|---|---|
| `/` | The chat |
| `/directory` | Every church and ministry read, with resource counts; each has a page and a downloadable PowerPoint/PDF |
| `/offers` | For churches: post what you can provide (the chat searches these) |
| `/needs` | Anonymous needs board |
| `/scan` | Staff: read any church website by URL |

## Run it

```bash
npm install
cp .env.example .env.local     # NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POSTGRES_PASSWORD, ANTHROPIC_API_KEY
npm run db:migrate
npm run seed:montgomery        # optional; --no-search skips the web-search passes
npm run dev
```

Models default to `claude-sonnet-5` (about $0.02 per chat answer and $0.03 per site read, with prompt caching on the conversation); set `BELONG_MODEL_CHAT` / `BELONG_MODEL_EXTRACT` to `claude-opus-5` if you want the pricier model. Set `BELONG_COUNTY` to point the same code at another county (the seed script and `src/lib/county.ts`
are the two county-specific spots). Deploys to Vercel with `vercel --prod`; chat and scan routes stream
and set `maxDuration = 300`.

## Honest limits

- Data is read from websites, not confirmed by anyone. Hours change. The chat says "call first" every time.
- OpenStreetMap misses churches and websites; the search passes recover many but not all.
- Sites that block readers or render only in the browser are stored as `unreadable`; the chat still hands
  out their phone number.
- This is a demo of a process, not a vetted directory.

MIT licensed. Built with Next.js 16, Supabase and the Anthropic SDK; shares its pipeline with
[belong-connect](https://github.com/nathanbgaw/belong-connect).
