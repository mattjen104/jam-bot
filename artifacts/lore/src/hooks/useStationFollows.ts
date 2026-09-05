import { useCallback, useSyncExternalStore } from "react";
import {
  followStation,
  readStationFollows,
  stationFollowIdentity,
  subscribeStationFollows,
  toggleStationFollow,
  unfollowStation,
} from "../lib/stationFollows";

export function useStationFollows() {
  const followedSlugs = useSyncExternalStore(subscribeStationFollows, readStationFollows);
  const isFollowing = useCallback((slug: string) =>
    followedSlugs.has(stationFollowIdentity(slug) ?? ""), [followedSlugs]);
  return {
    followedSlugs,
    isFollowing,
    followStation: useCallback((slug: string) => followStation(slug), []),
    unfollowStation: useCallback((slug: string) => unfollowStation(slug), []),
    toggleFollow: useCallback((slug: string) => toggleStationFollow(slug), []),
  };
}