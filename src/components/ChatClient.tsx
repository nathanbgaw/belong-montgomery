"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Markdown from "@/components/Markdown";
import { readSse } from "@/lib/sse-client";

interface Msg { role: "user" | "assistant"; text: string; statuses?: string[]; working?: boolean }
interface Place { zip: string; city: string; state: string; lat: number; lng: number; label?: string }
interface ChurchCard {
  key: string; slug: string | null; name: string; kind: string; distance_miles: number; website: string | null;
  resource_count: number | null; tags: string[]; phone: string | null; address: string | null;
}
interface Stats { churches: number; ministries: number; resources: number }

const STARTERS = [
  "We're in Wheaton and my kids' school lunches aren't enough — where can I get groceries this week?",
  "I'm a kinship grandmother in Germantown, 20874, and I need a bed and a dresser for my grandson.",
  "Behind on rent in Silver Spring, 20910. Is there any church that helps with that?",
  "Just took a foster placement of a newborn in Gaithersburg — diapers, formula, anything.",
  "My husband died in June. Is there a grief group near Rockville?",
  "Necesito ayuda con comida y ropa para mis hijos, vivimos en Takoma Park.",
];

export default function ChatClient({ stats }: { stats: Stats | null }) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text: "Hi. Tell me what you need, in your own words, and where you are in Montgomery County (a zip or a neighborhood is fine). I'll look through what churches and ministries near you offer and tell you who to call.",
    },
  ]);
  const [history, setHistory] = useState<unknown[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [churches, setChurches] = useState<ChurchCard[]>([]);
  const [need, setNeed] = useState("");
  const [deckBusy, setDeckBusy] = useState(false);
  const [spend, setSpend] = useState<{ turns: number; cost: number; model: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > 1) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    if (!need) setNeed(t);
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text: t }, { role: "assistant", text: "", statuses: [], working: true }]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: t, history, place }),
      });
      await readSse(res, (event, data) => {
        const d = data as { text?: string; error?: string; history?: unknown[]; churches?: ChurchCard[]; place?: Place | null; usage?: { cost: number; model: string } };
        setMessages((m) => {
          const last = { ...m[m.length - 1] };
          if (event === "status" && d.text) last.statuses = [...(last.statuses ?? []), d.text];
          if (event === "delta" && d.text) last.text += d.text;
          if (event === "done") { last.text = d.text ?? last.text; last.working = false; }
          if (event === "error") { last.text = last.text || `Sorry — ${d.error ?? "something went wrong"}.`; last.working = false; }
          return [...m.slice(0, -1), last];
        });
        if (event === "done") {
          if (d.history) setHistory(d.history);
          if (d.churches) setChurches((prev) => merge(prev, d.churches!));
          if (d.place) setPlace(d.place);
          if (d.usage) setSpend((s) => ({ turns: (s?.turns ?? 0) + 1, cost: (s?.cost ?? 0) + d.usage!.cost, model: d.usage!.model }));
        }
      });
    } catch (e) {
      setMessages((m) => [...m.slice(0, -1), { ...m[m.length - 1], text: `Sorry — ${e instanceof Error ? e.message : "something went wrong"}.`, working: false }]);
    } finally {
      setBusy(false);
    }
  }

  async function downloadDeck(format: "pptx" | "pdf") {
    if (!place) return;
    setDeckBusy(true);
    try {
      const res = await fetch("/api/chat/deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ need, place, slugs: churches.map((c) => c.slug).filter(Boolean), format }),
      });
      if (!res.ok) throw new Error("Deck failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `help-near-${(place.zip || place.city).replace(/\W+/g, "-").toLowerCase()}.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setDeckBusy(false);
    }
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_300px]">
      <div className="flex min-h-[78vh] flex-col">
        <div className="card flex flex-1 flex-col p-4 sm:p-6">
          <div className="flex-1 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={m.role === "user" ? "max-w-[85%] rounded-[18px] bg-primary px-4 py-3 text-white" : "max-w-[92%] rounded-[18px] bg-faint px-4 py-3"}>
                  {m.statuses && m.statuses.length > 0 && (
                    <ul className="mb-2 space-y-0.5 text-xs text-muted">
                      {m.statuses.map((s, j) => (
                        <li key={j} className="flex items-center gap-2">
                          <span className={m.working && j === m.statuses!.length - 1 && !m.text ? "dot" : "inline-block h-1.5 w-1.5 rounded-full bg-ok"} />
                          {s}
                        </li>
                      ))}
                    </ul>
                  )}
                  {m.text ? <Markdown text={m.text} /> : m.working ? <span className="dot" /> : null}
                </div>
              </div>
            ))}
            <div ref={bottom} />
          </div>

          {messages.length === 1 && (
            <div className="mt-5">
              <p className="mb-2 text-xs text-muted">Or start from one of these:</p>
              <div className="flex flex-wrap gap-2">
                {STARTERS.map((s) => (
                  <button key={s} type="button" className="rounded-full border border-line bg-card px-3 py-1.5 text-left text-xs text-muted hover:bg-faint" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input className="field flex-1" placeholder="What do you need? Add your zip or neighborhood." value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} autoFocus />
            <button className="btn btn-primary" type="submit" disabled={busy || !input.trim()}>{busy ? "Working…" : "Send"}</button>
          </form>
        </div>
      </div>

      <aside className="space-y-4">
        <div className="panel p-5">
          <span className="eyebrow">Montgomery County</span>
          {stats ? (
            <p className="mt-1 text-sm text-muted">
              <strong className="text-ink">{stats.churches}</strong> churches and <strong className="text-ink">{stats.ministries}</strong> ministries read ·{" "}
              <strong className="text-ink">{stats.resources}</strong> resources on file. <Link href="/directory" className="underline">Browse</Link>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">The directory is loading.</p>
          )}
        </div>
        <div className="panel p-5">
          <h2 className="text-lg">Places in this conversation</h2>
          {place && <p className="text-sm text-muted">Around {place.label ?? `${place.city}, ${place.state}`}</p>}
          {churches.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Churches and ministries we look at will appear here with what we found.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {churches.map((c) => (
                <li key={c.key} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    {c.slug ? <Link href={`/churches/${c.slug}`} className="font-semibold underline">{c.name}</Link> : <span className="font-semibold">{c.name}</span>}
                    <span className="shrink-0 text-muted">{c.distance_miles} mi</span>
                  </div>
                  <div className="text-muted">
                    {c.kind === "ministry" ? "ministry · " : ""}
                    {c.resource_count != null ? `${c.resource_count} resource${c.resource_count === 1 ? "" : "s"}` : "read"}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {churches.length > 0 && place && (
          <div className="panel p-5">
            <h2 className="text-lg">Take this with you</h2>
            <p className="mt-1 text-sm text-muted">A one-page-per-place deck for a caseworker, a pastor or a friend.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={() => downloadDeck("pptx")} disabled={deckBusy}>PowerPoint</button>
              <button className="btn btn-secondary" onClick={() => downloadDeck("pdf")} disabled={deckBusy}>PDF</button>
            </div>
          </div>
        )}
        <div className="panel p-5 text-sm text-muted">
          {spend && (
            <p className="mb-2">
              This conversation so far: {spend.turns} {spend.turns === 1 ? "answer" : "answers"}, about ${spend.cost < 0.01 ? "0.01" : spend.cost.toFixed(2)} of model usage ({spend.model.replace("claude-", "")}).
            </p>
          )}
          <p>Everything here comes from each organisation’s own website, read recently. Hours change — call first.</p>
          <p className="mt-2">Emergency: 911. County services: 311. Statewide help line: 211.</p>
        </div>
      </aside>
    </div>
  );
}

function merge(prev: ChurchCard[], next: ChurchCard[]): ChurchCard[] {
  const map = new Map(prev.map((c) => [c.key, c]));
  for (const c of next) map.set(c.key, { ...map.get(c.key), ...c });
  return [...map.values()].sort((a, b) => a.distance_miles - b.distance_miles);
}
