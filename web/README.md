# Checkpoint web

A tiny static site: the Privacy Policy, Terms of Use, Support page, and the landing pages behind shared links. Plain HTML, one CSS file, no build step, no framework, nothing to install.

| URL | File | What it is |
|---|---|---|
| `/` | `index.html` | Home. Also receives invite links (`/?ref=…`). |
| `/privacy` | `privacy.html` | **Draft** privacy policy |
| `/terms` | `terms.html` | **Draft** terms of use |
| `/support` | `support.html` | Contact, delete account, report content |
| `/r/{id}` `/l/{id}` `/q/{id}` `/u/{username}` | `r/`, `l/`, `q/`, `u/` | Share landing pages: review, list, question, profile |

The landing pages fetch and show **no user content**. They show the app icon, **Join the beta** (TestFlight) until an App Store ID is set, an **Open in Checkpoint** button (`checkpoint://r/{id}` etc.), and **Get the app** once an App Store ID is set. The only text they display is the optional `?t=` title the app put in the link.

## 1. Fill in the values (one file)

Edit **`site-config.js`**:

```js
window.CHECKPOINT_SITE = {
  SUPPORT_EMAIL: '',   // e.g. 'support@yourdomain.com'
  APP_STORE_ID: '',    // digits only, once the app exists in App Store Connect
  TESTFLIGHT_URL: '',  // e.g. 'https://testflight.apple.com/join/AbCdEf12'
}
```

- `SUPPORT_EMAIL` fills the contact address on `/privacy`, `/terms` and `/support`. Until it is set those pages show a "not set yet" note.
- `APP_STORE_ID` turns on the **Get the app** button. Until it is set the button is hidden.
- `TESTFLIGHT_URL` turns on **Join the beta** on the home and share landing pages when `APP_STORE_ID` is still empty. Use your public TestFlight join link (`https://testflight.apple.com/join/…`). Once an App Store ID is set, the beta button is hidden and **Get the app** takes over.

## 2. Read and adjust the two Draft pages

`privacy.html` and `terms.html` are marked **Draft — review before publishing**. They were written from what the app actually stores, but they are not legal advice. Read both, change anything that is not what you want to promise (minimum age, what is kept after account deletion, the crash-report paragraph), then **delete the draft banner line** (`<p class="draft-banner">…</p>`) from each.

## 3. Preview locally

```bash
cd web
python3 -m http.server 8080
```

Open <http://localhost:8080>. The landing pages read the id from the path, which a plain static server cannot rewrite, so preview them with a query instead, e.g. `http://localhost:8080/q/index.html?id=abc123&t=How%20do%20I%20beat%20the%20boss`. On the deployed site the same page is served at `/q/abc123`.

## 4. Deploy for free — Vercel

1. Push this repo to GitHub (already done if you use it).
2. Go to <https://vercel.com/new> and import the repo.
3. **Root Directory:** click *Edit* and choose **`web`**.
4. **Framework Preset:** *Other*. Leave Build Command and Output Directory empty.
5. Click **Deploy**. `vercel.json` here already turns on clean URLs (`/privacy`) and the `/r/{id}` style rewrites.

### Attach your domain (Vercel)

1. Project → **Settings → Domains → Add**, type your domain (for example `playcheckpoint.app`).
2. Vercel shows the DNS records to add. At your registrar either point the domain's nameservers to Vercel, or add the `A` record (apex) and `CNAME` (`www`) it lists.
3. Wait for the green check (usually minutes). HTTPS is automatic.

## 4 (alternative). Deploy for free — Netlify

1. <https://app.netlify.com/start> → *Import from Git* and pick the repo.
2. **Base directory:** `web`. **Build command:** leave empty. **Publish directory:** `web`.
3. Deploy. `_redirects` and `_headers` here provide the `/r/{id}` rewrites and the JSON header for the association file. Netlify serves `/privacy` for `privacy.html` automatically.

### Attach your domain (Netlify)

1. **Site configuration → Domain management → Add a domain**.
2. Follow the DNS instructions it shows (nameservers, or an `A` record plus a `CNAME` for `www`). HTTPS is automatic.

## 5. Point the app at it

In the repo root `.env` (see `.env.example`):

```
VITE_SITE_URL=https://yourdomain.com
VITE_SUPPORT_EMAIL=support@yourdomain.com
```

Rebuild (`npm run build && npx cap sync ios`). No trailing slash on `VITE_SITE_URL`. Until it is set, the app shares text without a link and hides the Privacy and Terms rows.

## 6. Deep links (`checkpoint://`) — works today

`checkpoint://r/{id}`, `l/{id}`, `q/{id}` and `u/{username}` already open the right screen in the iOS app (the `checkpoint` scheme is registered in `ios/App/App/Info.plist`). Test on a device by typing `checkpoint://q/<a real question id>` into Safari.

## 7. Universal links (https links that open the app directly) — NOT enabled yet

`/.well-known/apple-app-site-association` is prepared but has a placeholder. Two values are needed before it does anything:

1. **Apple Team ID** — developer.apple.com → Account → Membership details (10 characters, like `A1B2C3D4E5`). In the association file, replace `TEAM_ID_HERE` so the line reads `"appIDs": ["A1B2C3D4E5.com.ryan.Checkpoint"]`. The bundle id `com.ryan.Checkpoint` is already correct.
2. **Your domain** — the one you attached above. It is used in the app's Associated Domains entitlement as `applinks:yourdomain.com`.

The association file must be reachable at exactly `https://yourdomain.com/.well-known/apple-app-site-association`, with no redirect, served as `application/json` (the config files here do that). Check it in a browser after deploying.

The **Associated Domains entitlement has not been added to the iOS project** and that is deliberate: add it in Xcode (Signing & Capabilities → + Capability → Associated Domains → `applinks:yourdomain.com`) only once both values above are real. Until then, links opened from Messages or Safari land on the web page, and the **Open in Checkpoint** button opens the app.
