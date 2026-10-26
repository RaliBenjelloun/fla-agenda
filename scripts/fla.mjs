// Parse a football-loisir-amateur.fr team page and build an iCalendar feed.

const MONTHS = {
  "janv": 1, "févr": 2, "fevr": 2, "mars": 3, "avr": 4, "mai": 5, "juin": 6,
  "juil": 7, "août": 8, "aout": 8, "sept": 9, "oct": 10, "nov": 11, "déc": 12, "dec": 12,
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function toText(html) {
  return decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
  ).replace(/[\u00a0\s]+/g, " ").trim();
}

const HEADER_RE = new RegExp(
  "(Championnat|Coupe)\\s+(.+?)\\s+(Domicile|Extérieur)\\s+" +
  "(Reçoit|Se déplace chez)\\s+(.+?)\\s+" +
  "[a-zé]{3,4}\\.?\\s+(\\d{1,2})(?:er)?\\s+([a-zéû]+)\\.?\\s+(\\d{4})\\s*·\\s*(\\d{1,2})h(\\d{2})",
  "i",
);
const SCORE_RE = /^\s*(\d+)\s*[–-]\s*(\d+)\s*([VND])\b/;

/**
 * Returns { teamName, matches: [{ start:{y,m,d,hh,mm}, home, opponent, competition, location, score }] }
 */
export function parseTeamPage(html) {
  const title = decodeEntities((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const teamName = title.split(" — ")[0].trim() || "Équipe FLA";

  // Each match block carries exactly one Google Maps link; split on those links.
  const linkRe = /<a\b[^>]*href="(https:\/\/www\.google\.com\/maps\/search\/[^"]+)"[^>]*>[\s\S]*?<\/a>/gi;
  const pieces = [];
  let last = 0, m;
  while ((m = linkRe.exec(html))) {
    pieces.push({ before: html.slice(last, m.index), href: m[1] });
    last = linkRe.lastIndex;
  }
  const tail = html.slice(last);

  const byKey = new Map();
  for (let i = 0; i < pieces.length; i++) {
    const text = toText(pieces[i].before);
    // The header is the last match header in this chunk (chunk may start with previous score).
    const all = [...text.matchAll(new RegExp(HEADER_RE.source, "gi"))];
    if (!all.length) continue;
    const h = all[all.length - 1];
    const [, kind, compRest, side, , opponent, d, monRaw, y, hh, mm] = h;
    const mon = MONTHS[monRaw.toLowerCase().replace(/\.$/, "")];
    if (!mon) continue;

    let location = "";
    try {
      const q = new URL(decodeEntities(pieces[i].href)).searchParams.get("query");
      location = (q || "").trim();
    } catch { /* ignore */ }

    const after = toText(i + 1 < pieces.length ? pieces[i + 1].before : tail);
    const sm = after.match(SCORE_RE);
    const score = sm ? `${sm[1]}-${sm[2]} ${sm[3]}` : "";

    let competition = `${kind} ${compRest}`.replace(/\s+/g, " ").trim();
    competition = competition.replace(/^Coupe COUPE/i, "Coupe");

    const match = {
      start: { y: +y, m: mon, d: +d, hh: +hh, mm: +mm },
      home: side === "Domicile",
      opponent: opponent.trim(),
      competition,
      location,
      score,
    };
    const key = `${y}-${mon}-${d}-${match.opponent}`;
    const prev = byKey.get(key);
    if (!prev || (!prev.score && score)) byKey.set(key, match);
  }

  const matches = [...byKey.values()].sort((a, b) =>
    Date.UTC(a.start.y, a.start.m - 1, a.start.d, a.start.hh, a.start.mm) -
    Date.UTC(b.start.y, b.start.m - 1, b.start.d, b.start.hh, b.start.mm));
  return { teamName, matches };
}

const pad = (n) => String(n).padStart(2, "0");
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");

function fold(line) {
  // RFC 5545: fold lines longer than 75 octets.
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let cur = "", curLen = 0, limit = 75;
  for (const ch of line) {
    const l = new TextEncoder().encode(ch).length;
    if (curLen + l > limit) { out.push(cur); cur = " "; curLen = 1; limit = 75; }
    cur += ch; curLen += l;
  }
  out.push(cur);
  return out.join("\r\n");
}

export function buildIcs({ teamName, matches }, { sourceUrl, teamId, durationMin = 60, alarmMin = 120 }) {
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const L = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//fla-calendar//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc("⚽ " + teamName)}`, "X-WR-TIMEZONE:Europe/Paris",
    "REFRESH-INTERVAL;VALUE=DURATION:P1D", "X-PUBLISHED-TTL:P1D",
    "BEGIN:VTIMEZONE", "TZID:Europe/Paris",
    "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
    "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
    "END:VTIMEZONE",
  ];
  const short = teamName.split(" ")[0];
  for (const mt of matches) {
    const s = mt.start;
    const startMin = s.hh * 60 + s.mm + durationMin;
    const e = { hh: Math.floor(startMin / 60), mm: startMin % 60 };
    const dt = (hh, mm) => `${s.y}${pad(s.m)}${pad(s.d)}T${pad(hh)}${pad(mm)}00`;
    let title = mt.home ? `${short} vs ${mt.opponent}` : `${mt.opponent} vs ${short}`;
    if (mt.score) title += ` (${mt.score})`;
    const uid = `fla-${teamId}-${s.y}${pad(s.m)}${pad(s.d)}-${mt.opponent.toLowerCase().replace(/[^a-z0-9]+/g, "")}@fla-calendar`;
    L.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Paris:${dt(s.hh, s.mm)}`,
      `DTEND;TZID=Europe/Paris:${dt(e.hh, e.mm)}`,
      `SUMMARY:${esc("⚽ " + title)}`,
      `LOCATION:${esc(mt.location)}`,
      `DESCRIPTION:${esc(`${mt.competition} · ${mt.home ? "Domicile" : "Extérieur"}\nSource : ${sourceUrl}`)}`,
      `URL:${sourceUrl}`);
    if (!mt.score) {
      L.push("BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Match de foot", `TRIGGER:-PT${alarmMin}M`, "END:VALARM");
    }
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}
