# Station Press feed audit

Reviewed 2026-09-16. Acceptance requires a live RSS or Atom endpoint, current
music-editorial entries, public first-party ownership evidence, and an exact
existing Lore station identity. Feed URLs are retained as publication identity;
ownership is never inferred from names or domains.

## Accepted

| Station | Lore slug | Feed | Ownership evidence | Observed content |
| --- | --- | --- | --- | --- |
| KEXP | `kexp` | https://www.omnycontent.com/d/playlist/bad5d079-8dcb-4630-8770-aa090049131d/18f3a48e-1c64-43e8-96e9-aa40002038ee/856f4314-821f-46ca-bc8e-aa40002038f2/podcast.rss | https://www.kexp.org/podcasts/live-on-kexp/ | Healthy; current Live on KEXP artist sessions |
| KALX | `kalx` | https://kalx.berkeley.edu/feed/ | https://kalx.berkeley.edu/about/ | Healthy; current artist interviews |
| KZSU | `kzsu` | https://zookeeper.stanford.edu/zkrss.php?feed=reviews | https://kzsu.stanford.edu/ | Healthy; current album reviews |
| WUOG | `wuog` | https://wuog.org/category/music/feed/ | https://wuog.org/ | Healthy dedicated Music category; reviews, interviews, and local coverage |
| WMFO | `wmfo` | https://www.wmfo.org/feed/ | https://www.wmfo.org/about/ | Healthy but sparse; consistently artist interviews |

WWOZ remains enrolled through its previously reviewed
https://www.wwoz.org/rss.xml feed and ownership record.

## Original candidates skipped

| Candidate | Endpoint checked | Reason |
| --- | --- | --- |
| KUTX | https://kutx.org/feed/ | Mixed show episodes, events, promotions, and fundraising rather than a dedicated editorial feed |
| KCRW | https://www.kcrw.com/music/rss.xml | Returned a 429 challenge during review; no safe current feed validation |
| WXPN | https://xpn.org/feed/ | Endpoint served a 410 Gone document and no current items |
| WFUV | https://wfuv.org/rss.xml | Valid channel metadata but zero items; Music Features exposed no working feed |
| WFMU | https://wfmu.org/playlistfeed.xml | Playlist and show-archive feeds only, which are outside Press |
| KAOS | https://www.kaosradio.org/blog?format=rss | Materially mixed with telethon/fundraising, spin charts, and promotions |
| KDHX | https://kdhx.org/feed | Official site and feed returned 410 Gone |
| WUNC Music | https://www.wunc.org/music.rss | Healthy music-editorial feed, but no exact WUNC Music station exists in Lore; ownership cannot be attached speculatively |

## Additional candidates skipped

| Candidate | Endpoint checked | Reason |
| --- | --- | --- |
| WNXP | https://wnxp.org/feed/ | No exact Lore station identity; feed also mixes playlists and event promotions |
| KUVO | https://www.kuvo.org/feed/ | 404; no working RSS/Atom feed exposed |
| XRAY.fm | https://xray.fm/feed/ | 404; no working RSS/Atom feed exposed |
| Dublab | https://dublab.com/feed/ | HTML application shell, not RSS/Atom |
| The Current | https://www.thecurrent.org/rss | 404; no working RSS/Atom feed verified |
| Jazz24 | https://www.jazz24.org/index.rss | Channel metadata only; zero current items |
| KCSM | https://www.kcsm.org/index.rss | Channel metadata only; zero current items |
| WPRB | https://wprb.com/feed/ | Mixed station operations, schedules, shop, and event posts |
| KVRX, WKCR, WXYC, WHRB, WZBC, WLUW | Conventional first-party feed paths | No working dedicated editorial RSS/Atom endpoint verified |