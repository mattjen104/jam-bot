---
name: Completion review vs pre-existing working-tree state
description: Why a scoped task can be rejected for unrelated diffs, and how to resolve it
---

# Completion review sees the whole commit range, not just your edits

The task completion code review evaluates the full diff of the task's commit
range. If earlier sessions left uncommitted changes in the working tree, the
checkpoint system auto-commits them ahead of your task commit — and the review
then attributes those unrelated changes to your task and rejects it.

**Why:** Task #42 (a seed-only URL update) was rejected twice because large
Dial UI removals from a prior session sat in the tree and got auto-committed
into the same range.

**How to apply:**
1. At task start, run `git status` / `git log` and note any pre-existing dirty
   state or unfamiliar recent commits before making your own changes.
2. If rejected for unrelated diffs, don't revert other work blindly — check
   whether those commits are already the mainline tip (`git diff
   main-repl/main..HEAD`). If your branch is mainline + your one scoped
   commit, resubmit with a `drift_reason` explaining the provenance; that
   passes validation.
3. If the unrelated work got swept INTO your own commit (not a separate
   commit), a drift_reason alone is not enough — split it out: `git reset
   --mixed <base>`, commit the foreign files separately with a clear
   provenance message, then commit your scoped work. Shared files (e.g. a
   common stylesheet) can be divided by regenerating the foreign-only version
   (subtract your known insertions) and committing it first. Then resubmit
   with `request_fresh_code_review: true`.
4. Reverting someone else's in-flight work inside your task can conflict with
   other active tasks building on that state.

**Rebase variant — ours/theirs are swapped during `git rebase`:**
when the completion flow rebases your task branch onto main and stops on
conflicts, `git checkout --ours` selects MAIN's version and `--theirs` selects
YOUR replayed commit's version (opposite of merge intuition). If your commit
bundled stale in-flight copies of other tasks' files, the correct resolution
for those files is main's version.
**Why:** a Scan-lens task kept its own stale bundled copies of two
remote-button components via `--theirs`, silently reverting a merged mainline
feature; the mismatch surfaced only as an unrelated-looking test failure.
**How to apply:** after the rebase completes, audit `git diff <main-tip> HEAD
--stat` and restore every file outside your task's scope to the main-tip
version (`git checkout <main-tip> -- <path>`), not just the files that
conflicted textually — clean merges can still carry stale copies.
