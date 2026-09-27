---
name: JamBot remote checkout ownership
description: An external Linux deployment issue involving a symlinked checkout and root-owned generated files.
---

**Rule:** When repairing ownership of the remote JamBot checkout, resolve the checkout symlink and operate on its actual mounted-volume directory. Do not expect recursive `chown` on the symlink pathname to descend into the target. Keep installs and builds under the service user, not root.

**Why:** A reported production build failed to unlink root-owned files in the bot's generated output despite a recursive `chown` on the symlink name. The resolved volume is a writable ext4 mount; path inspection showed the output directory was still root-owned.

**How to apply:** Confirm the resolved target before any broad ownership change and scope it to the dedicated checkout. If the workspace lockfile is stale against package manifests, install without `--frozen-lockfile` and commit the regenerated lockfile in the source checkout for future reproducible deployments.