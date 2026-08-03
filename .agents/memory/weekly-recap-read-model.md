---
    name: Weekly recap read model
    description: Durable rules for Lore's counts-only weekly listener reflection.
    ---

    Weekly recaps use an explicit UTC Sunday 00:00 through following Sunday 00:00 exclusive window. The default always selects the latest completed window; current and future windows are invalid, even on Sunday before a week has completed.

    **Why:** Station-local timezones and partial-week recaps make an attendance reflection unstable and misleading. The recap must remain deterministic when the listener returns after Sunday.

    **How to apply:** Source attendance only from rows marked `rollup_counted=true`, not heartbeat/session data. Canonical replay candidates must resolve to the full station/show/day partition anchor. Empty categories remain visible and honest, with no gamification or listening-progress language.
    