---
name: attendance_rollups FK blocks recordings cleanup
description: DB tests deleting seeded recordings must clear attendance_rollups first
---
Rule: any `*-db.test.ts` that seeds recordings AND attendance (or anything a rollup pass can touch) must delete `attendance_rollups` rows for its test users before deleting `recordings`.

**Why:** `attendance_rollups.recording_mbid` FKs `recordings.mbid` with no cascade; rollup writes can come from the recap read path or a concurrent rollup test's global pass, so the referencing rows exist even when the file never inserted them directly. weekly-recap-db.test.ts once failed the merge gate with FK 23503 exactly this way.

**How to apply:** in `afterAll`, `db.delete(attendanceRollupsTable).where(inArray(userId, testUserIds))` before the recordings delete. Note a failed afterAll leaves orphan seed rows behind (unique per-run ids keep them harmless).
