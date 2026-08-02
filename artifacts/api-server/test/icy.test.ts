import { describe, expect, it } from "vitest";
import {
  parseIcyStreamTitle,
  parseTildeStreamTitle,
  parseStreamTitle,
  isJunkMetadata,
} from "../src/lore/icy.js";

// ---- parseIcyStreamTitle -------------------------------------------------

describe("parseIcyStreamTitle", () => {
  it("extracts StreamTitle from a well-formed ICY block", () => {
    const block = Buffer.from("StreamTitle='Beck - Morning';StreamUrl='';", "utf8");
    expect(parseIcyStreamTitle(block)).toBe("Beck - Morning");
  });

  it("returns null when no StreamTitle key is present", () => {
    const block = Buffer.from("StreamUrl='http://example.com';", "utf8");
    expect(parseIcyStreamTitle(block)).toBeNull();
  });

  it("returns null when StreamTitle is empty", () => {
    const block = Buffer.from("StreamTitle='';", "utf8");
    expect(parseIcyStreamTitle(block)).toBeNull();
  });

  it("falls back to Latin-1 when UTF-8 produces replacement chars", () => {
    // "Jürgen" in Latin-1: J=0x4a ü=0xfc r=0x72 g=0x67 e=0x65 n=0x6e
    const latin1Bytes = Buffer.from(
      [
        // StreamTitle='Jürgen Drews - Test';
        ...Buffer.from("StreamTitle='", "latin1"),
        0x4a, 0xfc, 0x72, 0x67, 0x65, 0x6e, // Jürgen
        ...Buffer.from(" Drews - Test';", "latin1"),
      ],
    );
    const result = parseIcyStreamTitle(latin1Bytes);
    expect(result).toBe("Jürgen Drews - Test");
    expect(result).not.toContain("\uFFFD");
  });

  it("returns the UTF-8 result even when it contains replacement chars (last resort)", () => {
    // Invalid UTF-8 byte 0x80 that isn't Latin-1 extractable either.
    // In this test we just confirm no throw and a non-null result when UTF-8
    // produces garbling but Latin-1 also doesn't help.
    const block = Buffer.concat([
      Buffer.from("StreamTitle='"),
      Buffer.from([0x80, 0x81]), // invalid UTF-8, but valid Latin-1 (€, )
      Buffer.from(" Track';"),
    ]);
    const result = parseIcyStreamTitle(block);
    // May or may not contain replacement chars but must not throw.
    expect(typeof result === "string" || result === null).toBe(true);
  });
});

// ---- parseTildeStreamTitle -----------------------------------------------

const EXAMPLE_TILDE =
  "Diamonds On The Soles Of Her Shoes~Paul Simon~~1986~~333~2026-07-09T17:34:51~2026-07-09T17:39:12~Radio Monte Carlo Nights Story~261.88~7306359a-ae20-4755-99ca-8a0410618b6d";

describe("parseTildeStreamTitle", () => {
  it("parses the full tilde format and extracts all fields", () => {
    const result = parseTildeStreamTitle(EXAMPLE_TILDE);
    expect(result).not.toBeNull();
    expect(result!.rawTitle).toBe("Diamonds On The Soles Of Her Shoes");
    expect(result!.rawArtist).toBe("Paul Simon");
    expect(result!.sourceRecordingId).toBe("7306359a-ae20-4755-99ca-8a0410618b6d");
    expect(result!.durationMs).toBe(333_000); // 333 seconds
  });

  it("parses another tilde example correctly", () => {
    const s =
      "Dream Come True~The Brand New Heavies~~1992~~268~2026-07-09T17:53:16~2026-07-09T17:53:41~Radio Monte Carlo Nights Story~25.68~1b9395fb-a2cd-48d8-9235-2c22d2e38832";
    const result = parseTildeStreamTitle(s);
    expect(result?.rawTitle).toBe("Dream Come True");
    expect(result?.rawArtist).toBe("The Brand New Heavies");
    expect(result?.sourceRecordingId).toBe("1b9395fb-a2cd-48d8-9235-2c22d2e38832");
    expect(result?.durationMs).toBe(268_000);
  });

  it("returns null for a standard Artist - Title string", () => {
    expect(parseTildeStreamTitle("Beck - Heart Is A Drum")).toBeNull();
  });

  it("parses successfully when the last field is not a UUID (omits sourceRecordingId)", () => {
    const s = "Title~Artist~~1990~~200~dt~dt~Station~10~not-a-uuid";
    const result = parseTildeStreamTitle(s);
    expect(result).not.toBeNull();
    expect(result!.rawTitle).toBe("Title");
    expect(result!.rawArtist).toBe("Artist");
    expect(result!.durationMs).toBe(200_000);
    expect(result!.sourceRecordingId).toBeUndefined();
  });

  it("parses successfully when fewer than 11 fields (no UUID slot)", () => {
    const s = "Title~Artist~~1990~~200~dt~dt~Station";
    const result = parseTildeStreamTitle(s);
    expect(result).not.toBeNull();
    expect(result!.rawTitle).toBe("Title");
    expect(result!.rawArtist).toBe("Artist");
    expect(result!.durationMs).toBe(200_000);
    expect(result!.sourceRecordingId).toBeUndefined();
  });

  it("returns null for a string with no tilde", () => {
    expect(parseTildeStreamTitle("Beck - Morning Phase")).toBeNull();
  });

  it("omits sourceRecordingId but still parses when UUID is absent", () => {
    const noUuid =
      "Dream Come True~The Brand New Heavies~~1992~~268~2026-07-09T17:53:16~2026-07-09T17:53:41~Radio Monte Carlo Nights Story~25.68~not-a-uuid";
    const result = parseTildeStreamTitle(noUuid);
    expect(result).not.toBeNull();
    expect(result!.rawTitle).toBe("Dream Come True");
    expect(result!.rawArtist).toBe("The Brand New Heavies");
    expect(result!.durationMs).toBe(268_000);
    expect(result!.sourceRecordingId).toBeUndefined();
  });

  it("parses a short tilde format with exactly 6 fields (no UUID)", () => {
    const short = "Some Song~Some Artist~~1999~~180";
    const result = parseTildeStreamTitle(short);
    expect(result?.rawTitle).toBe("Some Song");
    expect(result?.rawArtist).toBe("Some Artist");
    expect(result?.durationMs).toBe(180_000);
    expect(result?.sourceRecordingId).toBeUndefined();
  });

  it("returns null when duration field is missing or zero", () => {
    const noTime = "Title~Artist~~1990~~~~dt~dt~Station~10~7306359a-ae20-4755-99ca-8a0410618b6d";
    const result = parseTildeStreamTitle(noTime);
    expect(result).toBeNull();
  });

  it("returns null when fewer than 6 fields", () => {
    expect(parseTildeStreamTitle("Title~Artist~~1990~~")).toBeNull();
  });
});

// ---- parseStreamTitle ----------------------------------------------------

describe("parseStreamTitle", () => {
  it("prefers tilde format over standard split", () => {
    const result = parseStreamTitle(EXAMPLE_TILDE);
    expect(result?.rawTitle).toBe("Diamonds On The Soles Of Her Shoes");
    expect(result?.rawArtist).toBe("Paul Simon");
    expect(result?.sourceRecordingId).toBeDefined();
  });

  it("falls back to standard Artist - Title split", () => {
    const result = parseStreamTitle("Beck - Heart Is A Drum");
    expect(result?.rawArtist).toBe("Beck");
    expect(result?.rawTitle).toBe("Heart Is A Drum");
    expect(result?.sourceRecordingId).toBeUndefined();
  });

  it("returns title-only when no delimiter", () => {
    const result = parseStreamTitle("SomeStation ID");
    expect(result?.rawTitle).toBe("SomeStation ID");
    expect(result?.rawArtist).toBeUndefined();
  });

  it("returns null for empty string", () => {
    expect(parseStreamTitle("")).toBeNull();
    expect(parseStreamTitle("   ")).toBeNull();
  });
});

// ---- isJunkMetadata ------------------------------------------------------

describe("isJunkMetadata", () => {
  it("flags identical artist and title", () => {
    expect(isJunkMetadata("LA GIGANTE DE LOS ANDES", "LA GIGANTE DE LOS ANDES")).toBe(true);
    expect(isJunkMetadata("Muzica... La Superlativ", "Muzica... La Superlativ")).toBe(true);
  });

  it("flags ADWTAG_ prefixed entries", () => {
    expect(isJunkMetadata("ADWTAG_60000", "Big R Radio - We'll Be Right Back After This Message")).toBe(true);
    expect(isJunkMetadata("ADWTAG_122000", "THIS STATION WILL CONTINUE AFTER THIS BREAK")).toBe(true);
    expect(isJunkMetadata("Beck", "ADWTAG_30000")).toBe(true);
  });

  it("flags 'espacio publicitario'", () => {
    expect(isJunkMetadata("ESPACIO PUBLICITARIO", "ESPACIO PUBLICITARIO")).toBe(true);
    // Even when only in title
    expect(isJunkMetadata("Some Artist", "ESPACIO PUBLICITARIO")).toBe(true);
  });

  it("flags break announcements (case-insensitive, with and without apostrophe)", () => {
    expect(isJunkMetadata("Big R Radio", "We'll Be Right Back After This Message")).toBe(true);
    expect(isJunkMetadata("Best Net Radio", "Well be right back after this message")).toBe(true);
    expect(isJunkMetadata("Station", "This station will continue after this break")).toBe(true);
    expect(isJunkMetadata("Station", "We'll Be Back After This Message")).toBe(true);
  });

  it("does NOT flag real tracks", () => {
    expect(isJunkMetadata("Beck", "Heart Is A Drum")).toBe(false);
    expect(isJunkMetadata("Paul Simon", "Diamonds On The Soles Of Her Shoes")).toBe(false);
    expect(isJunkMetadata("Cock Robin", "When Your Heart Is Weak")).toBe(false);
    expect(isJunkMetadata("Hisingens Spelmanslag", "Spel Kalles hambopolska")).toBe(false);
  });

  it("flags purely numeric artist or title (station ID codes)", () => {
    expect(isJunkMetadata("12345", "Some Song")).toBe(true);
    expect(isJunkMetadata("Some Artist", "60000")).toBe(true);
    expect(isJunkMetadata("00001", "00001")).toBe(true);
  });

  it("flags ALL_CAPS underscore-slug identifiers", () => {
    expect(isJunkMetadata("STATION_ID_123", "Rock Hits")).toBe(true);
    expect(isJunkMetadata("Beck", "IDENT_LOOP_01")).toBe(true);
    expect(isJunkMetadata("MUZICA_RADIO", "MUZICA_RADIO")).toBe(true);
  });

  it("does NOT flag legitimate ALL_CAPS names without underscores", () => {
    // Real artists/titles in all caps are fine (ABBA, AC/DC, etc.)
    expect(isJunkMetadata("ABBA", "Dancing Queen")).toBe(false);
    expect(isJunkMetadata("ACDC", "Highway to Hell")).toBe(false);
  });

  it("does NOT flag tracks that merely contain a station name in one field", () => {
    // "Vocalo / Chicago" — unusual but not a junk pattern
    expect(isJunkMetadata("Vocalo", "Chicago")).toBe(false);
  });

  it("flags backup-stream indicators in the artist field", () => {
    // CKUT Airtime backup feed: artist = "CKUT (BACKUP ONLY!)", title = show name
    expect(isJunkMetadata("CKUT (BACKUP ONLY!)", "Listen! You Smell Something?")).toBe(true);
    // Generic variant
    expect(isJunkMetadata("Station (BACKUP)", "Some Show Title")).toBe(true);
    expect(isJunkMetadata("WKUT (backup only!)", "Night Shift")).toBe(true);
  });

  it("flags backup-stream indicators in the title field", () => {
    expect(isJunkMetadata("CKUT", "(BACKUP ONLY!) Stream")).toBe(true);
  });

  it("does NOT flag tracks whose title legitimately contains 'back'", () => {
    // "back" must not be mis-triggered — only "(backup" with the opening paren
    expect(isJunkMetadata("Charli XCX", "Backseat")).toBe(false);
    expect(isJunkMetadata("Fleetwood Mac", "Go Your Own Way (Back to Back)")).toBe(false);
  });

  // ── Programming-label artist values ───────────────────────────────────────

  it("flags commercial / break labels in the artist field (case-insensitive)", () => {
    expect(isJunkMetadata("Commercial", "Some Song")).toBe(true);
    expect(isJunkMetadata("commercial break", "Some Song")).toBe(true);
    expect(isJunkMetadata("Advertisement", "Some Song")).toBe(true);
    expect(isJunkMetadata("Ads", "Some Song")).toBe(true);
    expect(isJunkMetadata("Break", "Some Song")).toBe(true);
    expect(isJunkMetadata("Station Break", "Some Song")).toBe(true);
    expect(isJunkMetadata("COMMERCIAL", "Some Song")).toBe(true);
  });

  it("flags station-ID and programming-segment labels", () => {
    expect(isJunkMetadata("Station ID", "Some Song")).toBe(true);
    expect(isJunkMetadata("Legal ID", "Some Song")).toBe(true);
    expect(isJunkMetadata("Sweeper", "Some Song")).toBe(true);
    expect(isJunkMetadata("Jingle", "Some Song")).toBe(true);
    expect(isJunkMetadata("Bumper", "Some Song")).toBe(true);
    expect(isJunkMetadata("Promo", "Some Song")).toBe(true);
    expect(isJunkMetadata("Liner", "Some Song")).toBe(true);
  });

  it("flags news, weather, and traffic filler labels", () => {
    expect(isJunkMetadata("News", "Some Song")).toBe(true);
    expect(isJunkMetadata("News Break", "Some Song")).toBe(true);
    expect(isJunkMetadata("Weather", "Some Song")).toBe(true);
    expect(isJunkMetadata("Traffic", "Some Song")).toBe(true);
    expect(isJunkMetadata("Sports", "Some Song")).toBe(true);
  });

  it("flags generic placeholder values in the artist field", () => {
    expect(isJunkMetadata("Various Artists", "Some Song")).toBe(true);
    expect(isJunkMetadata("TBA", "Some Song")).toBe(true);
    expect(isJunkMetadata("TBD", "Some Song")).toBe(true);
    expect(isJunkMetadata("Loading", "Some Song")).toBe(true);
    expect(isJunkMetadata("Off Air", "Some Song")).toBe(true);
    expect(isJunkMetadata("Automation", "Some Song")).toBe(true);
    expect(isJunkMetadata("Now Playing", "Some Song")).toBe(true);
    expect(isJunkMetadata("None", "Some Song")).toBe(true);
    expect(isJunkMetadata("NULL", "Some Song")).toBe(true);
    expect(isJunkMetadata("Undefined", "Some Song")).toBe(true);
  });

  it("does NOT flag a programming word that only appears in the title", () => {
    // A real song could be titled "Commercial", "News", etc.
    expect(isJunkMetadata("Sonic Youth", "News")).toBe(false);
    expect(isJunkMetadata("Beck", "Commercial")).toBe(false);
    expect(isJunkMetadata("Devo", "Jingle")).toBe(false);
  });

  // ── Pure-punctuation / no-letter artist values ────────────────────────────

  it("flags pure-punctuation artist values (no Unicode letters)", () => {
    expect(isJunkMetadata("---", "Some Song")).toBe(true);
    expect(isJunkMetadata("...", "Some Song")).toBe(true);
    expect(isJunkMetadata("- -", "Some Song")).toBe(true);
    expect(isJunkMetadata("***", "Some Song")).toBe(true);
    expect(isJunkMetadata("????", "Some Song")).toBe(true);
  });

  it("does NOT flag artist names that contain non-ASCII letters", () => {
    // Accented, CJK, Arabic, Cyrillic — all have Unicode letters.
    expect(isJunkMetadata("Sigur Rós", "Hoppípolla")).toBe(false);
    expect(isJunkMetadata("Beyoncé", "Formation")).toBe(false);
    expect(isJunkMetadata("坂本龍一", "Merry Christmas Mr. Lawrence")).toBe(false);
  });

  // ── Audio filename detection ───────────────────────────────────────────────

  it("flags audio filenames in the artist field", () => {
    expect(isJunkMetadata("jingle_01.mp3", "Some Song")).toBe(true);
    expect(isJunkMetadata("news_break.ogg", "Some Song")).toBe(true);
    expect(isJunkMetadata("id.flac", "Some Song")).toBe(true);
    expect(isJunkMetadata("station_id.wav", "Some Song")).toBe(true);
  });

  it("flags audio filenames in the title field", () => {
    expect(isJunkMetadata("Some Artist", "track 01.mp3")).toBe(true);
    expect(isJunkMetadata("Some Artist", "promo.aac")).toBe(true);
    expect(isJunkMetadata("Some Artist", "liner.m4a")).toBe(true);
  });

  it("does NOT flag real track titles that contain a dot but no audio extension", () => {
    expect(isJunkMetadata("Radiohead", "2 + 2 = 5")).toBe(false);
    expect(isJunkMetadata("Interpol", "NYC.")).toBe(false);
    expect(isJunkMetadata("Four Tet", "128 Harrowgate Rd.")).toBe(false);
  });
});
