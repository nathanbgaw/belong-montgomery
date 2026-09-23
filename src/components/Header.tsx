import Link from "next/link";
import Image from "next/image";
import { COUNTY } from "@/lib/county";

const NAV = [
  { href: "/", label: "Ask" },
  { href: "/directory", label: "Directory" },
  { href: "/offers", label: "For churches" },
  { href: "/needs", label: "Needs board" },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/pbm-logo.png" alt="" width={36} height={36} className="h-9 w-9 object-contain" />
          <span className="font-display text-xl">Belong {COUNTY}</span>
          <span className="pill pill-gold ml-1 hidden sm:inline">demo</span>
        </Link>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-muted hover:text-ink">{n.label}</Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
