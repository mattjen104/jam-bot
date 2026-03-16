import { pgTable, serial, integer, text, real, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const cachedTracksTable = pgTable("cached_tracks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  spotifyTrackId: text("spotify_track_id").notNull(),
  trackName: text("track_name").notNull(),
  artistNames: text("artist_names").notNull(),
  artistIds: text("artist_ids").notNull(),
  albumName: text("album_name"),
  albumImageUrl: text("album_image_url"),
  previewUrl: text("preview_url"),
  durationMs: integer("duration_ms"),
  popularity: integer("popularity"),
  source: text("source").notNull(),
  energy: real("energy"),
  danceability: real("danceability"),
  tempo: real("tempo"),
  valence: real("valence"),
  acousticness: real("acousticness"),
  instrumentalness: real("instrumentalness"),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

export type CachedTrack = typeof cachedTracksTable.$inferSelect;
export type InsertCachedTrack = typeof cachedTracksTable.$inferInsert;
