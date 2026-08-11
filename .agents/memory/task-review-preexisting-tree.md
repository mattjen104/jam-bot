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
3. Reverting someone else's in-flight work inside your task can conflict with
   other active tasks building on that state.
