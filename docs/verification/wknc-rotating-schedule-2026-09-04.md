# WKNC rotating schedule browser verification

Verified in the development environment on 2026-09-04 with the API Server and
Lore Radio workflows running.

## Fresh provider receipt and stored rows

WKNC station record:

- Slug: `wknc`
- Schedule source: `https://spinitron.com/WKNC/calendar`
- Latest successful scrape: `2026-09-04T04:11:09.944Z`
- Stored recurring rows: `0`
- Stored dated rows: `168`

The listener API returned HTTP 200 from:

```text
GET /api/stations/wknc/upcoming-schedule
```

The response contained `shows: []` and 168 `datedExceptions`. Every dated row
carried the official calendar URL as `sourceUrl`.

## Real-browser verification

At `/lore/archive/stations/wknc`, selecting **Schedule** rendered the
**Date-specific schedule** treatment. The browser showed all 168 API rows as
separate dated entries rather than selecting a recurring weekly-grid winner.
Each entry included:

- calendar date
- start and end time
- host name when supplied by Spinitron
- an **Official schedule** link to the WKNC Spinitron calendar

Concrete rows compared in the browser against the official Spinitron week view:

| Date | Program | Time | Host | Spinitron event |
| --- | --- | --- | --- | --- |
| 2026-08-31 | Sunset | 00:00–01:00 | DJ Zetta | `https://spinitron.com/WKNC/pl/22947616/Sunset` |
| 2026-09-01 | Underground | 00:00–01:00 | not supplied | `https://spinitron.com/WKNC/pl/22949521/Underground` |

The title, date, time, and host/no-host values matched between the listener API,
the rendered Lore rows, and Spinitron. Spinitron visually extends overnight
blocks in its grid; Lore honestly preserves each hourly event returned by the
provider feed.

## Conflict-free control

At `/lore/archive/stations/kcsb`, selecting **Schedule** rendered the ordinary
Time × Mon–Sun weekly grid. Its API response contained 139 recurring `shows`
and zero `datedExceptions`; no date-specific section appeared.

## Result

Pass. WKNC's overlapping official events reach listeners as exact-date
alternatives without collapsing conflicts, and recurring-only stations retain
the ordinary weekly grid.