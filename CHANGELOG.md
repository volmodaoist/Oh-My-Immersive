# Changelog

## Unreleased

- Replace the remote ink modal with a hover and click popover, explicit service controls and a masked address with a visibility toggle.
- Add `make release` and `make release-dry-run` to synchronize versions, validate changes and publish through GitHub Actions.
- Apply Obsidian lint rules to plugin source and standard Node.js checks to CLI, build and test scripts, with zero warnings required across the repository.
- Document GitHub automation, checked commits, release commands and recovery procedures in `.github/README.md`.
- Refactor remote ink with shared enums, named protocol payloads, expanded control flow and documented module responsibilities; enforce consistent formatting.
- Document repository readiness, code provenance requirements, release preparation and the current Obsidian Community directory submission process in `docs/ob-sop.md`.

## 1.0.0

First release under the Oh-My-Immersive name, based on Immersive Folder 0.6.0.

- Hide unrelated file explorer entries when presenting or recording, and restore the prior folder expansion state afterward.
- Reorder files of any type and folders within their own sibling groups, with directory reset and folder context menu actions.
- Draw over the current window from a browser on the same local network using Apple Pencil pressure or mouse input.
- Stream pen samples during drawing, ignore palm touches, and suppress native long-press selection and callouts.
- Keep background frames visible while replacements decode, avoiding blank frames between updates.
- Keep ink temporary in memory, with synchronized clear controls in note headers and the browser.
- Install from source with `make install vault="/path/to/vault"` before Community directory availability.

The host requires desktop Obsidian 1.15.1 or newer. An iPad can connect through its browser.
