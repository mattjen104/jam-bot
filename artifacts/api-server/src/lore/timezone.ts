/**
 * Best-effort IANA timezone inference from city + country.
 * Returns null when the timezone cannot be confidently determined.
 * Uses a curated lookup table — deliberately conservative (returns null rather
 * than guessing) so the UI falls back to the generic "station's local time" note.
 *
 * Shared by the seed (writes ianaTimezone on upsert) and the
 * upcoming-schedule endpoint (fallback for rows without a stored value).
 */
/**
 * Normalize a country value to a 2-letter ISO code. RadioBrowser-sourced
 * stations store full English names ("The United States Of America",
 * "Bosnia And Herzegovina") rather than ISO codes, which previously made
 * every inference miss. Returns the input unchanged when already 2 letters.
 */
function normalizeCountry(country: string | null): string | null {
  if (!country) return null;
  const t = country.trim().toUpperCase();
  if (t.length === 2) return t;
  const NAMES: Record<string, string> = {
    "THE UNITED STATES OF AMERICA": "US",
    "UNITED STATES OF AMERICA": "US",
    "UNITED STATES": "US",
    "THE UNITED KINGDOM OF GREAT BRITAIN AND NORTHERN IRELAND": "GB",
    "UNITED KINGDOM": "GB",
    "THE NETHERLANDS": "NL",
    NETHERLANDS: "NL",
    FRANCE: "FR",
    GERMANY: "DE",
    BELGIUM: "BE",
    SPAIN: "ES",
    ITALY: "IT",
    PORTUGAL: "PT",
    SWEDEN: "SE",
    NORWAY: "NO",
    DENMARK: "DK",
    POLAND: "PL",
    MEXICO: "MX",
    JAPAN: "JP",
    "SOUTH KOREA": "KR",
    "THE REPUBLIC OF KOREA": "KR",
    "NEW ZEALAND": "NZ",
    BRAZIL: "BR",
    AUSTRALIA: "AU",
    CANADA: "CA",
    MOROCCO: "MA",
    SERBIA: "RS",
    "BOSNIA AND HERZEGOVINA": "BA",
    CROATIA: "HR",
    SLOVENIA: "SI",
    QATAR: "QA",
    "THE UNITED ARAB EMIRATES": "AE",
    "UNITED ARAB EMIRATES": "AE",
    ISRAEL: "IL",
    ROMANIA: "RO",
    "WALLIS AND FUTUNA": "WF",
    AUSTRIA: "AT",
    SWITZERLAND: "CH",
    IRELAND: "IE",
    FINLAND: "FI",
    CZECHIA: "CZ",
    "THE CZECH REPUBLIC": "CZ",
    HUNGARY: "HU",
    GREECE: "GR",
    BULGARIA: "BG",
    TURKEY: "TR",
    ARGENTINA: "AR",
    CHILE: "CL",
    COLOMBIA: "CO",
    PERU: "PE",
  };
  return NAMES[t] ?? null;
}

export function inferTimezone(city: string | null, country: string | null): string | null {
  const c = normalizeCountry(country);
  const ci = city?.trim().toLowerCase() ?? null;

  // Single-timezone countries (or dominant single zone)
  if (c === "GB") return "Europe/London";
  if (c === "FR") return "Europe/Paris";
  if (c === "DE") return "Europe/Berlin";
  if (c === "NL") return "Europe/Amsterdam";
  if (c === "BE") return "Europe/Brussels";
  if (c === "ES") return "Europe/Madrid";
  if (c === "IT") return "Europe/Rome";
  if (c === "PT") return "Europe/Lisbon";
  if (c === "SE") return "Europe/Stockholm";
  if (c === "NO") return "Europe/Oslo";
  if (c === "DK") return "Europe/Copenhagen";
  if (c === "PL") return "Europe/Warsaw";
  if (c === "MX") return "America/Mexico_City";
  if (c === "PS") return "Asia/Gaza";
  if (c === "JP") return "Asia/Tokyo";
  if (c === "KR") return "Asia/Seoul";
  if (c === "NZ") return "Pacific/Auckland";
  if (c === "BR") return "America/Sao_Paulo";
  if (c === "MA") return "Africa/Casablanca";
  if (c === "RS") return "Europe/Belgrade";
  if (c === "BA") return "Europe/Sarajevo";
  if (c === "HR") return "Europe/Zagreb";
  if (c === "SI") return "Europe/Ljubljana";
  if (c === "QA") return "Asia/Qatar";
  if (c === "AE") return "Asia/Dubai";
  if (c === "IL") return "Asia/Jerusalem";
  if (c === "RO") return "Europe/Bucharest";
  if (c === "WF") return "Pacific/Wallis";
  if (c === "AT") return "Europe/Vienna";
  if (c === "CH") return "Europe/Zurich";
  if (c === "IE") return "Europe/Dublin";
  if (c === "FI") return "Europe/Helsinki";
  if (c === "CZ") return "Europe/Prague";
  if (c === "HU") return "Europe/Budapest";
  if (c === "GR") return "Europe/Athens";
  if (c === "BG") return "Europe/Sofia";
  if (c === "TR") return "Europe/Istanbul";
  if (c === "AR") return "America/Argentina/Buenos_Aires";
  if (c === "CL") return "America/Santiago";
  if (c === "CO") return "America/Bogota";
  if (c === "PE") return "America/Lima";

  // Australia — multi-timezone, only infer from city
  if (c === "AU" && ci) {
    if (/sydney|melbourne|canberra|hobart/.test(ci)) return "Australia/Sydney";
    if (/brisbane|gold coast/.test(ci)) return "Australia/Brisbane";
    if (/perth/.test(ci)) return "Australia/Perth";
    if (/adelaide/.test(ci)) return "Australia/Adelaide";
    if (/darwin/.test(ci)) return "Australia/Darwin";
  }

  // Canada — multi-timezone, only infer from city
  if (c === "CA" && ci) {
    if (/vancouver|victoria/.test(ci)) return "America/Vancouver";
    if (/calgary|edmonton/.test(ci)) return "America/Edmonton";
    if (/toronto|ottawa|montreal|quebec/.test(ci)) return "America/Toronto";
    if (/halifax/.test(ci)) return "America/Halifax";
  }

  // US — need city to confidently assign a zone
  if (c === "US" || (c === null && ci)) {
    if (!ci) return null;
    if (/seattle|portland|san francisco|los angeles|berkeley|davis|san diego|santa barbara|santa cruz|pasadena|irvine|long beach|riverside|fresno|sacramento|stockton|olympia|spokane|eugene|tacoma/.test(ci))
      return "America/Los_Angeles";
    if (/denver|boulder|salt lake|albuquerque|phoenix|tucson|colorado springs|fort collins|provo/.test(ci))
      return "America/Denver";
    if (/chicago|evanston|austin|houston|dallas|nashville|new orleans|minneapolis|st\. cloud|saint cloud|kansas city|wichita|oklahoma city|des moines|madison|milwaukee/.test(ci))
      return "America/Chicago";
    if (/new york|brooklyn|queens|bronx|staten island|boston|cambridge|princeton|stony brook|atlanta|miami|chapel hill|durham|raleigh|medford|waltham|washington|pittsburgh|philadelphia|columbus|cleveland|cincinnati|detroit|ann arbor|lansing|buffalo|rochester|albany|providence|hartford|new haven|baltimore|norfolk|richmond|charlotte|columbia|savannah|jacksonville|orlando|tampa|fort lauderdale/.test(ci))
      return "America/New_York";
    // Hawaii
    if (/honolulu|hilo/.test(ci)) return "Pacific/Honolulu";
    // Alaska
    if (/anchorage|fairbanks|juneau/.test(ci)) return "America/Anchorage";
    return null; // US but city not in lookup
  }

  return null;
}
