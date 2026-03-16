import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const cachedArtistsTable = pgTable("cached_artists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  spotifyArtistId: text("spotify_artist_id").notNull(),
  artistName: text("artist_name").notNull(),
  genres: text("genres").notNull(),
  popularity: integer("popularity"),
  imageUrl: text("image_url"),
  source: text("source").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
});

export type CachedArtist = typeof cachedArtistsTable.$inferSelect;
export type InsertCachedArtist = typeof cachedArtistsTable.$inferInsert;
