import Link from "next/link";
import { labelFor } from "@/lib/categories";
import { countyChurches, resourcesForChurches } from "@/lib/db";
import { COUNTY, COUNTY_LABEL } from "@/lib/county";

export const dynamic = "force-dynamic";
export const metadata = { title: "Directory" };

export default async function Directory() {
  const all = await countyChurches(COUNTY);
  const resources = await resourcesForChurches(all.map((c) => c.id));
  const counts = new Map<string, number>();
  for (const r of resources) counts.set(r.church_id, (counts.get(r.church_id) ?? 0) + 1);
  const sorted = [...all].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const ministries = sorted.filter((c) => c.kind === "ministry");
  const churches = sorted.filter((c) => c.kind !== "ministry");

  const Card = ({ c }: { c: (typeof all)[number] }) => (
    <Link href={`/churches/${c.slug}`} className="panel flex flex-col gap-2 p-5 transition hover:shadow-[var(--shadow-e2)]">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg leading-tight">{c.name}</h2>
        <span className="pill pill-primary shrink-0">{counts.get(c.id) ?? 0}</span>
      </div>
      <p className="text-sm text-muted">{[c.city, c.state].filter(Boolean).join(", ")}{c.denomination ? ` · ${c.denomination}` : ""}</p>
      <div className="flex flex-wrap gap-1">{c.tags.slice(0, 5).map((t) => <span key={t} className="pill">{labelFor(t)}</span>)}</div>
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <span className="eyebrow">Directory</span>
      <h1 className="mt-1 text-3xl">{COUNTY_LABEL}</h1>
      <p className="mt-2 max-w-2xl text-muted">
        {churches.length} churches and {ministries.length} ministries read, {resources.length} community resources on file. Drafted automatically from each
        organisation’s own website — every item cites its page, none of it confirmed by the organisation. <Link href="/scan" className="underline">Add one by URL.</Link>
      </p>
      {ministries.length > 0 && (
        <>
          <h2 className="mt-8 text-2xl">Ministries & partner nonprofits</h2>
          <p className="text-sm text-muted">Church-founded and interfaith organisations that usually serve the whole county.</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{ministries.map((c) => <Card key={c.id} c={c} />)}</div>
        </>
      )}
      <h2 className="mt-8 text-2xl">Churches</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{churches.map((c) => <Card key={c.id} c={c} />)}</div>
    </div>
  );
}
