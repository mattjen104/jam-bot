import { createHash } from "node:crypto";

/**
 * Deterministic handle generator.
 *
 * Produces a stable "AdjectiveNoun##" handle from a device key.  The same
 * device key always returns the same handle — no randomness, no DB storage.
 * The two-digit suffix gives 100 × 100 × 100 = 1 000 000 distinct handles
 * before any collision in the core word pair, which is sufficient for a
 * community-sized listener base.
 */

const ADJECTIVES: string[] = [
  "Ancient","Amber","Arctic","Autumn","Azure","Bitter","Blazing","Bleak",
  "Briny","Bright","Broken","Bronze","Burning","Calm","Carved","Cerulean",
  "Cold","Coral","Crimson","Cryptic","Dark","Drifting","Dusky","Dusty",
  "Dying","Eerie","Endless","Faded","Fallen","Far","Foggy","Frozen",
  "Gilded","Gleaming","Grey","Haunted","Hidden","Hollow","Hushed","Icy",
  "Indigo","Ink","Iron","Ivory","Jade","Late","Leaden","Liminal",
  "Lonely","Lost","Lunar","Melting","Midnight","Misty","Moonlit","Murky",
  "Narrow","Night","Obsidian","Ocre","Pale","Phantom","Quiet","Ragged",
  "Rain","Restless","Rusted","Salt","Scarlet","Shadow","Silent","Silver",
  "Sleepy","Slow","Smoke","Soft","Stark","Still","Stone","Strange",
  "Sullen","Sunken","Thin","Tidal","Twilight","Unnamed","Velvet","Verdant",
  "Wan","Weathered","Whispering","Wild","Windswept","Wistful","Worn","Yellow",
];

const NOUNS: string[] = [
  "Anchor","Ash","Attic","Beacon","Bell","Bloom","Bottle","Cage",
  "Candle","Cargo","Cave","Chord","Cinder","Clock","Cloud","Coast",
  "Compass","Cord","Creek","Crest","Crow","Deck","Dell","Dusk",
  "Echo","Edge","Ember","Estuary","Field","Flame","Flint","Fog",
  "Forest","Gate","Ghost","Grove","Harbor","Haze","Hill","Horizon",
  "Hull","Hymn","Inlet","Isle","Key","Lamp","Leaf","Light",
  "Loom","March","Marsh","Mast","Mire","Moon","Moor","Night",
  "Note","Oak","Page","Path","Peak","Pier","Pine","Plain",
  "Port","Rain","Reed","Ridge","Rift","Rook","Rope","Salt",
  "Sand","Sea","Shore","Signal","Smoke","Song","Soot","Star",
  "Stone","Storm","Stream","Tide","Tower","Trail","Vale","Vine",
  "Wake","Wave","Well","Wind","Wire","Wood","Wreck","Yard",
];

/**
 * Returns a deterministic "AdjectiveNoun##" handle for the given device key.
 * Stable forever: changing the word lists would break existing handles.
 */
export function deviceHandle(deviceKey: string): string {
  const hash = createHash("sha256").update(deviceKey).digest();
  // Use three independent 4-byte windows so adjective, noun, and suffix
  // selections are nearly independent.
  const adjIdx  = hash.readUInt32BE(0) % ADJECTIVES.length;
  const nounIdx = hash.readUInt32BE(4) % NOUNS.length;
  const suffix  = hash.readUInt32BE(8) % 100;

  const adj  = ADJECTIVES[adjIdx]!;
  const noun = NOUNS[nounIdx]!;
  const sfx  = suffix.toString().padStart(2, "0");
  return `${adj}${noun}${sfx}`;
}
