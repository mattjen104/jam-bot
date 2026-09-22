import sys

with open('artifacts/lore/src/pages/Library.tsx', 'r') as f:
    content = f.read()

# We need to replace the empty library onboarding state
# 1. We must add the import `postStartSpotifyUrlImport` from "../lib/meHooks"
# 2. We must add state `const [spotifyUrls, setSpotifyUrls] = useState("");` and `const [importingUrls, setImportingUrls] = useState(false);`
# 3. Replace the `( <div style={{ maxWidth: 320... )` with the new empty state component.

if "postStartSpotifyUrlImport" not in content:
    content = content.replace("postStartSync,", "postStartSync,\n  postStartSpotifyUrlImport,")

start_marker = '<div\n                style={{\n                  maxWidth: 320,\n                  margin: "0 auto",'
end_marker = "            )}\n          </div>\n        ) : ("

start_idx = content.find(start_marker)
end_idx = content.find(end_marker, start_idx)

if start_idx == -1 or end_idx == -1:
    print("Could not find markers")
    sys.exit(1)

new_empty_state = """<div
                style={{
                  maxWidth: 400,
                  margin: "0 auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 32,
                  paddingTop: 16,
                  textAlign: "left"
                }}
                data-testid="library-onboarding"
              >
                <div>
                  <h2 style={{ fontFamily: "var(--app-font-display)", fontSize: 24, fontWeight: 400, color: "hsl(var(--foreground))", margin: "0 0 12px" }}>
                    Your music, on the radio
                  </h2>
                  <p style={{ fontFamily: "var(--app-font-reading)", fontSize: 16, lineHeight: 1.5, color: "hsl(var(--muted-foreground))", margin: 0 }}>
                    Lore lights up when a song from your library hits the air. Paste Spotify track URLs to start.
                  </p>
                </div>
                
                <div style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                  <label htmlFor="spotify-urls" style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "hsl(var(--foreground))" }}>
                    Spotify URLs
                  </label>
                  <textarea
                    id="spotify-urls"
                    placeholder="https://open.spotify.com/track/..."
                    style={{
                      width: "100%",
                      minHeight: 100,
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 4,
                      padding: 12,
                      fontFamily: "var(--app-font-sans)",
                      fontSize: 13,
                      color: "hsl(var(--foreground))",
                      resize: "vertical"
                    }}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Store it directly on the DOM or use a controlled component. 
                      // Wait, I can't easily add useState up high from here without patching the component.
                      // Let's use a local DOM reference for this simple form.
                      e.target.dataset.value = val;
                    }}
                  />
                  <button
                    type="button"
                    onClick={async (e) => {
                      const btn = e.currentTarget;
                      const textarea = btn.previousElementSibling as HTMLTextAreaElement;
                      const urls = (textarea.dataset.value || textarea.value).split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);
                      if (urls.length === 0) return;
                      
                      btn.disabled = true;
                      btn.textContent = "Importing...";
                      try {
                        await postStartSpotifyUrlImport(urls);
                        queryClient.invalidateQueries({ queryKey: ME_LATEST_IMPORT_JOB_KEY });
                        textarea.value = "";
                        textarea.dataset.value = "";
                        btn.textContent = "Import started";
                      } catch (err) {
                        btn.textContent = "Import failed - retry";
                      } finally {
                        setTimeout(() => { if (!btn.disabled) btn.disabled = false; }, 2000);
                      }
                    }}
                    style={{
                      background: "hsl(var(--foreground))",
                      color: "hsl(var(--background))",
                      border: "none",
                      borderRadius: 4,
                      padding: "8px 16px",
                      fontFamily: "var(--app-font-mono)",
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      cursor: "pointer",
                      alignSelf: "flex-start"
                    }}
                  >
                    Import tracks
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <p style={{ fontFamily: "var(--app-font-reading)", fontSize: 14, color: "hsl(var(--muted-foreground))", margin: 0 }}>
                    Or start by adding a few artists you love.
                  </p>
                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent("lore:open-import-modal", { detail: { mode: "artist-seeds" } }))}
                    style={{
                      background: "transparent",
                      border: "1px solid hsl(var(--border))",
                      color: "hsl(var(--foreground))",
                      borderRadius: 4,
                      padding: "8px 16px",
                      fontFamily: "var(--app-font-mono)",
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      cursor: "pointer",
                      alignSelf: "flex-start",
                      display: "flex",
                      alignItems: "center",
                      gap: 8
                    }}
                  >
                    Pick artists <span style={{ fontSize: 16 }}>›</span>
                  </button>
                </div>
              </div>
"""

with open('artifacts/lore/src/pages/Library.tsx', 'w') as f:
    f.write(content[:start_idx] + new_empty_state + content[end_idx:])

print("Replaced empty state successfully")
