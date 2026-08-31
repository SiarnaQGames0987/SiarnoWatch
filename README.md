# SiarnoWatch

**Mini social media.**

A static GitHub Pages MVP built with plain HTML, CSS and JavaScript.

## What works

- Home feed
- User profiles
- Individual post pages
- Browser-local likes
- Browser-local "Follow" state
- New posts stored in `localStorage`
- Responsive desktop/mobile layout
- Static JSON data in `/data`

## Important MVP limitation

GitHub Pages is static. This version does **not** write user posts back to GitHub and does not include real accounts/authentication. New posts and likes live only in the current browser.

Do not put GitHub tokens or private keys in frontend JavaScript.

## Run locally

Because the app loads JSON with `fetch()`, serve the folder over HTTP instead of double-clicking `index.html`.

Python example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Deploy to GitHub Pages

1. Create a repository, e.g. `SiarnoWatch`.
2. Upload all files in this folder to the repository root.
3. In GitHub: **Settings → Pages**.
4. Choose **Deploy from a branch**.
5. Select the default branch and `/ (root)`.

## Next build ideas

- Search
- Replies
- Real accounts
- Moderation/reporting
- Backend API for posting
- Rate limits and anti-spam
- Media uploads

---

SiarnoWatch MVP · 2026
