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

## Render backend

Create a Render Web Service from this repository, or use `render.yaml`.

Required environment variables:

- `DATA_FILE=/var/data/second-brain.json`
- `SECOND_BRAIN_PASSWORD=<your-password>`
- `ALLOWED_ORIGINS=https://epap28.github.io,http://localhost:3000`
- `AI_ENABLED=false`

Mount a persistent disk at `/var/data` so the brain data survives deploys and restarts.

## Data privacy

`data/second-brain.json` is ignored for future commits, but if it was already committed to GitHub, remove it from the repository history or at least untrack it before pushing new private data.
