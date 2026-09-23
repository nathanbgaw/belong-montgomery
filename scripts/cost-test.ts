import { runChatTurn } from "../src/lib/chat";
import { crawlSite } from "../src/lib/crawl";
import { extractProfile } from "../src/lib/extract";
import { MODEL_CHAT, MODEL_EXTRACT } from "../src/lib/ai";

(async () => {
  const q = process.argv[2] ?? "Behind on rent in Silver Spring, 20910. Is there any church that helps with that?";
  const t0 = Date.now();
  const r = await runChatTurn([], q, { status: () => {}, delta: () => {} });
  console.log(`CHAT ${MODEL_CHAT}: ${((Date.now() - t0) / 1000).toFixed(0)}s, ${r.usage.calls} calls, in ${r.usage.input} / cached ${r.usage.cacheRead} / written ${r.usage.cacheWrite} / out ${r.usage.output} → $${r.usage.cost.toFixed(3)}`);
  console.log(r.text.slice(0, 700).replace(/\n+/g, " ") + "…");
  const t1 = Date.now();
  const crawl = await crawlSite("https://www.colesvillepresbyterian.com/");
  const profile = await extractProfile(crawl.pages, "https://www.colesvillepresbyterian.com/");
  console.log(`EXTRACT ${MODEL_EXTRACT}: ${((Date.now() - t1) / 1000).toFixed(0)}s, ${profile.resources.length} resources: ${profile.resources.map((x) => x.title).join("; ")}`);
})();
