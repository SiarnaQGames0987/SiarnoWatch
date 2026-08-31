# SiarnoWatch v0.2

**Mini social media — now with a real shared backend.**

This build keeps GitHub Pages as the frontend and uses Supabase for accounts and shared data.

## What works

- Real email/password sign up and login
- Unique `@username`
- Shared public feed (everyone sees the same posts)
- 280-character posts
- Shared likes
- Real profiles
- Shared follow/unfollow
- Profile editing (display name, bio, avatar letters)
- Search posts from the current feed
- Individual post links
- Responsive desktop/mobile layout
- Old localStorage/demo posts are ignored and cleared

## 1. Create the database

1. Create a free Supabase project.
2. Open **SQL Editor**.
3. Paste the entire contents of `supabase/schema.sql` and run it once.

## 2. Connect the website

Open `js/config.js` and replace the two placeholders:

```js
window.SW_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_KEY"
};
```

Use the project URL and the public anon/publishable key from your Supabase project settings.

**Do not put a service-role key in this file.** The frontend only needs the public key. Row Level Security in `schema.sql` protects writes.

## 3. GitHub Pages

Upload/replace the files in the root of your `SiarnoWatch` repository. GitHub Pages will deploy the new commit automatically.

If email confirmation is enabled in Supabase Auth, a new account must confirm its email before logging in. Add your GitHub Pages URL as the Supabase Auth Site URL when you are ready.

## Demo data

`data/posts.json` and `data/users.json` are intentionally empty. v0.2 does not use demo JSON as the database.

## Next Mini build

- Replies/comments
- Notifications
- Delete-own-post menu
- Better search
- Reports/moderation queue
- Rate limiting / anti-spam
- Images

---

SiarnoWatch v0.2 · 2026
