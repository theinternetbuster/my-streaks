# My Streaks — GitHub Pages website

This version includes a matching dark dashboard and iPhone Home Screen web app settings. All Firebase settings and habit calculations are unchanged from the previous version.

## Update an existing GitHub Pages site

Upload the contents of this ZIP into the root of the existing `my-streaks` repository and **replace the files with the same names**. Do not create a new repository. Make sure `index.html`, `styles.css`, `app.js`, `manifest.webmanifest`, and the PNG icons are in the repository root. Commit the changes. Keep your current Firebase Authentication and Firestore rules; do not reset the database.

## Add to iPhone Home Screen

1. Open https://theinternetbuster.github.io/my-streaks/ in Safari.
2. Tap the Share icon and choose **Add to Home Screen** (sometimes under **More**).
3. If you see **Open as Web App**, turn it on. Tap **Add**.
4. Launch **My Streaks** from the new Home Screen icon.

The app should open as a standalone Home Screen web app without the normal Safari address bar. Sign in using the same Google account. Firebase authentication must be authorized for `theinternetbuster.github.io`.

Note: iOS may treat Safari and a standalone Home Screen app as separate browser sessions, so a fresh sign-in can be needed. Your habits still sync through the same Firestore account. This is an installable website, not an App Store application. It needs internet access to sign in and sync. Clearing browsing data or removing the app does not delete data saved in Firestore.
