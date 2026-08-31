# SiarnoWatch v0.3 — Firebase Edition

Static frontend for GitHub Pages + Firebase Authentication + Cloud Firestore.

## Before using the site

1. Firebase Console → Firestore Database → **Rules**.
2. Replace the rules with `firebase/firestore.rules` from this package.
3. Click **Publish**.
4. Authentication → Sign-in method → Email/Password must be enabled.
5. Upload this package to the GitHub Pages repository root.

## Included

- Email/password sign up and login
- Unique usernames (letters, numbers, `_` and `-`)
- Public shared feed
- Real-time posts
- Likes
- Follow/unfollow
- Profiles and profile editing
- GitHub Pages-compatible Firebase CDN setup

The Firebase web config in `js/config.js` is intentionally public. Security is enforced by Firestore Rules.
