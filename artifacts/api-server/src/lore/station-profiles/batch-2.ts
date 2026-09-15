/**
 * Reviewed station profiles for the second editorial batch.
 *
 * These are deliberately kept as data rather than folded into the station
 * seed: the profile copy is sourced editorial material and does not control
 * playback, scheduling, or station discovery.
 */
export const STATION_PROFILES = {
  wpfw: {
    name: "WPFW 89.3 FM",
    summary:
      "Washington, D.C.'s WPFW 89.3 FM pairs jazz, blues, global music, news, and public affairs with a listener-supported community-radio model.",
    description:
      "WPFW broadcasts at 89.3 FM in Washington, D.C., presenting itself as a station for “Jazz & Justice.” Its current program pages place jazz beside blues, global music, news, and public-affairs shows, so the schedule moves between music programming and civic conversation rather than a single format.\n\nThe station’s program directory is the best guide to that breadth: it lists recurring shows, hosts, and listening times, while the home page provides the live player and station identity. WPFW also publishes a current schedule for listeners who want to follow individual programs instead of treating the stream as an undifferentiated channel. This is a useful stop for listeners looking for Washington community radio where music and public life share the same schedule.",
    sources: [
      { label: "WPFW official home", url: "https://www.wpfwdc.org/", type: "official" },
      { label: "WPFW official programs", url: "https://www.wpfwdc.org/programs", type: "official" },
      { label: "WPFW official schedule grid", url: "https://www.wpfwdc.org/schedule-grid", type: "official" },
    ],
    reviewedAt: "2026-09-15",
  },

  wknc: {
    name: "WKNC 88.1 FM",
    summary:
      "NC State student radio WKNC 88.1 FM combines student-led alternative programming with separate HD-1 and HD-2 schedules for indie and electronic music.",
    description:
      "WKNC is North Carolina State University’s student radio service at 88.1 FM. The station’s own about page describes a student-run operation with multiple programming streams, and its schedule separates HD-1 from HD-2. That structure gives the station room for an alternative-music schedule alongside a distinct electronic-music channel.\n\nThe schedule is the practical way into WKNC: it identifies shows and their time slots rather than reducing the station to one genre label. Because students make and present the programming, the station has the texture of campus radio while remaining useful to anyone listening beyond Raleigh. WKNC’s official pages also make the HD channels explicit, so listeners can choose the stream that fits the kind of set they want to hear.",
    sources: [
      { label: "WKNC official about page", url: "https://wknc.org/about/", type: "official" },
      { label: "WKNC official HD-1 schedule", url: "https://wknc.org/schedule/hd-1/", type: "official" },
      { label: "NC State Student Media: WKNC", url: "https://studentmedia.ncsu.edu/wknc/", type: "official" },
    ],
    reviewedAt: "2026-09-15",
  },

  wxdu: {
    name: "WXDU 88.7 FM",
    summary:
      "Duke University’s WXDU 88.7 FM is a student-run, freeform station whose schedule gives independent DJs room for eclectic and specialist music programming.",
    description:
      "WXDU is Duke University’s 88.7 FM student radio station in Durham, North Carolina. Its official site presents the service as freeform radio: programming is shaped by individual DJs and can move across specialist music interests rather than following a tightly fixed commercial format. The station’s schedule is therefore more useful than a single genre tag when deciding when to tune in.\n\nThat student-radio setting matters to the listening experience. WXDU’s broadcast is a place for campus programmers to assemble sets, introduce records, and give less predictable selections a home. The official schedule provides the current timetable, while the station site supplies the live-listening entry point. Together they describe a local, volunteer-minded music channel whose variety comes from its rotating programmers.",
    sources: [
      { label: "WXDU official station site", url: "https://www.wxdu.org/", type: "official" },
      { label: "WXDU official schedule", url: "https://www.wxdu.org/schedule", type: "official" },
      { label: "Duke student radio information", url: "https://students.duke.edu/engage/student-organizations/", type: "official" },
    ],
    reviewedAt: "2026-09-15",
  },

  wxyc: {
    name: "WXYC 89.3 FM",
    summary:
      "UNC-Chapel Hill’s WXYC 89.3 FM is a 24-hour student-run freeform station with a broad local signal, online archive, and strong support for independent music.",
    description:
      "WXYC is the non-commercial, student-run station of the University of North Carolina at Chapel Hill. Its official history page says the station broadcasts at 1,100 watts from the student union, 24 hours a day, with coverage reaching Chapel Hill, Durham, Pittsboro, Apex, and parts of Raleigh. The station also identifies its programming as freeform and highlights support for local and independent artists and labels.\n\nWXYC’s web identity extends beyond the live signal. The station says it began rebroadcasting over the Internet in November 1994, and its current site maintains an archive alongside programming information. About 150 students and alumni are involved in on-air or administrative work, with current students serving as DJs. The result is a campus station with a durable public archive and a schedule that rewards browsing rather than preset-format listening.",
    sources: [
      { label: "WXYC official about and history", url: "https://wxyc.org/about", type: "official" },
      { label: "WXYC official programming", url: "https://wxyc.org/programming", type: "official" },
      { label: "WXYC official archive", url: "https://wxyc.org/archive", type: "official" },
    ],
    reviewedAt: "2026-09-15",
  },

  wwoz: {
    name: "WWOZ 90.7 FM",
    summary:
      "New Orleans community station WWOZ 90.7 FM is the city’s Jazz and Heritage Station, connecting daily programming with local culture and live events.",
    description:
      "WWOZ 90.7 FM operates from New Orleans’ French Quarter as a community radio station focused on the city’s musical and cultural heritage. Its official description calls it the New Orleans Jazz and Heritage Station and explains that its governance board is appointed by the New Orleans Jazz & Heritage Festival and Foundation. The station’s mission is framed around carrying New Orleans culture and musical heritage to listeners beyond the city.\n\nThe live schedule reflects that responsibility without being limited to festival broadcasts. WWOZ publishes a weekly program calendar and reports live coverage of events in New Orleans and elsewhere, including an annual broadcast from the New Orleans Jazz & Heritage Festival. Its community calendar adds another layer: the station’s role includes pointing listeners toward local events as well as putting music on the air. WWOZ is therefore both a daily music service and a civic record of the city’s scene.",
    sources: [
      { label: "WWOZ official about page", url: "https://www.wwoz.org/about-wwoz", type: "official" },
      { label: "WWOZ official schedule", url: "https://www.wwoz.org/schedule", type: "official" },
      { label: "WWOZ official community calendar", url: "https://www.wwoz.org/calendar/community", type: "official" },
    ],
    reviewedAt: "2026-09-15",
  },

  wfmu: {
    name: "WFMU",
    summary:
      "WFMU is an independent, listener-supported freeform station with a New York-area broadcast, an online stream, and an unusually deep program archive.",
    description:
      "WFMU describes itself as freeform radio: its schedule is assembled from individually hosted programs rather than a single station-wide format. The official site presents the broadcast alongside an online stream and a large archive, making the station useful both for live listening and for exploring shows after they air. Its home and schedule pages place music, conversation, and specialist programs side by side.\n\nThe station’s program grid is the clearest expression of its editorial approach. Shows have distinct hosts and recurring time slots, but the categories vary widely from one listing to the next, so a listener can move from a familiar program into something less expected. WFMU’s playlist and archive tools preserve that browsing habit: the station is not only a stream to leave running, but also a catalogue of the people and ideas that have passed through it.",
    sources: [
      { label: "WFMU official about page", url: "https://wfmu.org/about", type: "official" },
      { label: "WFMU official schedule", url: "https://wfmu.org/schedule", type: "official" },
      { label: "WFMU official playlists and archive", url: "https://wfmu.org/playlists.php", type: "official" },
    ],
    reviewedAt: "2026-09-15",
  },

  "the-lot-radio": {
    name: "The Lot Radio",
    summary:
      "The Lot Radio is a Red Hook, Brooklyn internet station built around live DJ broadcasts, a daily show schedule, and a physical community space.",
    description:
      "The Lot Radio’s official site presents an internet station rooted in Red Hook, Brooklyn. Its programming is organized around live DJ shows, with the schedule laying out a changing daily lineup rather than a conventional rotation of recorded songs. That makes the station’s identity closely tied to who is behind the decks and what is happening in each broadcast window.\n\nThe website combines the live player with show pages and a public schedule, so listeners can follow a program by host as well as by time. Its support and about pages also describe the project as a community-facing operation with a physical Brooklyn base. The result is a station that works as an always-available stream while retaining the feel of a local room: the most useful way to approach it is to check the lineup, find a host or show, and listen into that set.",
    sources: [
      { label: "The Lot Radio official about page", url: "https://www.thelotradio.com/about", type: "official" },
      { label: "The Lot Radio official schedule", url: "https://www.thelotradio.com/schedule", type: "official" },
      { label: "The Lot Radio official support page", url: "https://www.thelotradio.com/support", type: "official" },
    ],
    reviewedAt: "2026-09-15",
  },

  "worldwide-fm": {
    name: "Worldwide FM",
    summary:
      "Worldwide FM is an independent community station founded by Gilles Peterson, connecting underground music, emerging talent, and local scenes across the world.",
    description:
      "Worldwide FM describes its work as radio, content production, and special projects exploring global creativity through music. The station’s stated focus is underground music, stories, and culture, with particular attention to diverse and emerging talent. Its mission also emphasizes connections between artists, listeners, and music communities, so the schedule is presented as a network of perspectives rather than a single national format.\n\nThe station was founded in 2016 by DJ and broadcaster Gilles Peterson, according to its official about page. Current show listings give that international idea a practical shape: listeners can browse programmes by presenter and time, then move between different musical communities from the same stream. Worldwide FM calls itself independent and describes its organisers as spread across many parts of the world; the profile is best understood as a community-led global radio project with London roots and a deliberately wide editorial remit.",
    sources: [
      { label: "Worldwide FM official about page", url: "https://worldwidefm.net/about", type: "official" },
      { label: "Worldwide FM official schedule", url: "https://worldwidefm.net/schedule", type: "official" },
      { label: "Worldwide FM official shows", url: "https://worldwidefm.net/shows", type: "official" },
    ],
    reviewedAt: "2026-09-15",
  },

  "amazing-radio": {
    name: "Amazing Radio",
    summary:
      "Amazing Radio is an online station built around discovering new music, pairing a live stream with hosted programmes and an artist-focused listening experience.",
    description:
      "Amazing Radio’s current website presents the service as an online music-discovery station. Its live-radio pages put the stream alongside artist and song information, while the dedicated schedule identifies hosted programmes and their broadcast times. The result is a listening path that can begin with a continuous stream and then branch into the artists or shows behind what is playing.\n\nThe station’s editorial identity is concentrated on new music rather than a single established genre. Its website foregrounds discovery and gives listeners several ways to browse: live listening, programme listings, and artist-facing pages. That combination makes Amazing Radio a useful choice when the goal is to encounter unfamiliar releases while still having a schedule to return to. The station’s official pages, rather than a fixed format label, are the strongest guide to its changing mix of shows and songs.",
    sources: [
      { label: "Amazing Radio official about page", url: "https://amazingradio.com/about", type: "official" },
      { label: "Amazing Radio official schedule", url: "https://amazingradio.com/schedule", type: "official" },
      { label: "Amazing Radio official home", url: "https://amazingradio.com/", type: "official" },
    ],
    reviewedAt: "2026-09-15",
  },

  "glacer-fm": {
    name: "Glacer FM",
    summary:
      "Glacer FM is an internet station focused on unsigned and independent artists, with genre channels covering alternative, jazz, electronic, rock, hip-hop, R&B, and world music.",
    description:
      "Glacer FM’s own profile describes an internet station organized around unsigned and independent music. Rather than presenting one narrow format, the service divides listening among genre-oriented channels. The site lists Glacer Mix for a broad range that includes alternative, blues, jazz, classical, dance, house, electronic, and world music; it also describes separate rock, country, and metal programming and an urban channel for hip-hop, R&B, and rhythmic music.\n\nThe station’s Glacer Underground channel gives that discovery mission a dedicated home, with the official page describing opportunities for artists to be heard on the live broadcast. Glacer FM also says that listener requests inform content and programming selections. These are claims about the station’s stated model, not a guarantee about every track in rotation; the practical expectation is a multi-channel internet service where independent submissions, requests, interviews, and genre blocks sit alongside the live stream.",
    sources: [
      { label: "Glacer FM official about page", url: "https://www.glacerfm.com/about-us/", type: "official" },
      { label: "Glacer FM official home", url: "https://www.glacerfm.com/", type: "official" },
      { label: "Glacer Underground official channel", url: "https://www.glacerfm.com/glacer-underground/", type: "official" },
    ],
    reviewedAt: "2026-09-15",
  },
} as const;