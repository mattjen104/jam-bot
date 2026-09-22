import sys

with open('artifacts/lore/src/pages/Library.tsx', 'r') as f:
    content = f.read()

start_marker = "function ArtistFocusControl({"
end_marker = "}\n\n// ---------------------------------------------------------------------------"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker, start_idx) + 1

if start_idx == -1 or end_idx == 0:
    print("Could not find markers")
    sys.exit(1)

new_func = """function ArtistFocusControl({
  allArtists,
  visibleSeeds,
  focusedArtist,
  onFocus,
  onClear,
  onAddSeed,
  onRemoveSeed,
}: {
  allArtists: string[];
  visibleSeeds: string[];
  focusedArtist: string | null;
  onFocus: (artist: string, artistMbid?: string | null) => void;
  onClear: () => void;
  onAddSeed: (artist: string) => void;
  onRemoveSeed: (artist: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const isSeed = focusedArtist ? visibleSeeds.some(s => s.toLocaleLowerCase() === focusedArtist.toLocaleLowerCase()) : false;
  const isAddedArtist = focusedArtist
    ? allArtists.some(a => a.toLocaleLowerCase() === focusedArtist.toLocaleLowerCase())
    : false;
  const isLibraryArtist = isAddedArtist && !isSeed;

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const debouncedSearch = useDebouncedValue(search.trim(), 150);
  const suggestionsEnabled = open && debouncedSearch.length >= 2;
  const artistSuggestions = useSuggestArchiveArtists(
    { q: debouncedSearch },
    {
      query: {
        queryKey: getSuggestArchiveArtistsQueryKey({ q: debouncedSearch }),
        enabled: suggestionsEnabled,
        staleTime: 5 * 60_000,
      },
    },
  );
  
  const matches = useMemo(() => {
    if (!normalizedSearch) return allArtists.slice(0, 50);
    return allArtists.filter(a => a.toLocaleLowerCase().includes(normalizedSearch)).slice(0, 50);
  }, [allArtists, normalizedSearch]);
  
  const suggestedArtistMbids = useMemo(() => {
    const result = new Map<string, string | null>();
    for (const suggestion of artistSuggestions.data?.suggestions ?? []) {
      const key = suggestion.name.toLocaleLowerCase();
      if (!result.has(key) || suggestion.artistMbid) {
        result.set(key, suggestion.artistMbid);
      }
    }
    return result;
  }, [artistSuggestions.data]);

  const selectStyle: React.CSSProperties = {
    appearance: "none",
    background: "hsl(var(--secondary) / .55)",
    border: 0,
    borderRadius: 999,
    padding: "4px 24px 4px 10px",
    fontFamily: "var(--app-font-mono)",
    fontSize: 11,
    color: "hsl(var(--foreground))",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 28,
    position: "relative",
    whiteSpace: "nowrap",
  };

  const outsideCanonical = artistSuggestions.data?.suggestions[0]?.name || search.trim();
  const showFooter = normalizedSearch.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="demo-merged-library__artist-control"
          style={selectStyle}
          aria-label="Crossings for"
          aria-pressed={Boolean(focusedArtist)}
        >
          {focusedArtist ? (
            <span style={{ color: "hsl(var(--foreground))" }}>Crossings for: {focusedArtist}</span>
          ) : (
            <span>Crossings for: All my artists</span>
          )}
          <ChevronDown style={{ width: 12, height: 12, opacity: 0.5 }} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-80" align="start" style={{ borderRadius: 8, overflow: "hidden", border: 0, background: "hsl(var(--card))", boxShadow: "0 10px 24px -5px hsl(var(--background)/0.5)" }}>
        {focusedArtist ? (
          <div style={{ padding: "12px 14px", borderBottom: "1px solid hsl(var(--border)/0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <strong style={{ fontFamily: "var(--app-font-display)", fontSize: 15 }}>{focusedArtist}</strong>
              <button
                onClick={() => { onClear(); setOpen(false); }}
                style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--faint))", background: "none", border: "none", cursor: "pointer" }}
              >
                Clear focus
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                aria-pressed={isAddedArtist}
                disabled={isLibraryArtist}
                title={isLibraryArtist ? "Already in your Library" : undefined}
                onClick={() => {
                  if (isSeed) onRemoveSeed(focusedArtist);
                  else if (!isAddedArtist) onAddSeed(focusedArtist);
                }}
                className="library-artist-lens__seed-toggle"
              >
                <span aria-hidden="true">{isAddedArtist ? "✓" : "+"}</span>
                {isAddedArtist ? "Added to my artists" : "Add to my artists"}
              </button>
            </div>
          </div>
        ) : null}
        <Command shouldFilter={false} style={{ background: "transparent" }}>
          <CommandInput
            placeholder="Narrow my artists..."
            value={search}
            onValueChange={setSearch}
            onKeyDown={(event) => {
              if (event.key === "Enter" && normalizedSearch) {
                event.preventDefault();
                if (matches[0]) {
                  onFocus(matches[0], suggestedArtistMbids.get(matches[0].toLocaleLowerCase()));
                  setSearch("");
                } else if (outsideCanonical) {
                  onFocus(outsideCanonical, suggestedArtistMbids.get(outsideCanonical.toLocaleLowerCase()));
                  setSearch("");
                }
              }
            }}
            style={{ fontSize: 13 }}
          />
          <CommandList style={{ maxHeight: 240, overflowY: "auto" }}>
            {matches.length === 0 && !showFooter && (
              <div style={{ padding: "16px", textAlign: "center", fontFamily: "var(--app-font-sans)", fontSize: 13, color: "hsl(var(--faint))" }}>
                No artists found in your library.
              </div>
            )}
            {matches.map(a => (
              <CommandItem
                key={a}
                value={a}
                onSelect={() => {
                  onFocus(a, suggestedArtistMbids.get(a.toLocaleLowerCase()));
                  setSearch("");
                }}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "var(--app-font-sans)", fontSize: 13 }}
              >
                <span>{a}</span>
              </CommandItem>
            ))}
          </CommandList>
          {showFooter && (
            <div style={{ padding: "8px", borderTop: "1px solid hsl(var(--border)/0.5)", background: "hsl(var(--muted)/0.3)", display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "hsl(var(--faint))", padding: "0 8px", textTransform: "uppercase" }}>Outside your library</div>
              <button
                type="button"
                style={{ padding: "8px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--app-font-sans)", fontSize: 13, color: "hsl(var(--foreground))", borderRadius: 4 }}
                onClick={() => {
                  onFocus(outsideCanonical, suggestedArtistMbids.get(outsideCanonical.toLocaleLowerCase()));
                  setSearch("");
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = "hsl(var(--muted))")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span>Try '{outsideCanonical}'</span>
                <span style={{ fontSize: 16 }}>›</span>
              </button>
              <button
                type="button"
                style={{ padding: "8px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "transparent", border: "none", cursor: "pointer", fontFamily: "var(--app-font-sans)", fontSize: 13, color: "hsl(var(--primary))", borderRadius: 4 }}
                onClick={() => {
                  onAddSeed(outsideCanonical);
                  onFocus(outsideCanonical, suggestedArtistMbids.get(outsideCanonical.toLocaleLowerCase()));
                  setSearch("");
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = "hsl(var(--muted))")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span>Add '{outsideCanonical}' to library</span>
                <span style={{ fontSize: 16 }}>+</span>
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}"""

with open('artifacts/lore/src/pages/Library.tsx', 'w') as f:
    f.write(content[:start_idx] + new_func + content[end_idx-1:])

print("Replaced ArtistFocusControl successfully")
