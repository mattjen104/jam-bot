/**
 * GET /api/me/picker-names — server-side picker-name lookup for the listener's
 * dial. Returns the display names of non-DJ pickers who have curated at least
 * one track that is also in the listener's library, plus a `hasLibrary` flag
 * so the client does not need to download the full MBID list just to know
 * whether the library is non-empty.
 *
 * Replaces the client-side pattern of:
 *   (1) fetching all MBIDs via GET /api/me/library/mbids,
 *   (2) slicing the first 60 and sending two batches to GET /picks/contains.
 *
 * The join runs entirely server-side: library_items → picks → pickers.
 * Results are suitable for caching at 5 minutes (same window as picks/contains).
 */
import { Router, type IRouter } from "express";
import {
  db,
  libraryItemsTable,
  picksTable,
  pickersTable,
} from "@workspace/db";
import { eq, and, ne, isNotNull, inArray } from "drizzle-orm";
import { h } from "../../middlewares/asyncHandler.js";
import { pickerNotOptedOut } from "../lore/shared.js";
import { type AuthedRequest } from "./auth.js";

const router: IRouter = Router();

/**
 * GET /api/me/picker-names
 *
 * Response shape:
 *   {
 *     names: string[];       // display names of matching non-DJ pickers
 *     hasLibrary: boolean;   // true when the listener has ≥ 1 resolved MBID
 *   }
 *
 * Returns `{ names: [], hasLibrary: false }` when the user has no session or
 * no resolved library items so callers never need to branch on auth state.
 */
router.get("/me/picker-names", h(async (req, res) => {
  const user = (req as AuthedRequest).loreUser;
  if (!user) {
    return res.json({ names: [], hasLibrary: false });
  }

  // Check whether the library has any resolved rows at all. A single-row
  // query is cheap and gives us the hasLibrary flag without fetching everything.
  const firstRow = await db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(and(eq(libraryItemsTable.userId, user.id), isNotNull(libraryItemsTable.mbid)))
    .limit(1);

  if (firstRow.length === 0) {
    return res.json({ names: [], hasLibrary: false });
  }

  // Subquery: all resolved MBIDs in the user's library.
  // inArray() accepts a subquery — Postgres plans a hash semi-join instead of
  // receiving a literal array over the wire, which scales well as libraries grow.
  const userLibSubq = db
    .select({ mbid: libraryItemsTable.mbid })
    .from(libraryItemsTable)
    .where(and(eq(libraryItemsTable.userId, user.id), isNotNull(libraryItemsTable.mbid)));

  // Join picks → pickers, keeping only non-DJ, active, not-opted-out pickers
  // whose picks overlap the user's library.
  const rows = await db
    .selectDistinct({ name: pickersTable.name })
    .from(picksTable)
    .innerJoin(pickersTable, eq(picksTable.pickerId, pickersTable.id))
    .where(
      and(
        eq(pickersTable.active, true),
        ne(pickersTable.pickerType, "dj"),
        isNotNull(picksTable.mbid),
        inArray(picksTable.mbid, userLibSubq),
        pickerNotOptedOut(pickersTable.id),
      ),
    );

  return res.json({
    names: rows.map((r) => r.name),
    hasLibrary: true,
  });
}));

export default router;
