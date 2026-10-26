// Fetch each FLA team page and write calendars/<id>.ics
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { parseTeamPage, buildIcs } from "./fla.mjs";

const teams = (process.env.TEAM_IDS || "7").split(",").map((s) => s.trim()).filter(Boolean);
let failed = 0;
for (const id of teams) {
  const sourceUrl = `https://football-loisir-amateur.fr/teams/${id}`;
  try {
    const res = await fetch(sourceUrl, { headers: { "User-Agent": "Mozilla/5.0 (fla-agenda)", "Accept-Language": "fr-FR" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseTeamPage(await res.text());
    if (!parsed.matches.length) throw new Error("aucun match trouvé (page modifiée ?)");
    const out = `calendars/${id}.ics`;
    const ics = buildIcs(parsed, { sourceUrl, teamId: id });
    // Only rewrite when events changed (ignore DTSTAMP) to keep history clean.
    const strip = (s) => s.replace(/^DTSTAMP:.*$/gm, "");
    if (existsSync(out) && strip(readFileSync(out, "utf8")) === strip(ics)) {
      console.log(`${id}: inchangé (${parsed.matches.length} matchs)`);
    } else {
      writeFileSync(out, ics);
      console.log(`${id}: mis à jour (${parsed.matches.length} matchs)`);
    }
  } catch (e) {
    failed++;
    console.error(`${id}: ÉCHEC — ${e.message}`);
  }
}
// Keep the previous file on failure; fail the run so GitHub emails an alert.
if (failed) process.exit(1);
