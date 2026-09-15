/**
 * Stable editorial descriptions for Lore's Core stations.
 *
 * These are deliberately kept outside the station rows: homepage scraping can
 * refresh its copy, while this small reviewed set remains durable and stable.
 */
export const STATION_DESCRIPTION_OVERRIDES = {
  kexp:
    "Seattle's KEXP 90.3 FM is a listener-supported public radio station devoted to music discovery, with local DJs and a broad independent music program.",
  wwoz:
    "WWOZ 90.7 FM is New Orleans community radio, broadcasting the city's musical traditions and culture alongside jazz, blues, R&B, and other local sounds.",
  kutx:
    "KUTX 98.9 FM is Austin's music station, presenting a locally rooted public-radio mix of new releases, established artists, and Texas-connected programming.",
  "kcrw-eclectic24":
    "KCRW Eclectic24 is the Los Angeles public radio service's continuous music stream, drawing on KCRW programming for an eclectic, music-focused channel.",
  "nts-1":
    "NTS 1 is one of NTS Radio's London-based 24/7 channels, carrying continuously curated, genre-fluid programming with live track and show metadata.",
  "nts-2":
    "NTS 2 is an NTS Radio London 24/7 channel for continuously curated, genre-fluid programming, with a separate stream and its own live show context.",
  "bbc-6music":
    "BBC 6 Music is the BBC's music service for alternative sounds, connecting new releases with influential artists and selections from the station's deep catalog.",
  "fip-main":
    "FIP Main is Radio France's national music service, known for an eclectic, presenter-led flow that moves across styles and languages without a fixed genre lane.",
  wfmu:
    "WFMU is an independent, listener-supported freeform radio station whose schedule spans adventurous music and spoken programming beyond a single format.",
  "bytefm-192k":
    "ByteFM is a Hamburg-based German music broadcaster with a 192k stream, a published programme, and programming centered on contemporary music culture.",
  dublab:
    "Dublab is a Los Angeles nonprofit internet radio station, broadcasting artist-led music programming and cultural shows from its online studio and schedule.",
  "rinse-fm":
    "Rinse FM is a London station focused on grime, garage, UK bass, and forward club sounds, with a live schedule and an official stream for its UK service.",
  "rb-b58a4aaa-d5be-4925-be71-f69d1cccc13f":
    "KCHUNG Radio is an independent online station whose official stream carries live track metadata, connecting listeners with its music-focused broadcast.",
  "rb-308a9f58-fb54-44dc-b95d-bb40fe4f3631":
    "Radio AlHara is an independent Palestinian community radio station based in Bethlehem and Ramallah, with online programming for local and regional voices.",
} as const;

export type StationDescriptionSlug = keyof typeof STATION_DESCRIPTION_OVERRIDES;

/** Return reviewed copy for a station, or undefined when it has none. */
export function getStationDescription(slug: string): string | undefined {
  return STATION_DESCRIPTION_OVERRIDES[slug as StationDescriptionSlug];
}