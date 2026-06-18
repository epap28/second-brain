# second-brain
Application that permits user to store everything that he knows, an LLM reviews the data to suggest improvements

## Local development

```powershell
node src/index.js
```

Then open http://localhost:3000.

PowerShell may block `npm run dev` because of script execution policy. In that case, use:

```powershell
npm.cmd run dev
```

## GitHub Pages frontend

GitHub Pages should be configured with:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/docs`

The public frontend URL is:

```text
https://epap28.github.io/second-brain/
```

`docs/config.js` points the frontend to the hosted API.

## Free Cloudflare backend

The public frontend is hosted by GitHub Pages. The API runs on a Cloudflare Worker, and the app data is stored in Cloudflare D1.

Install Wrangler:

```powershell
npm.cmd install --save-dev wrangler
```

Log in to Cloudflare:

```powershell
npx.cmd wrangler login
```

Create the free D1 database:

```powershell
npx.cmd wrangler d1 create second-brain-db
```

Copy the returned `database_id` into `wrangler.toml`, replacing `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID`.

Create the schema:

```powershell
npm.cmd run d1:schema
```

Add the first-admin setup token as a Cloudflare secret:

```powershell
npx.cmd wrangler secret put SETUP_TOKEN
```

If `SETUP_TOKEN` is not configured, the Worker can still use the old `SECOND_BRAIN_PASSWORD` secret as the setup token.

Invite request emails use `mailto:` links. Requests are stored in D1, then the app shows a link that opens a prefilled email to the admin.

Deploy the Worker:

```powershell
npm.cmd run worker:deploy
```

Cloudflare will print a URL like:

```text
https://second-brain-api.<your-subdomain>.workers.dev
```

Copy that URL into `docs/config.js`, then commit and push.

## Authentication flow

Create the first admin account once the Worker is deployed:

```powershell
$body = @{
  email = "your-email@example.com"
  password = "your-admin-password"
  setupToken = "your-setup-token"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "https://second-brain-api.<your-subdomain>.workers.dev/api/auth/setup" `
  -ContentType "application/json" `
  -Body $body
```

Then sign in from the GitHub Pages app with that email and password.

To create invitation codes:

1. Sign in as the admin user.
2. Open the `Invite requests` panel on the home screen.
3. Click `Envoyer le code` on a pending request.
4. The code is copied and the app shows a link to open a prefilled email to the requester.
5. Click `Send` in your email app.

Users create their account from the `Premiere connexion` section with the invitation code and a new password.

## Git deploy

```powershell
git add .
git commit -m "Add user authentication"
git push origin main
```


## Data privacy

`data/second-brain.json` is ignored for future commits, but if it was already committed to GitHub, remove it from the repository history or at least untrack it before pushing new private data.
