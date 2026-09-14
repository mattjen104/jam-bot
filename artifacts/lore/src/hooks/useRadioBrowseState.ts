import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  createRadioBrowseState,
  parseRadioBrowseUrl,
  readRadioBrowseLocality,
  serializeRadioBrowseUrl,
  writeRadioBrowseLocality,
  type CoarseLocality,
  type RadioBrowseState,
} from "../lib/radioBrowseState";

function searchFromLocation(location: string): string {
  const queryIndex = location.indexOf("?");
  return queryIndex >= 0 ? location.slice(queryIndex) : "";
}

/**
 * Shared URL + device-local state bridge for the Radio remote.
 *
 * The URL carries lens/filter/focus/page choices so a browse deck can be
 * reopened or shared. Locality is retained on-device only and is never
 * serialized into browser navigation.
 */
export function useRadioBrowseState(options: { hasTasteEvidence?: boolean } = {}) {
  const [location, setLocation] = useLocation();
  const search = searchFromLocation(location);
  const parseAvailableState = (query: string): Partial<RadioBrowseState> => {
    const parsed = parseRadioBrowseUrl(query);
    return !options.hasTasteEvidence && parsed.lens === "for-you" && !parsed.focusedArtist
      ? { ...parsed, lens: "local" }
      : parsed;
  };
  const [state, setState] = useState<RadioBrowseState>(() => {
    const base = createRadioBrowseState({ locality: readRadioBrowseLocality() });
    const parsed = parseAvailableState(search);
    return { ...base, ...parsed, filters: { ...base.filters, ...parsed.filters } };
  });
  const [lastSearch, setLastSearch] = useState(search);

  useEffect(() => {
    if (search === lastSearch) return;
    const parsed = parseAvailableState(search);
    const base = createRadioBrowseState({ locality: readRadioBrowseLocality() });
    setState({
      ...base,
      ...parsed,
      filters: { ...base.filters, ...parsed.filters },
    });
    setLastSearch(search);
  }, [lastSearch, search]);

  const update = useCallback((next: RadioBrowseState) => {
    setState(next);
    writeRadioBrowseLocality(next.locality);
    const path = location.split("?")[0] || "/";
    const serialized = serializeRadioBrowseUrl(next);
    setLocation(`${path}${serialized}`);
    setLastSearch(serialized);
  }, [location, setLocation]);

  useEffect(() => {
    if (!options.hasTasteEvidence && state.lens === "for-you" && !state.focusedArtist) {
      update({ ...state, lens: "local", page: 1 });
    }
  }, [options.hasTasteEvidence, state, update]);

  const setLocality = useCallback((locality: CoarseLocality | null) => {
    const leavingLocal = !locality && state.lens === "local";
    update({
      ...state,
      locality,
      lens: locality ? "local" : leavingLocal ? "all" : state.lens,
      sort: locality || leavingLocal ? "recommended" : state.sort,
      page: 1,
    });
  }, [state, update]);

  return useMemo(() => ({
    state,
    setState: update,
    setLocality,
    hasTasteEvidence: options.hasTasteEvidence ?? false,
  }), [options.hasTasteEvidence, setLocality, state, update]);
}