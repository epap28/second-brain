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
npm install --save-dev wrangler
```

Log in to Cloudflare:

```powershell
npx wrangler login
```

Create the free D1 database:

```powershell
npx wrangler d1 create second-brain-db
```

Copy the returned `database_id` into `wrangler.toml`, replacing `REPLACE_WITH_CLOUDFLARE_D1_DATABASE_ID`.

Create the schema:

```powershell
npm run d1:schema
```

Add the API password as a Cloudflare secret:

```powershell
npx wrangler secret put SECOND_BRAIN_PASSWORD
```

To receive invite request emails, edit `wrangler.toml`:

```toml
INVITE_REQUEST_TO_EMAIL = "your-email@example.com"
```

Then add a Resend API key as a Cloudflare secret:

```powershell
npx wrangler secret put EMAIL_API_KEY
```

If `EMAIL_API_KEY` is not configured, invite requests are still stored in D1 and visible in the admin panel.

Deploy the Worker:

```powershell
npm run worker:deploy
```

Cloudflare will print a URL like:

```text
https://second-brain-api.<your-subdomain>.workers.dev
```

Copy that URL into `docs/config.js`, then commit and push.

## Data privacy

`data/second-brain.json` is ignored for future commits, but if it was already committed to GitHub, remove it from the repository history or at least untrack it before pushing new private data.
