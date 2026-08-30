# Hosting JobTracker on a Windows server (multi-user)

This guide takes JobTracker from a single-user local app to a multi-user
deployment on a Windows machine, with:

- **Google sign-in** and two roles (`admin` / `user`)
- **HTTPS** via Caddy + Let's Encrypt (required for Google sign-in)
- **Remote MCP** at `https://<your-host>/mcp` for the admin's Claude sessions
- **Push-to-main CI/CD** through a hardened self-hosted GitHub Actions runner

```
Internet ── 443/80 ──> Caddy (TLS) ──> Node app on 127.0.0.1:7080 ──> SQLite
                                        ├─ web UI + API (session cookie auth)
                                        ├─ /mcp        (bearer-token auth)
                                        └─ /respond/*  (per-job token links)
GitHub ── push to main ──> self-hosted runner ──> build ──> deploy.ps1 ──> restart service
```

## 1. Prerequisites

- Windows Server / Windows 10+ machine, always on
- Node.js 22+ (`node --version`)
- A domain or subdomain you control (e.g. `jobs.example.com`) with an A/AAAA
  record pointing at your public IP (use a DDNS updater if the IP is dynamic)
- Router forwards **80** and **443** to this machine
- [NSSM](https://nssm.cc) (service wrapper) and [Caddy](https://caddyserver.com/download) binaries

## 2. Directory layout

| Path | Purpose |
|---|---|
| `C:\Apps\JobTracker` | Deployed app (owned by CI — wiped/rewritten on deploy) |
| `C:\JobTrackerData` | SQLite database, uploaded postings, generated documents — **never** touched by deploys |
| `C:\actions-runner` | GitHub Actions runner + the pre-job gate script |
| `C:\caddy` | Caddy binary + Caddyfile |

## 3. Google OAuth client

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a
   project → **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type **Web application**.
3. **Authorized JavaScript origins**: `https://jobs.example.com` (add
   `http://localhost:7080` too if you want to test sign-in locally).
   No redirect URI is needed — the app uses the Google Identity Services
   button, which returns an ID token directly.
4. Configure the OAuth consent screen (External, publish it) and copy the
   **client ID** (`xxxx.apps.googleusercontent.com`). There is no secret to
   store; the client ID is public by design.

## 4. App as a Windows service

Do the first deploy by hand (afterwards CI does it):

```powershell
git clone https://github.com/ianlee74/JobTracker C:\src\JobTracker
cd C:\src\JobTracker
npm ci
npm run build
powershell -ExecutionPolicy Bypass -File scripts\deploy\deploy.ps1   # copies to C:\Apps\JobTracker
```

Install the service with NSSM:

```powershell
nssm install JobTracker "C:\Program Files\nodejs\node.exe" "C:\Apps\JobTracker\server\http-server.js"
nssm set JobTracker AppDirectory C:\Apps\JobTracker
nssm set JobTracker AppStdout C:\JobTrackerData\logs\app.log
nssm set JobTracker AppStderr C:\JobTrackerData\logs\app.log
nssm set JobTracker AppEnvironmentExtra ^
  JOBTRACKER_DATA_DIR=C:\JobTrackerData ^
  JOBTRACKER_BASE_URL=https://jobs.example.com ^
  JOBTRACKER_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com ^
  JOBTRACKER_ADMIN_EMAILS=you@example.com ^
  JOBTRACKER_MCP_TOKEN=<long random string> ^
  ANTHROPIC_API_KEY=<key, if using document generation>
nssm start JobTracker
```

Environment variables:

| Variable | Meaning |
|---|---|
| `JOBTRACKER_DATA_DIR` | Where the SQLite DB and files live (keep outside the app dir) |
| `JOBTRACKER_GOOGLE_CLIENT_ID` | **Enables authentication.** Without it the app runs in the old local single-user mode with no sign-in |
| `JOBTRACKER_ADMIN_EMAILS` | Comma-separated emails that become admins on first Google sign-in (so you're never locked out) |
| `JOBTRACKER_MCP_TOKEN` | Bearer token for `/mcp`. Generate one: `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"`. Unset = remote MCP disabled |
| `JOBTRACKER_BASE_URL` | Public URL used in digest-email feedback links |
| `JOBTRACKER_PORT` / `JOBTRACKER_HOST` | Default `7080` / `127.0.0.1` — keep localhost; Caddy is the public listener |

Copy `data\jobtracker.db` (and `data\postings`, documents) from your PC into
`C:\JobTrackerData` to migrate existing data.

## 5. Caddy (HTTPS)

```powershell
copy scripts\deploy\Caddyfile.example C:\caddy\Caddyfile   # edit the hostname
nssm install Caddy C:\caddy\caddy.exe "run --config C:\caddy\Caddyfile"
nssm start Caddy
```

Browse to `https://jobs.example.com` — you should get the sign-in screen.
Sign in with an email from `JOBTRACKER_ADMIN_EMAILS`, then invite users via
the **👥** button: enter their Google email, role `user`, and link them to the
person whose jobs they should see.

## 6. Roles

| Capability | Admin | User |
|---|---|---|
| View / add jobs | all people | own person only |
| Edit jobs | all fields | `status`, rejection reason, own note |
| Notes | edits admin note, sees user note | edits own note, sees admin note read-only |
| Companies | full edit | view + favorite ★ |
| Documents | generate + view all | generate + view own |
| People, settings, users, file browser, email digest | ✔ | — |
| MCP endpoint | bearer token | — |

## 7. Remote MCP for Claude

On any machine where you use Claude Code:

```bash
claude mcp add jobtracker --transport http https://jobs.example.com/mcp --header "Authorization: Bearer <JOBTRACKER_MCP_TOKEN>"
```

Or in a project's `.mcp.json`:

```json
{
  "mcpServers": {
    "jobtracker": {
      "type": "http",
      "url": "https://jobs.example.com/mcp",
      "headers": { "Authorization": "Bearer <JOBTRACKER_MCP_TOKEN>" }
    }
  }
}
```

The stdio server (`npm run mcp`) still works for local development against a
local database.

## 8. Self-hosted runner (hardened for a public repo)

GitHub discourages self-hosted runners on public repos because fork PRs can
submit arbitrary workflows. Three layers make it safe here; **all three
matter**.

### 8.1 Dedicated low-privilege account

```powershell
$pw = Read-Host -AsSecureString "Password for runner account"
New-LocalUser gh-runner -Password $pw -PasswordNeverExpires
```

Grant `gh-runner` **Modify** on `C:\Apps\JobTracker` and `C:\actions-runner`
only (not on `C:\JobTrackerData`), plus permission to control the JobTracker
service:

```powershell
# Allow start/stop of the service without admin rights (uses subinacl or sc sdset;
# simplest supported route:)
sc.exe sdset JobTracker "D:(A;;RPWPCR;;;S-1-5-21-<gh-runner SID>)(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)"
```

(Get the SID with `(Get-LocalUser gh-runner).SID`.)

### 8.2 Runner install + pre-job gate

Repo → **Settings → Actions → Runners → New self-hosted runner** (Windows),
install into `C:\actions-runner`, and when asked for labels add `jobtracker`.
Run it as a service under the dedicated account:

```powershell
cd C:\actions-runner
.\config.cmd --url https://github.com/ianlee74/JobTracker --token <reg token> --labels jobtracker --runasservice --windowslogonaccount .\gh-runner --windowslogonpassword <pw>
```

Install the gate — **copy it out of the repo** so a PR can't rewrite it:

```powershell
copy C:\src\JobTracker\scripts\runner\pre-job-hook.ps1 C:\actions-runner\pre-job-hook.ps1
Add-Content C:\actions-runner\.env "ACTIONS_RUNNER_HOOK_JOB_STARTED=C:\actions-runner\pre-job-hook.ps1"
Restart-Service actions.runner.*
```

The gate fails any job that is not a `push`/`workflow_dispatch` on
`refs/heads/main` of `ianlee74/JobTracker` by an allowed actor — before any
workflow step (including checkout) runs. Test it: push a trivial commit to a
branch, open a PR, and confirm the CI workflow runs on GitHub-hosted runners
while nothing reaches your machine; merge to main and confirm Deploy runs.

### 8.3 GitHub repository settings

- **Settings → Actions → General**: Fork pull request workflows → **Require
  approval for all outside collaborators**.
- **Settings → Branches**: protect `main` — require a pull request (or at
  least restrict who can push).
- Never approve a fork PR's workflow run without reading its workflow files.

## 9. Deploys after setup

Push (or merge) to `main` → the Deploy workflow builds on the runner and runs
`scripts/deploy/deploy.ps1`, which stops the service, mirrors the workspace to
`C:\Apps\JobTracker` (leaving `data/` and anything in `C:\JobTrackerData`
untouched), installs production dependencies, and starts the service. The
Actions tab shows every deploy. Database migrations run automatically when
the service starts.
