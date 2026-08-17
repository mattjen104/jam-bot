/**
 * useAddedStations — React binding for the listener's personal station list
 * (see lib/addedStations.ts). All mounted instances share the same
 * module-level store, so the Station Finder sheet and the dial data pipeline
 * always agree.
 */
import { useCallback, useSyncExternalStore } from "react";
import {
  addAddedStation,
  readAddedStations,
  removeAddedStation,
  subscribeAddedStations,
  type AddedStation,
} from "../lib/addedStations";

export function useAddedStations(): {
  addedStations: AddedStation[];
  addStation: (station: AddedStation) => void;
  removeStation: (uuid: string) => void;
  isAdded: (uuid: string) => boolean;
} {
  const addedStations = useSyncExternalStore(subscribeAddedStations, readAddedStations);

  const addStation = useCallback((station: AddedStation) => {
    addAddedStation(station);
  }, []);

  const removeStation = useCallback((uuid: string) => {
    removeAddedStation(uuid);
  }, []);

  const isAdded = useCallback(
    (uuid: string) => addedStations.some((s) => s.radioBrowserUuid === uuid),
    [addedStations],
  );

  return { addedStations, addStation, removeStation, isAdded };
}
