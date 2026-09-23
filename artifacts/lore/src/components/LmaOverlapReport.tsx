import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMyLmaOverlap, startMyLmaOverlap, ME_LMA_OVERLAP_KEY, type LmaOverlapArtist } from "../lib/meHooks";

function ArtistList({ title, artists }: { title: string; artists: LmaOverlapArtist[] }) {
  return <section>
    <h3>{title} · {artists.length} artists</h3>
    {artists.length === 0 ? <p>No matches in the checked portion.</p> : (
      <ol>
        {artists.map((artist) => <li key={artist.artistMbid ?? artist.name}>
          <a href={artist.url} target="_blank" rel="noopener noreferrer">{artist.name} ↗</a>
          {" · "}{artist.concerts} playable {artist.concerts === 1 ? "concert" : "concerts"}
          {artist.truncated ? " · partial search" : ""}
        </li>)}
      </ol>
    )}
  </section>;
}

export function LmaOverlapReport() {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const query = useMyLmaOverlap();
  const scan = query.data;
  const report = scan?.report;
  const running = scan?.state === "running";
  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const next = await startMyLmaOverlap();
      queryClient.setQueryData(ME_LMA_OVERLAP_KEY, next);
    } catch {
      setStartError("The archive check could not start. Please try again.");
    } finally {
      setStarting(false);
    }
  };
  const matches = report?.artists.filter((a) => a.status === "matched" && a.concerts > 0) ?? [];
  const committed = matches.filter((a) => a.committed);
  const evaluation = matches.filter((a) => !a.committed);
  const uncertain = report?.artists.filter((a) => a.status === "uncertain") ?? [];
  return <div className="lma-report" data-testid="lma-report">
    <h2>Live Music Archive overlap</h2>
    <p>Check every active artist in your Library, Inbox and Rotation against playable concerts in the Live Music Archive. No music is imported or changed.</p>
    <button type="button" className="lma-report__button" disabled={starting || running}
      onClick={() => { void start(); }}>
      {starting ? "Starting…" : running ? "Checking the archive…" : report ? "Check again" : "Check my whole library"}
    </button>
    {running && <p role="status">Checked {report?.artistsChecked ?? 0} of {report?.artistsTotal ?? "your"} artists. You can leave this page and come back while the check runs.</p>}
    {(query.isError || scan?.state === "error" || startError) && <p role="alert">{startError ?? "The archive check stopped. Please try again."}</p>}
    {report && <>
      <p>Archive checked {new Date(report.checkedAt).toLocaleDateString()} · {report.artistsChecked} of {report.artistsTotal} library artists checked · {report.matchedArtists} matched artists</p>
      <p><strong>{report.concerts} unique playable concert items</strong> from committed Library artists; {report.evaluationConcerts} more from evaluation-only artists.</p>
      {report.partial && !running && <p role="status">Partial estimate: some archive searches failed or reached the page limit. These are not zero matches.</p>}
      <ArtistList title="Library tracks & Shelf" artists={committed} />
      <ArtistList title="Inbox, Rotation & unresolved imports only" artists={evaluation} />
      {uncertain.length > 0 && <section><h3>Uncertain name matches</h3><p>These results could refer to another artist with the same name; they are excluded from the estimate.</p>
        <ul>{uncertain.map((a) => <li key={a.name}><a href={a.url} target="_blank" rel="noopener noreferrer">{a.name} ↗</a></li>)}</ul>
      </section>}
      {report.artists.some((a) => a.status === "unavailable") && <p>Archive results unavailable for {report.artists.filter((a) => a.status === "unavailable").length} artists.</p>}
      <p>Concert counts estimate potential interest, not whether you will enjoy each performance or a complete count of all archive audio. Counts use distinct archive item IDs with indexed playable formats; searches are bounded and Archive metadata can be incomplete. Names alone do not prove that the performer is the same person as the artist in your Library.</p>
    </>}
  </div>;
}