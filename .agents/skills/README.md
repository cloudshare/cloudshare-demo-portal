# Portal engineering skills

This repository vendors the 24 portable Matt Pocock engineering skill directories at v1.3.1, upstream commit `49dd158d1076134a641b33efb035946536778336`. `upstream-lock.json` records every upstream file SHA-256 and the MIT licence hash. The portable source was supplied through the local portal adoption note, exported from Salesforce integration revision `d685fb0b3fd18a1d93afe197e3e3d83320d702b9`; Salesforce policy does not apply here.

## Portal configuration

`AGENTS.md` owns portal policy and points to `docs/agents/issue-tracker.md`, `triage-labels.md` and `domain.md`. Existing GitHub issues, `CONTEXT.md`, `docs/decisions/` and the canonical PRD remain authoritative for their subjects. Existing machine installations, adaptations, logs, backups and ignored artifacts remain separate. The allowlist tracks only the 24 skill directories, this guide, manifest and licence; it does not publish local adoption notes or arbitrary `.agents` artifacts.

## Integrity and discovery

Upstream skill files and invocation restrictions are preserved byte-for-byte. `.gitattributes` disables newline conversion for this tree. Verify every `skills[].files` SHA-256 under its skill directory and `licenseSha256` before adopting an update and after Windows and Linux checkout. Keep portal-specific guidance outside upstream skill directories.

A checked-in or manually read skill is portable source, not proof of native discovery. This session's available-skills catalog determines native availability; it may still expose pre-existing local adaptations. Verify the intended version and paths in a fresh task after checkout. Preserve `disable-model-invocation` and invocation-policy metadata; do not edit them to force discovery. Any environment-only provisioning is a separate action and must be recorded and tested in that fresh task. No Windows-global symlinks are required or installed by this adoption.

New descendants inside skill directories remain ignored, while the committed baseline stays tracked. For future upgrades, verify the manifest and explicitly stage only manifest-reviewed upstream files (using `git add -f` for newly added paths), plus the reviewed manifest/licence and portal guide changes. Keep local artifacts out of the update.
