import sys

with open('artifacts/lore/src/lib/meHooks.ts', 'r') as f:
    content = f.read()

marker = "export async function postStartManualImport("
if marker not in content:
    print("Could not find marker")
    sys.exit(1)

idx = content.find(marker)
end_idx = content.find("}", idx) + 1

new_func = """
/** Import track links copied from Spotify Desktop without account authorization. */
export async function postStartSpotifyUrlImport(
  urls: string[],
): Promise<{ jobId: number; status: string; accepted: number }> {
  return apiFetch<{ jobId: number; status: string; accepted: number }>(
    "/api/me/library/import/spotify-urls",
    { method: "POST", body: JSON.stringify({ urls }), headers: { "Content-Type": "application/json" } },
  );
}
"""

with open('artifacts/lore/src/lib/meHooks.ts', 'w') as f:
    f.write(content[:end_idx] + new_func + content[end_idx:])

print("Added postStartSpotifyUrlImport")
