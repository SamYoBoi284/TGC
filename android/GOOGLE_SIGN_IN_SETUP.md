# Android Google sign-in setup

The Android APK uses Android Credential Manager to obtain a Google ID token, then exchanges it through TGC's existing Firebase JavaScript Auth SDK. Electron and normal-browser sign-in remain on their existing popup/redirect path.

## Required configuration

1. In Firebase Console, open the `the-glitchcore-chronicle` project and ensure Google is enabled under Authentication > Sign-in method.
2. In Google Cloud Console / Firebase project credentials, create or identify a **Web application OAuth client ID** for this same project. It normally ends in `.apps.googleusercontent.com`. This is the server client ID requested by Credential Manager; do not use an Android client ID here.
3. Add a GitHub Actions repository secret named `TGC_GOOGLE_WEB_CLIENT_ID` with that Web OAuth client ID:
   - GitHub repository → Settings → Secrets and variables → Actions → New repository secret.
4. Register Android app package `com.sam.tgc` in Firebase project settings and configure its Android OAuth client with the package name and SHA-1 certificate fingerprint used to sign the APK. Use a stable signing certificate for distributable builds; a fresh GitHub runner's generated debug keystore can have a different fingerprint on each run.
5. Confirm Google sign-in is enabled and the OAuth clients belong to the same Google Cloud/Firebase project.

## Build behavior

- The Actions workflow can build without the secret, so APK compilation does not depend on Firebase configuration being complete.
- If the secret is missing, the APK displays a configuration error when Google sign-in is tapped instead of crashing.
- Once configured, the native account picker returns a Google ID token. The existing Firebase Auth SDK exchanges it for a Firebase user/session; the rest of TGC continues to use the same `currentUser` and auth listeners.
- Browser/Electron authentication is not routed through the Android bridge.
- Do not put service-account keys or OAuth client secrets in the app. The Web OAuth client ID is an identifier, not a secret.

## Validation checklist

- [ ] Build the debug APK with GitHub Actions.
- [ ] Install it on a real Android device and test Google account selection.
- [ ] Verify Firebase Authentication creates/signs in the expected user.
- [ ] Force-close and relaunch; confirm the Firebase session restores.
- [ ] Test sign-out and a second sign-in.
- [ ] Re-test Electron sign-in to confirm it remains unchanged.
