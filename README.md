# Culex Wastage — all on GitHub

Hosting: **GitHub Pages** (free, unlimited, no credit system, no account
other than GitHub). Data storage: **Firebase** (free tier, separate from
GitHub so hosting and data never depend on each other).

Every time you push a change to the `main` branch, GitHub automatically
rebuilds and redeploys the site by itself (see `.github/workflows/deploy.yml`).
You never manually build or upload anything again after this first setup.

## 1. Create a free Firebase project (for data storage)

1. Go to https://console.firebase.google.com → **Add project** → name it
   (e.g. `culex-wastage`) → skip Analytics → **Create project**.
2. Click the **</> (Web)** icon to add a web app → give it any nickname →
   **Register app**. Firebase shows a config object — keep this open.
3. Left sidebar → **Build → Firestore Database → Create database** → any
   region → start in **test mode**.
4. Go to the **Rules** tab of Firestore, replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /wastage_store/{docId} {
      allow read, write: if true;
    }
  }
}
```

   Click **Publish**.

## 2. Push this project to GitHub

```bash
cd culex-wastage
git init
git add .
git commit -m "Culex Wastage"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/culex-wastage.git
git push -u origin main
```

(Create the empty `culex-wastage` repo on github.com first.)

## 3. Add your Firebase config as GitHub Secrets

GitHub builds the site for you, so the Firebase values need to live as
**repository secrets**, not a local `.env` file.

1. On your repo → **Settings → Secrets and variables → Actions → New
   repository secret**.
2. Add these six, one at a time, using the values from step 1.2:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

## 4. Turn on GitHub Pages

1. Repo → **Settings → Pages**.
2. Under "Build and deployment" → **Source**, choose **GitHub Actions**.

That's it — no build command to type. The workflow file already in this
project handles the rest.

## 5. Trigger the first deploy

Go to the **Actions** tab on your repo → you should see "Deploy to GitHub
Pages" already running (it kicked off automatically after step 2's push).
If it didn't, click it → **Run workflow**.

Wait for the green checkmark (1–2 minutes). Your site is now live at:

```
https://YOUR-USERNAME.github.io/culex-wastage/
```

## 6. Your two links

- Outlet link: `https://YOUR-USERNAME.github.io/culex-wastage/#outlet`
- Management link: `https://YOUR-USERNAME.github.io/culex-wastage/#management`

Because this is a real website (not an embedded preview), the `#outlet` and
`#management` links work exactly as designed — each shows only its own
screen, nothing else.

## Making changes later

Edit a file, then:

```bash
git add .
git commit -m "describe the change"
git push
```

GitHub rebuilds and redeploys automatically. Your Firestore data is
completely separate from the code and is never touched by a redeploy —
this is the setup that avoids the reset problem from before.

## Local testing (optional)

```bash
cp .env.example .env   # fill in your Firebase values
npm install
npm run dev
```

Opens at `http://localhost:5173`.
