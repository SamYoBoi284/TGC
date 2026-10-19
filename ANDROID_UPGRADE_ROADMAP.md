# TGC Android-First Upgrade Roadmap

This is the corrected working roadmap for the native Android app. The separate web/Electron version is out of scope and must remain untouched. Preserve existing functionality and data; do not merge, publish a release, or create a tag without Sam's explicit approval.

## Phase 1 — Repository Audit
Inspect the repository, existing functionality, data model, Firebase usage, and desktop-specific components before making architectural changes.

## Phase 2 — Android Application Strategy
Use the native Android WebView wrapper and bundle the existing app assets without replacing the separate web/Electron application.

## Phase 3 — Private Local Persistence
Keep user data in app-private storage, preserve profile separation, and prevent accidental overwrites.

## Phase 4 — Offline Operation
Keep local creation and editing available offline. Report cloud state honestly and never treat being online as proof that data synced.

## Phase 5 — Guest Mode and Google Sign-In
Support guest/local use and signed-in accounts without mixing their data.

## Phase 6 — Safe Guest-to-Account Migration
Preview migration, preserve the guest source, handle duplicates and ID conflicts, and retain a recoverable safety copy.

## Phase 7 — Voice Input (TESTED BY USER)
- Add an accessible microphone control to the journal editor and Brain Dump.
- Use Android speech-to-text and return the transcript to the active editing field.
- Let the user review and edit the transcript before the normal autosave/persistence path saves it.
- Handle cancellation, unavailable recognition services, empty results, and microphone/recognition failures without changing the draft.
- Do not claim speech recognition works offline unless it is verified on the target device; availability depends on the installed Android recognition service.
- Keep the implementation native-Android-specific. Do not modify the separate web/Electron experience.
- Verify that existing editing, autosave, local storage, Google sign-in, guest mode, and dynamic system insets remain intact.

## Phase 8 — GitHub Actions and APK Builds (BUILD + ARTIFACTS VERIFIED; DEVICE INSTALL CHECK PENDING)
- Build a debug APK first so pull requests can validate Android compilation without access to signing secrets.
- Upload the debug APK as a downloadable GitHub Actions artifact with a defined retention period.
- For trusted push/workflow-dispatch runs, build the signed release APK using repository secrets and verify its signature before uploading it as a separate artifact.
- Never expose signing secrets to pull-request builds; never generate a fallback release signing key when required secrets are missing.
- Validate JavaScript module syntax and fail clearly when required build inputs or artifacts are missing.
- Keep artifacts separate from GitHub Releases. Do not publish releases or create tags without explicit approval.
- Verified on run 39195484461: debug APK and signed release APK both built, release signature verification passed, and both artifacts uploaded. Physical install/update verification remains outstanding.

## Phase 9 — Data Safety and Backup (CI VERIFIED)
- Keep existing local-first storage, profile separation, recovery-copy behavior, and migration/restore safety features intact.
- Add automated regression tests for profile separation before migration; explicit guest-to-account migration; preserving account and guest records; duplicate detection; same-ID conflict preservation; retry idempotency; refusing migration from the guest profile; and refusing to proceed if the pre-migration safety backup cannot be saved. Also test recovery from malformed primary data, refusing writes over unrecoverable data, refusing incomplete backup snapshots, validating full replacements, rollback after a failed multi-collection write, and successful replacement.
- Run these tests in GitHub Actions before building APKs so data-safety regressions fail the pipeline early.
- Keep this phase scoped to tests, CI, and roadmap documentation; do not modify shared runtime JS, UI, or the separate web/Electron behavior without an explicitly agreed reason.
- Verified on workflow run 39197014262: JavaScript syntax validation and the complete data-safety regression test step passed; Android debug and signed release APK build/artifact steps also completed successfully.
- Keep the distinction explicit: account/guest storage is separate before migration; the user-initiated migration merges eligible guest records into the account while retaining the guest source and a pre-migration account backup.

## Phase 10 — UI Edits and UX Enhancements (CURRENT)
Improve the Android app's interface and usability without a wholesale redesign or breaking working behavior.
- Improve screen layouts, navigation clarity, control placement, responsive behavior, and interaction feedback.
- Make interactions and animations feel responsive and coherent, inspired by Sync AI's functional behavior rather than copying its appearance.
- Respect Android status/navigation bars, display cutouts, and keyboard using dynamic insets rather than fixed offsets.
- Keep the Glitchcore Chronicle's calm, premium, personal visual identity.
- Audit each proposed UI change against existing workflows and preserve current features unless a change is explicitly required.
- Keep the separate web/Electron version untouched.
- Implement Android-only visual polish through runtime-injected styles in `MainActivity.java`, preserving the shared HTML/CSS/JS assets.
- Add subtle tactile press feedback, smoother control transitions, clearer keyboard focus, a restrained brand-glyph breathing animation, and a short auth-card entrance animation.
- Respect `prefers-reduced-motion`; keep the existing native system-bar/display-cutout/keyboard inset handling unchanged.
- Verify JavaScript syntax and Android builds in CI; physical-device visual/accessibility review remains necessary before calling the phase fully user-verified.

## Working Rules
- Work on one phase at a time and report results before moving to the next.
- Inspect actual source and CI results before claiming a fix/build succeeded.
- Never casually overwrite or delete user data.
- Never remove working functionality unless it directly conflicts with an explicit requirement or is the targeted fix.
- Do not merge pull requests or publish releases/tags without explicit approval.
- After each phase, report current phase, completed phases, decisions, files changed, verified tests, known issues/risks, and next phase.
