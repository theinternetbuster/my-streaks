# My Streaks — GitHub Pages + Firebase

A personal habit tracker with Google sign-in, synced history, and a Babbel-style dark streak detail screen with orange completed days, blue freeze days, and **two freezes per Monday–Sunday week per habit**. The design is a close recreation, not an official Babbel screen.

## Publish

1. Create a **public** GitHub repository (for example, `my-streaks`).
2. Upload `index.html`, `styles.css`, and `app.js` **to the repository root**, not inside a folder.
3. Open **Settings → Pages** on GitHub. Choose **Deploy from a branch**, branch **main**, folder **/(root)**. Save.
4. After deployment, your address will resemble `https://YOUR-USERNAME.github.io/my-streaks/`.
5. In Firebase Console open **Authentication → Settings → Authorized domains**. Add **YOUR-USERNAME.github.io** (domain only, without `https://` or `/my-streaks/`).
6. Open your GitHub Pages address and sign in with Google.

Your data is stored in Cloud Firestore under `/users/{your-account-uid}/habits/{habit-id}`; your Firestore rules must restrict access to the authenticated user matching that uid.

**Never paste service-account credentials, secret keys, or authentication tokens into the GitHub repository.** The Firebase web configuration included in `app.js` is a public client identifier, not a service-account secret.

## How streaks work

- Only completed calendar dates increase the streak number (multiple check-ins on one day count once).
- The first completion activates the habit; missed days before it don't consume freezes.
- When the streak is active, each uncompleted past day consumes one of the week's two freezes; frozen days appear blue.
- The third missed day *in the same week* breaks the streak. Inactive missed days do not use additional freezes.
- On Monday, the budget of two replenishes whether the streak is active or not. Unused freezes never carry forward.
- A new streak can begin after a break, but restarting doesn't replenish freezes already spent that week.
- An unchecked **current** day is not marked missed before midnight.
- The count and freeze history are recomputed from saved completed dates, not stored as mutable counters.

## Notes

- This is a static website; Firebase provides sign-in and live syncing, so no hosting server is needed.
- In the account menu you can **export a JSON backup**. Backup import adds records as new habits; it does not overwrite existing habits.
- The calendar lets you browse months. Use **Edit check-in history** to correct a missed/incorrect check-in date.
- Your old Notion history is not automatically imported; only records created or imported into this new website appear here.
- Firebase requires an internet connection to authenticate and sync. Hosting and database usage are subject to their respective service limits.

## Visual design

Open any habit card to see the dark full-screen streak detail. The typography, calendar, orange completed tiles, outlined blue flame freeze tiles, and blue information panel closely follow the supplied Babbel reference. The extra **Done today** control remains below the calendar for the custom tracker.
