import ChatClient from "@/components/ChatClient";
import { countyStats, dbEnabled } from "@/lib/db";
import { COUNTY } from "@/lib/county";

export const dynamic = "force-dynamic";

export default async function Home() {
  const stats = dbEnabled() ? await countyStats(COUNTY).catch(() => null) : null;
  return <ChatClient stats={stats} />;
}
