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

## Phase 7 — Voice Input (CURRENT)
- Add an accessible microphone control to the journal editor and Brain Dump.
- Use Android speech-to-text and return the transcript to the active editing field.
- Let the user review and edit the transcript before the normal autosave/persistence path saves it.
- Handle cancellation, unavailable recognition services, empty results, and microphone/recognition failures without changing the draft.
- Do not claim speech recognition works offline unless it is verified on the target device; availability depends on the installed Android recognition service.
- Keep the implementation native-Android-specific. Do not modify the separate web/Electron experience.
- Verify that existing editing, autosave, local storage, Google sign-in, guest mode, and dynamic system insets remain intact.

## Phase 8 — GitHub Actions and APK Builds
Build installable Android APK artifacts through GitHub Actions, report failures accurately, and keep release publication separate from artifact builds. Never create releases or tags without explicit approval.

## Phase 9 — Data Safety and Backup
Preserve existing records across upgrades, validate imports, preview restores, protect against duplicates/conflicts, and keep recovery paths available. This phase also retains the additional guest-migration and backup/restore safety work that was mistakenly numbered as a separate Phase 7; those features are valuable and must not be removed.

## Phase 10 — UI Edits and UX Enhancements
Improve the Android app's interface and usability without a wholesale redesign or breaking working behavior.
- Improve screen layouts, navigation clarity, control placement, responsive behavior, and interaction feedback.
- Make interactions and animations feel responsive and coherent, inspired by Sync AI's functional behavior rather than copying its appearance.
- Respect Android status/navigation bars, display cutouts, and keyboard using dynamic insets rather than fixed offsets.
- Keep the Glitchcore Chronicle's calm, premium, personal visual identity.
- Audit each proposed UI change against existing workflows and preserve current features unless a change is explicitly required.
- Keep the separate web/Electron version untouched.

## Working Rules
- Work on one phase at a time and report results before moving to the next.
- Inspect actual source and CI results before claiming a fix/build succeeded.
- Never casually overwrite or delete user data.
- Never remove working functionality unless it directly conflicts with an explicit requirement or is the targeted fix.
- Do not merge pull requests or publish releases/tags without explicit approval.
- After each phase, report current phase, completed phases, decisions, files changed, verified tests, known issues/risks, and next phase.
