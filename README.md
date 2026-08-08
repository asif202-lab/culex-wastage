# Culex Wastage — all in Netlify

Everything lives in one place now: Netlify hosts the app AND stores the data
(via Netlify Blobs, its built-in key-value storage). No Firebase, no
Supabase, no separate accounts, no environment variables to configure.

## 1. Push this folder to your GitHub

```bash
cd culex-wastage
git init
git add .
git commit -m "Culex Wastage"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/culex-wastage.git
git push -u origin main
```

(Create the empty repo on github.com first, then run the commands above.)

## 2. Deploy on Netlify

1. Go to https://app.netlify.com → **Add new site → Import an existing
   project** → connect GitHub → pick the `culex-wastage` repo.
2. Netlify will auto-detect the build settings from `netlify.toml`
   (build command `npm run build`, publish folder `dist`, functions folder
   `netlify/functions`) — you don't need to type anything in.
3. Click **Deploy site**.
4. In a minute or two you'll get a free live link like
   `culex-wastage.netlify.app`. You can rename it under Site settings →
   Domain management — still free.

That's it — no database setup, no API keys, no `.env` file. The storage
lives inside your Netlify site automatically the first time an outlet or
admin saves something.

## 3. Your two links

- Outlet link: `https://culex-wastage.netlify.app/#outlet`
- Management link: `https://culex-wastage.netlify.app/#management`

## How the storage works

`src/storage.js` calls a small serverless function at `/api/kv`
(`netlify/functions/kv.js`), which reads and writes to a Netlify Blobs store
called `wastage_store`. Netlify provisions that store automatically per
site — there's nothing to create or configure by hand.

## Local testing (optional, before deploying)

Netlify Blobs needs the Netlify CLI to emulate locally (a plain `vite dev`
won't have the `/api/kv` function available):

```bash
npm install -g netlify-cli
npm install
netlify dev
```

This opens the app with the function and blob storage both running locally.
