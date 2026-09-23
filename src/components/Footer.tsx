import Link from "next/link";
import { COUNTY_LABEL } from "@/lib/county";

export default function Footer() {
  return (
    <footer className="mt-12 border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted">
        <p>
          <strong className="text-ink">Belong Montgomery</strong> is an open-source demo built for{" "}
          <a className="underline" href="https://projectbelongmaryland.org" target="_blank" rel="noreferrer">Project Belong Maryland</a>,
          focused on {COUNTY_LABEL}. What it says about a church or ministry is read from that organisation’s own website
          and OpenStreetMap; none of it has been confirmed by them. Call before you go. In an emergency call 911; for county
          services dial 311; statewide, 211.
        </p>
        <p className="mt-2">
          <Link href="/scan" className="underline">Staff: read a church website</Link> · Source on{" "}
          <a className="underline" href="https://github.com/nathanbgaw/belong-montgomery" target="_blank" rel="noreferrer">GitHub</a>
          . No accounts, no tracking; needs are posted anonymously.
        </p>
      </div>
    </footer>
  );
}
