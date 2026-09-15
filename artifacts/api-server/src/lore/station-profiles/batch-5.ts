export type StationProfileSource = {
  label: string;
  url: string;
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
 * Editorial station cards reviewed against the linked station and institutional
 * pages on 2026-09-15. The copy is intentionally descriptive rather than
 * promotional; the source list is also the claim trail for the profile text.
 */
export const STATION_PROFILES = {
  wrek: {
    name: "WREK 91.1 FM",
    summary:
      "Georgia Tech’s student-managed station has broadcast from Atlanta since 1968, pairing a 100,000-watt FM signal with specialty shows and a wide, freeform online archive.",
    description:
      "WREK is Georgia Tech’s student-managed, operated, and engineered radio station. It began broadcasting on March 25, 1968, and today transmits around the clock from the Georgia Tech Student Center at 91.1 FM, alongside an online stream. The station describes its purpose as both campus learning and public service: students practice organization, production, engineering, and programming while making radio for Atlanta and listeners beyond it.\n\nIts schedule combines in-house specialty programs with syndicated material, public affairs, and recurring formats. The station’s examples range from jazz, classical, and globally minded selections to rock, electronic music, spoken word, sports, and experimental work. That mix is the practical expression of WREK’s policy of varied programming. Georgia Tech’s Radio Communications Board holds the license, while the station says its primary support comes through the Student Government Association.",
    sources: [
      {
        label: "WREK — About",
        url: "https://wrek.org/about/",
        type: "official",
      },
      {
        label: "WREK — Music and programming",
        url: "https://wrek.org/music/",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },

  kdvs: {
    name: "KDVS 90.3 FM",
    summary:
      "UC Davis’s noncommercial, student-run station grew from a 1964 dormitory broadcast into a 24/7 FM service known for diverse, challenging, freeform programming.",
    description:
      "KDVS traces its beginning to students in the Beckett-Hughes dormitories who formed KCD in late 1963; the first carrier-current broadcasts followed from a laundry room on February 1, 1964. In 1967 the FCC granted the UC Regents an educational FM license, and the station became KDVS before its first 10-watt FM broadcast on January 2, 1968. The station’s history records early public-affairs work alongside music, sports, interviews, and programming that departed from commercial formats.\n\nThe station now describes its mission in two connected parts: a laboratory where students learn broadcasting, production, and management, and a source of diverse, challenging, noncommercial freeform radio for its audience. KDVS’s history says the station operates continuously and documents later transmitter upgrades that expanded its reach. Its current identity remains tied to the UC Davis campus while its schedule and stream make the programming available beyond Davis.",
    sources: [
      {
        label: "KDVS — Station history",
        url: "https://kdvs.org/about",
        type: "official",
      },
      {
        label: "UC Davis — Student media",
        url: "https://studentlife.ucdavis.edu/student-media",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },

  whrb: {
    name: "WHRB 95.3 FM",
    summary:
      "Harvard’s volunteer undergraduate radio corporation has served Boston for more than eight decades with classical, jazz, underground rock, news, sports, and weekend specialty programs.",
    description:
      "WHRB is Harvard Radio Broadcasting Co., Inc., a private nonprofit corporation operated on a volunteer basis by Harvard College undergraduates. Its station account describes more than eighty years of broadcasting on 95.3 FM in Boston and emphasizes that undergraduate members, rather than a central commercial format desk, make policy and programming decisions. The stated purpose joins public service with education and hands-on training for the people who operate the station.\n\nThe daily schedule centers on classical music, jazz, and underground rock, while the weekend lineup adds blues and hip-hop, the long-running Hillbilly at Harvard, news, and Harvard sports. WHRB publishes a program guide and a current program schedule, making the station’s deliberately varied listening day visible before tuning in. The result is a Harvard station whose identity is defined by volunteer governance and a broad set of specialist programs, not by one narrow music category.",
    sources: [
      {
        label: "WHRB — About",
        url: "https://www.whrb.org/about/",
        type: "official",
      },
      {
        label: "WHRB — Program schedule",
        url: "https://www.whrb.org/programming/program-schedule/",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },

  wkcr: {
    name: "WKCR 89.9 FM",
    summary:
      "Columbia University’s student radio station broadcasts from New York on 89.9 FM, with a schedule spanning jazz, classical, world music, news, and student-led specialty programs.",
    description:
      "WKCR is Columbia University’s student radio service at 89.9 FM in New York. Its programming is organized around shows hosted and produced by students, with a schedule that moves between music and spoken-word work rather than following a commercial format. The station’s published program listings identify recurring jazz, classical, and world-music programming alongside news, public affairs, and other specialist blocks.\n\nThat breadth is part of the station’s educational setting: WKCR gives Columbia students a place to learn broadcast production and to shape programs for a city audience. The station’s online presence also keeps a live stream and show information available beyond the FM signal. This profile sticks to the durable facts supplied by Columbia’s station listing and WKCR’s own program pages; it does not assign a cultural influence claim to any particular host, era, or genre.",
    sources: [
      {
        label: "WKCR — Official station site",
        url: "https://www.wkcr.org/",
        type: "official",
      },
      {
        label: "Columbia University — WKCR",
        url: "https://www.cc-seas.columbia.edu/wkcr",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },

  kalx: {
    name: "KALX 90.7 FM",
    summary:
      "UC Berkeley’s volunteer station presents student and community-made radio at 90.7 FM, with an eclectic schedule and a history reaching back to the station’s early campus broadcasts.",
    description:
      "KALX is the University of California, Berkeley’s 90.7 FM radio station. The station describes itself as volunteer-made radio and invites people from campus and the surrounding community into its production, programming, and support work. Its philosophy page presents a place for programs outside commercial-radio assumptions, while the schedule shows music and spoken-word shows arranged by individual hosts.\n\nKALX’s official history records a station that developed through Berkeley campus broadcasting as its facilities and volunteer organization evolved. Rather than reducing it to one format, the history and schedule document music, public affairs, news, and specialty programs. The station’s description, “ordinary people making extraordinary radio,” is best read as an account of who makes the broadcasts: volunteers working within a university station, with room to build distinct programs.",
    sources: [
      {
        label: "KALX — Philosophy",
        url: "https://kalx.berkeley.edu/about/philosophy/",
        type: "official",
      },
      {
        label: "KALX — Full history",
        url: "https://kalx.berkeley.edu/about/full-and-unabridged-history-kalx/",
        type: "official",
      },
      {
        label: "KALX — Schedule",
        url: "https://kalx.berkeley.edu/on-the-air/schedule/",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },

  kvrx: {
    name: "KVRX 91.7 FM",
    summary:
      "The University of Texas at Austin’s student-run station began FM broadcasting as KVRX in 1994 and now combines overnight local service with a worldwide stream and Austin showcases.",
    description:
      "KVRX grew out of a Student Radio Task Force formed at the University of Texas at Austin in 1986. Students, faculty, and administrators developed the project as both practical training in radio news, sports, entertainment, and management and an outlet for programming not otherwise available in Austin. The station first broadcast on campus and community cable in 1988; after a time-share agreement with KOOP, KTSB became KVRX in 1994 and began FM broadcasting on November 15 of that year.\n\nThe station currently broadcasts locally on 91.7 FM during evening and overnight hours, with a 24/7 online service. Its official account says more than 200 student DJs participate and that KVRX organizes local showcases, in-studio performances, and artist interviews to support Austin music. The schedule therefore reflects both its student-run training role and its connection to the city’s live music ecosystem, without requiring a single fixed genre label.",
    sources: [
      {
        label: "KVRX — About and history",
        url: "https://kvrx.org/app/about/",
        type: "official",
      },
      {
        label: "KVRX — Program schedule",
        url: "https://kvrx.org/app/schedule/",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },

  wmbr: {
    name: "WMBR 88.1 FM",
    summary:
      "MIT’s student-run community station broadcasts 24 hours a day from Cambridge, pairing eclectic music and public affairs with volunteer training, archives, and a worldwide stream.",
    description:
      "WMBR is the MIT campus radio station at 88.1 FM. Its official station description says it broadcasts 24 hours a day, 365 days a year from the top of Building E37 in Kendall Square, Cambridge, with 640 watts of effective radiated power. The service is built around a broad mix of music shows, public-affairs programs, and eclectic audio entertainment rather than a single format.\n\nWMBR also presents itself as a student-run community organization. MIT students can host shows, make podcasts, maintain broadcast equipment, or help manage the nonprofit, while staff and local community members participate as well. The schedule and program guide make room for regular shows, special events, and rebroadcasts, and the station maintains a live stream and audio archives for listeners outside its FM footprint. Those details place WMBR at the intersection of campus training and Cambridge community radio.",
    sources: [
      {
        label: "WMBR — Station home and mission",
        url: "https://wmbr.org/",
        type: "official",
      },
      {
        label: "WMBR — Program schedule",
        url: "https://wmbr.org/www/sched",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },

  wusb: {
    name: "WUSB 90.1 FM",
    summary:
      "Licensed to Stony Brook University, WUSB has served Long Island since 1977 with volunteer-led freeform music, news, public affairs, drama, sports, and community programming.",
    description:
      "WUSB is a 3,600-watt noncommercial station licensed to Stony Brook University and based on the university campus. The station says it has served Stony Brook and Long Island listening communities since 1977, broadcasting on 90.1 FM and using a campus simulcast at 107.3. Its signal reaches most of Long Island as well as parts of southern Connecticut, New York City, and Westchester County; an internet stream extends access beyond that regional footprint.\n\nThe station calls its format freeform and describes a 24-hour schedule built by more than 160 students, faculty, staff, alumni, and community residents. The published range includes interviews and commentary alongside jazz, pop, punk, metal, electronic, noise, funk, folk, blues, reggae, polka, world music, live music, drama, and sports. Listener donations, university support, underwriting, and grants fund the service, according to WUSB’s station page.",
    sources: [
      {
        label: "WUSB — About",
        url: "https://www.wusb.fm/about",
        type: "official",
      },
      {
        label: "WUSB — Station schedule",
        url: "https://www.wusb.fm/station/schedule",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },

  wuog: {
    name: "WUOG 90.5 FM",
    summary:
      "UGA’s student-run station has broadcast from Athens since 1972, combining music, news, sports, and talk with live events, charity drives, and a stated focus on smaller artists.",
    description:
      "WUOG is the University of Georgia’s student-run radio station at 90.5 FM in Athens. The station’s current description says it was founded in 1972 and broadcasts student music, news, sports, and talk around the clock at 26,000 watts, with an online stream as well. Beyond the transmitter, WUOG says it produces live shows, station-wide events, and charity drives intended to serve the wider Athens community.\n\nMusic discovery is an explicit part of the station’s stated policy. WUOG says it generally avoids giving airtime to artists who have had a Billboard Hot 100 single in the previous twenty years, with limited exceptions; the rule is presented as a way to make room for smaller artists rather than as a claim about a particular scene. The station’s online news and schedule material place those music programs alongside campus reporting, sports, and talk, preserving the student-media mix described by UGA’s station listing.",
    sources: [
      {
        label: "WUOG — Station home and mission",
        url: "https://wuog.org/",
        type: "official",
      },
      {
        label: "University of Georgia — Student media",
        url: "https://www.uga.edu/student-media/wuog",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },

  wvum: {
    name: "WVUM 90.5 FM",
    summary:
      "The University of Miami’s completely student-run station has broadcast since 1968, mixing alternative, electronic, and analog music with news, public affairs, sports, and a worldwide stream.",
    description:
      "WVUM is the University of Miami’s student-run radio station, known on its own site as “The Voice.” The station says it was founded in 1968 and broadcasts over the air throughout South Florida while streaming worldwide. Its stated mission is to create a more united and open-minded South Florida community through content and programming curated by University of Miami students.\n\nMusic is a major part of the schedule, particularly alternative, electronic, and analog selections, but WVUM’s description also identifies news, public affairs, and sports as ongoing parts of the service. The station’s schedule provides the practical view of that mix, showing the programs and hosts behind the stream rather than treating the station as a single genre channel. This profile uses the station’s own history, mission, and schedule language while avoiding broader claims about awards or market position that would require separate documentation.",
    sources: [
      {
        label: "WVUM — About",
        url: "https://www.wvum.org/about",
        type: "official",
      },
      {
        label: "WVUM — Schedule",
        url: "https://www.wvum.org/schedule",
        type: "official",
      },
    ],
    reviewedAt: "2026-09-15",
  },
} as const satisfies Readonly<Record<string, StationProfile>>;

export const stationProfiles = STATION_PROFILES;

export default STATION_PROFILES;