---
name: Drizzle CTE correlated subquery in GROUP BY
description: EXISTS subquery referencing outer GROUP BY columns fails in Postgres; use LEFT JOIN + bool_or instead.
---

# Drizzle CTE — EXISTS inside GROUP BY outer query

## Rule
Never use a correlated `EXISTS (SELECT 1 FROM cte WHERE cte.key = outer.col)` inside a SELECT that has GROUP BY. Postgres throws error **42803 "subquery uses ungrouped column 'outer.col' from outer query"** even when `lower(trim(outer.col))` is the GROUP BY key — referencing the raw column `outer.col` inside the subquery is still an aggregation violation.

**Why:** PostgreSQL's aggregation checker sees `outer.col` inside the subquery as a non-grouped reference from the outer scope, regardless of any function wrapping in the GROUP BY clause.

**How to apply:** Replace `(EXISTS (SELECT 1 FROM cte WHERE cte.key = lower(trim(r.col))))` with:
1. `LEFT JOIN cte ON cte.key = lower(trim(r.col))` in the FROM clause
2. `bool_or(cte.key IS NOT NULL) AS popular` in the SELECT list

`bool_or` is an aggregate function, so it's valid in a GROUP BY SELECT. Since `cte.key` is determined by the GROUP BY key (`lower(trim(r.col))`), all rows in a group have the same value — `bool_or` returns the right answer.

## Stale server warning
tsx does NOT hot-reload on file changes. When multiple `WorkflowsRestart` calls happen in quick succession, old tsx processes can linger on port 8080 alongside the new one. **Kill all node processes with `kill -9 <pids>` before trusting a response** if edits aren't being reflected. Verify with `lsof -i :8080` or check the response body for strings that should have been removed.
