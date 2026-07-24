# Deploy secrets (GitHub Actions)

Production config is injected at deploy time. The Function URL is **not** stored in git.

## GitHub repository secret

**Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|------|--------|
| `ONBOARDING_API_BASE_URL` | Lambda Function URL, no trailing slash |

Required for every deploy build (`main` and `dev`). CI fails if it is missing.

## Local development

1. Copy the template:
   ```powershell
   Copy-Item .env.example .env
   ```
2. Edit `.env` and set your URL:
   ```
   ONBOARDING_API_BASE_URL=https://….lambda-url.us-east-1.on.aws
   ```
3. Run the app — `dotnet build` or `dotnet run` auto-generates `wwwroot/appsettings.json` from `.env` when the file exists.

Or generate manually:
```powershell
.\scripts\generate-appsettings.ps1
```

Both `.env` and `wwwroot/appsettings.json` are gitignored.

## What gets deployed

The workflow writes `wwwroot/appsettings.json` into the publish output before S3 sync. That file is still fetchable in the browser (`/appsettings.json`) — normal for Blazor WASM. Keeping it out of **git** avoids exposing the URL in repo history and forks; it does not hide it from visitors to the live site.

To fully hide the API from browsers you would need a backend proxy (out of scope for this static site).

## Adding more config later

Add variables to `.env.example`, read them in `generate-appsettings.ps1`, and mirror the same keys in the GitHub Actions inject step.

Never commit Lambda admin keys or OpenAI keys in this repo.
