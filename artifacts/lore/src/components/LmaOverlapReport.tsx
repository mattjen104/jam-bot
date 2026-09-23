import { useState } from "react";
import { useMyLmaOverlap, type LmaOverlapArtist } from "../lib/meHooks";

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
  const [requested, setRequested] = useState(false);
  const query = useMyLmaOverlap(requested);
  const report = query.data;
  const matches = report?.artists.filter((a) => a.status === "matched" && a.concerts > 0) ?? [];
  const committed = matches.filter((a) => a.committed);
  const evaluation = matches.filter((a) => !a.committed);
  const uncertain = report?.artists.filter((a) => a.status === "uncertain") ?? [];
  return <div className="lma-report" data-testid="lma-report">
    <h2>Live Music Archive overlap</h2>
    <p>See how many playable concert items in the Internet Archive Live Music Archive match artists in your Library, Inbox and Rotation. No music is imported or changed.</p>
    <button type="button" className="lma-report__button" disabled={query.isFetching}
      onClick={() => { setRequested(true); if (requested) void query.refetch(); }}>
      {query.isFetching ? "Checking the archive…" : report ? "Check again" : "Check my artists"}
    </button>
    {query.isError && <p role="alert">The report couldn't be loaded. Please try again.</p>}
    {report && <>
      <p>Archive checked {new Date(report.checkedAt).toLocaleDateString()} · {report.artistsChecked} of {report.artistsTotal} library artists checked · {report.matchedArtists} matched artists</p>
      <p><strong>{report.concerts} unique playable concert items</strong> from committed Library artists; {report.evaluationConcerts} more from evaluation-only artists.</p>
      {report.partial && <p role="status">Partial estimate: some archive searches failed or reached the page limit, or not all artists were checked. These are not zero matches.</p>}
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