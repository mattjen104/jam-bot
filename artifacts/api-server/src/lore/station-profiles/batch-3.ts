export type StationProfileSource = {
  label: string;
  url: `https://${string}`;
  type: "official" | "independent";
};

export type StationProfile = {
  name: string;
  summary: string;
  description: string;
  sources: readonly StationProfileSource[];
  reviewedAt: "2026-09-15";
};

/**
 * Editorial station cards for the third research batch. The copy is kept
 * deliberately separate from the seed roster so that identity and programming
 * notes can be reviewed without changing playback configuration.
 */
export const STATION_PROFILES_BATCH_3 = {
  "radio-k": {
    name: "Radio K (KUOM)",
    summary:
      "The University of Minnesota’s student-run station pairs an unusually long broadcast history with independent music, specialty shows, and hands-on training from Minneapolis.",
    description:
      "Radio K is the University of Minnesota’s student-run station, broadcasting from Minneapolis under the KUOM identity. Its own account describes a wide independent-music remit, specialty programming, and the Real College Podcast alongside practical education for student broadcasters. That makes the station feel less like a single-format service than a working campus outlet where discovery and training share the same schedule.\n\nThe station traces university radio experiments to 1912. The history page records a 1922 broadcasting licence, educational and distance-learning work, and the later student operation WMMR before its relationship with KUOM developed into today’s Radio K. Those earlier chapters matter because they explain the station’s mix of public-service heritage and student control without reducing its current output to nostalgia.",
    sources: [
      {
        label: "Radio K — About Us",
        url: "https://radiok.org/about/",
        type: "official",
      },
      {
        label: "Radio K — History",
        url: "https://radiok.org/history/",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },
  "fbi-radio": {
    name: "FBi Radio",
    summary:
      "Sydney’s independent community station FBi Radio broadcasts on 94.5 FM and online, with a volunteer-led brief to champion emerging local music, arts, and culture.",
    description:
      "FBi Radio is a Sydney community station run by Free Broadcast Inc. Its current About page describes an independent, not-for-profit organisation built around local broadcasters and creatives, with volunteers helping find and present independent artists. The station says its music policy includes 50 per cent Australian music, with half of that share coming from Sydney, giving its broad cultural remit a clearly local frame.\n\nThe station’s story reaches back to Free Broadcast Inc.’s establishment in 1995 and a series of test broadcasts before a full-time licence arrived. FBi says it began broadcasting on 94.5 FM on 29 August 2003; the same service is now available online and on DAB+ in Sydney. The result is a useful bridge between grassroots participation and a city-wide broadcast service, with the schedule and support programme keeping that volunteer infrastructure visible.",
    sources: [
      {
        label: "FBi Radio — About us",
        url: "https://www.fbi.radio/about-us",
        type: "official",
      },
      {
        label: "FBi Radio — Schedule",
        url: "https://www.fbi.radio/schedule",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },
  cjlo: {
    name: "CJLO 1690AM",
    summary:
      "Concordia University’s volunteer radio station serves Montréal in English and French, combining online broadcasting with a 1690 AM signal and a wide campus-community schedule.",
    description:
      "CJLO is Concordia University’s radio station, based at the Loyola campus in Montréal. Its station information describes a non-profit operation run largely by volunteers, with programming shaped by the university and the surrounding community. The schedule’s mix of music and talk gives presenters room to work across languages, genres, and specialist interests rather than following a single commercial format.\n\nThe station was formed in 1998 through the merger of Concordia stations CRSG and CFLI. CJLO says it began streaming seven days a week in early 2003, then added 1690 AM broadcasting across the Montréal area in 2008 at 1,000 watts. That history places today’s online stream alongside a tangible local signal and an organisation governed through the Concordia Student Broadcasting Corporation.",
    sources: [
      {
        label: "CJLO — About the station",
        url: "https://www.cjlo.com/about",
        type: "official",
      },
      {
        label: "CJLO — Schedule",
        url: "https://www.cjlo.com/schedule",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },
  "soho-radio": {
    name: "Soho Radio",
    summary:
      "Soho Radio is an online station broadcasting from Soho and New York, with a presenter-led schedule that moves between contemporary music, specialist selections, and spoken features.",
    description:
      "Soho Radio describes itself as an online station broadcasting live from Soho and New York to listeners around the world. Its identity is rooted in live programming: the schedule presents individual shows and hosts rather than a rotating automated playlist, so the station’s character comes from the people making selections and conversations in real time.\n\nThe London site and schedule show a deliberately broad music brief, with programmes spanning club sounds, soul, jazz, electronic music, guitar music, and culture-led conversation. This is a profile of a digital broadcaster rather than a terrestrial service: there is no claim here about a transmitter footprint, only the station’s own description of its two broadcast bases and its published programme grid. The result is an easy place to dip into a particular host’s taste while still finding a varied day of radio.",
    sources: [
      {
        label: "Soho Radio — About",
        url: "https://sohoradio.com/about/",
        type: "official",
      },
      {
        label: "Soho Radio — Schedule",
        url: "https://sohoradio.com/schedule/",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },
  "voices-radio": {
    name: "Voices Radio",
    summary:
      "London’s Voices Radio grew from the Ossia club network into an online station and podcast studio, pairing regular broadcasts with workshops and paid opportunities for new contributors.",
    description:
      "Voices Radio is a London online station and podcast studio that grew out of Ossia, a nomadic club series and booking network. The station’s account says Voices rebranded in 2020 after a run of lockdown podcasts, then launched from Coal Drops Yard in June 2021. That route from events to audio is important to its format: the broadcast is presented as a platform for the organisers, artists, and community encountered through those conversations.\n\nThe station also documents a practical participation programme. Voices says its free workshops have offered studio time and learning opportunities to female, femme and non-binary emerging talent, people of colour, and people from working-class backgrounds. Its About page reports more than 350 regular contributors and paid work for more than 50 creative freelancers; those are the organisation’s stated figures, not an independent estimate. The schedule and studio therefore sit together as both output and infrastructure.",
    sources: [
      {
        label: "Voices Radio — About",
        url: "https://www.voicesradio.co.uk/about/",
        type: "official",
      },
      {
        label: "Voices Radio — Schedule",
        url: "https://voicesradio.airtime.pro/",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },
  "kool-fm": {
    name: "Kool FM",
    summary:
      "Kool FM is Rinse’s London channel for drum and bass, jungle, and related bass music, with specialist shows and a schedule built around DJs and scene contributors.",
    description:
      "Kool FM is the bass-focused channel presented within the Rinse network. The channel page identifies its programme areas with labels including Drum & Bass and Jungle, and its live schedule is organised around named presenters, guest mixes, and specialist shows. That makes Kool a focused companion to Rinse’s wider UK service rather than a generic second stream.\n\nThe channel belongs to Rinse’s London broadcast operation and uses the network’s online player and schedule. Its value is in continuity: listeners can follow a particular DJ’s slot, move between drum-and-bass and jungle selections, and use the programme pages to see the surrounding context. This profile sticks to what Rinse publishes—channel identity, genres, presenters, and schedule—without turning a scene association into an unsupported claim about influence or chronology.",
    sources: [
      {
        label: "Rinse — Kool FM",
        url: "https://www.rinse.fm/channels/kool",
        type: "official",
      },
      {
        label: "Rinse — Home and channels",
        url: "https://www.rinse.fm/",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },
  kutx: {
    name: "KUTX 98.9 FM",
    summary:
      "KUTX’s Austin Music Experience combines a 98.9 FM service with online listening, local sessions, interviews, and a schedule that connects new releases with Texas music culture.",
    description:
      "KUTX is the Austin Music Experience: an Austin-based music service whose website pairs live listening with artist sessions, interviews, discovery features, and local music coverage. The station’s schedule shows the editorial work behind the stream, moving between hosted programmes and specialist selections instead of presenting an undifferentiated music feed. Its 98.9 FM identity remains central, while the website extends the station’s reach through on-demand material and web listening.\n\nThe station’s published output keeps Austin in view without limiting the music to one genre. A listener can encounter new releases, established catalogue selections, and Texas artists across different shows, with hosts supplying the context. This description intentionally focuses on the service KUTX presents now—its Austin remit, 98.9 FM broadcast, online player, and programme structure—rather than adding an unverified founding date or institutional history.",
    sources: [
      {
        label: "KUTX — The Austin Music Experience",
        url: "https://kutx.org/",
        type: "official",
      },
      {
        label: "KUTX — Schedule",
        url: "https://kutx.org/program-schedule/",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },
  "nts-1": {
    name: "NTS 1",
    summary:
      "NTS 1 is the first live channel of London-founded NTS Radio, carrying continuous presenter-led broadcasts and specialist selections that connect local scenes with listeners worldwide.",
    description:
      "NTS 1 is Channel 1 of NTS Radio’s live service. NTS presents the channel through a continuous schedule of resident shows, guest programmes, and broadcasts from different places, with the archive preserving episodes and tracklists after transmission. The result is a radio channel organised around curators and scenes: a listener may move from an established resident to a guest set without the station needing to settle on one genre.\n\nThe official player distinguishes NTS 1 from Channel 2 while the schedule supplies the surrounding programme context. NTS’s About material frames the service as a global music broadcaster, but this card avoids treating “global” as a claim about audience size or cultural impact. NTS 1 is best understood as the first of two parallel live feeds: a changing sequence of human-led programmes, documented in the station’s archive and available through its web player.",
    sources: [
      {
        label: "NTS — About",
        url: "https://www.nts.live/about",
        type: "official",
      },
      {
        label: "NTS — Schedule",
        url: "https://www.nts.live/schedule/",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },
  "nts-2": {
    name: "NTS 2",
    summary:
      "NTS 2 is the second live NTS Radio channel, a parallel stream of hosted shows, guest broadcasts, and genre-fluid selections documented through the station’s online schedule and archive.",
    description:
      "NTS 2 is the second live channel in NTS Radio’s two-stream player. Its schedule places resident programmes, guest broadcasts, and specialist sets alongside one another, so the channel’s identity is created by its changing contributors rather than by a fixed format. The station’s online archive and episode pages add a useful afterlife: listeners can return to programmes and, where published, their tracklists after the live broadcast has ended.\n\nNTS describes its work as connecting music from many places, and the channel pages show that geographic range in the broadcasts and hosts listed there. That does not require a claim that every programme sounds alike; NTS 2 is more usefully approached as a route through distinct curatorial voices. As the companion to NTS 1, it lets the service run two simultaneous editorial streams while retaining the same player, schedule, and archive infrastructure.",
    sources: [
      {
        label: "NTS — About",
        url: "https://www.nts.live/about",
        type: "official",
      },
      {
        label: "NTS — Schedule",
        url: "https://www.nts.live/schedule/",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },
  "bbc-6music": {
    name: "BBC 6 Music",
    summary:
      "BBC 6 Music is a UK-wide BBC music network with a presenter-led mix of new releases, overlooked catalogue tracks, sessions, and specialist programmes available through BBC Sounds.",
    description:
      "BBC 6 Music is the BBC’s music network for listeners who want a broad route through new releases, catalogue tracks, artist sessions, and specialist programmes. The BBC Sounds service publishes a live stream and a rolling schedule of presenters and programmes, so the station’s personality comes through both its individual shows and the changing day-to-day sequence. It is a national network rather than a local city station, with listening delivered through BBC Sounds and broadcast platforms listed by the BBC.\n\nThe network’s schedule moves between accessible daytime shows and more focused evening or weekend programmes, giving different kinds of music knowledge room to sit together. This profile uses the BBC’s own network and schedule descriptions, and does not assign a single genre or claim that every selection is new. For a listener, 6 Music is a programme-led guide: follow a host, explore a session, or use the live feed as a starting point for the BBC’s wider music archive.",
    sources: [
      {
        label: "BBC Sounds — Radio 6 Music live",
        url: "https://www.bbc.co.uk/sounds/play/live/bbc_6music",
        type: "official",
      },
      {
        label: "BBC — 6 Music schedule",
        url: "https://www.bbc.co.uk/sounds/schedules/bbc_6music",
        type: "official",
      },
      {
        label: "BBC Radio 6 Music — Wikipedia overview",
        url: "https://en.wikipedia.org/wiki/BBC_Radio_6_Music",
        type: "independent",
      },
    ],
    reviewedAt: "2026-09-15",
  },
} as const satisfies Record<string, StationProfile>;
