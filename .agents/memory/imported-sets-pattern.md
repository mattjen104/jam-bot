---
name: Imported portable sets (XSPF/JSPF)
description: Design rules for listener playlist uploads — isolation, claimed-MBID trust, parser hardening.
---

- Imported sets are user-owned and structurally isolated: `resolved_mbid` is a bare text column (no FK) and no code path writes spins or radio analytics. Any future feature bridging imports to radio surfaces must keep this one-way.
- **Claimed MBID trust rule:** a recording MBID claimed by an uploaded file is only honored when the recording already exists locally; unknown claims fall through to ISRC/text resolution via `resolveToMbid`. **Why:** trusting file-claimed MBIDs would let a user-editable file plant/overwrite spine `recordings` rows via `upsertRecording`.
- XML hardening: fast-xml-parser with `processEntities:false` plus an outright regex rejection of `<!DOCTYPE`/`<!ENTITY` before parsing; 1 MB / 500-track limits enforced before full parse.
- Provenance (citation/source/picker/spin_id meta) in uploaded files is never read — the parser manifest vocabulary simply has no slot for it; a test asserts the manifest keys.
- `/me/imported-sets` routes ride `requireUserMiddleware` mounted by meRouter at `/me` (routes/index.ts order), so read `req.loreUser` — a fresh device's cookie isn't on the request yet when the middleware just provisioned it.
- Upload is raw file text in a JSON body (no multipart infra exists); `app.ts` gives the POST path a 2 MB express.json limit and the route re-checks the 1 MB file limit.
