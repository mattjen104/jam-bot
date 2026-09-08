---
name: Schedule freshness grace
description: Defines when operator health should warn about aging public station calendars.
---

Calendar health becomes stale only after the normal weekly refresh cadence plus one complete failed-attempt retry interval. Classify network, extraction, and persistence failures as transient; policy blocks, unavailable sources, missing links, and malformed feeds as unavailable.

**Why:** Public calendars are fetched through a deliberately paced provider queue. Flagging them at the instant they become refresh-eligible creates false alarms, while collapsing every durable reason into one failure state hides whether retrying can help.

**How to apply:** Keep the health threshold derived from scraper cadence constants, preserve the last successful scrape independently from the latest failure, and display null failure evidence honestly as awaiting refresh.