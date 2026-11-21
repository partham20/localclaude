# Self-hosting LocalClaude (browser version)

Server mode runs LocalClaude on a machine you own and serves it to a browser, so you can use it
from any computer (a guest PC, a work laptop, a phone) without signing in to Claude there. Your
Claude sign-in, chats, projects and keys stay on your server.

It is the same app: the main process runs under Electron with no window (`--server`), and the
React UI talks to it over HTTPS instead of IPC. Nearly everything works the same way. See
[What's different from the desktop app](#whats-different-from-the-desktop-app).

```
browser ──HTTPS──▶ Cloudflare ──tunnel──▶ cloudflared ──▶ localclaude (Docker, port 8080, not published)
```

## How it stays private

- **Its own sign-in.** You need a password (12+ characters, stored as a scrypt hash) and a code from an
  authenticator app (TOTP). The page has no "sign up"; the one account is created during
  first-time setup, which needs a setup code printed in the server's log.
- **Lockouts.** After 5 wrong tries from one address, that address waits 15 minutes, and the wait
  doubles after that. After 30 wrong tries from anywhere within an hour, sign-in pauses for everyone
  for up to an hour.
- **Sessions** use `HttpOnly; Secure; SameSite=Strict` cookies and last up to 30 days (7 days idle).
  Ticking **"This is a shared computer"** when you sign in makes the cookie end when the browser
  closes, after 30 idle minutes, or after 12 hours. The account page has **Sign out everywhere**, and
  changing your password signs out every other browser.
- **No open ports.** With the Cloudflare Tunnel, the app isn't reachable on your network or your public IP.
  Only the tunnel can reach it.
- **Locked-down container.** It runs as your user (not root), with all Linux capabilities dropped and
  `no-new-privileges`. Claude can only work in `./workspace` and LocalClaude's own data folder.
- **Encrypted data.** The app's data (chats, keys, your Claude token) and the 2FA secret are encrypted
  with a key derived from `LOCALCLAUDE_SECRET`. That key lives in `.env`, not in the data folder.
- **Artifacts are sandboxed.** Pages Claude makes run with an opaque origin and a CSP `sandbox`, so
  they can't call the app or read your session.

Claude can run commands inside the container. Keep the default permission mode ("ask"), and don't
mount folders into `./workspace` that you wouldn't want Claude to change.

## What you need

- A Linux machine that's always on, with Docker and the Compose plugin (`docker compose version`).
  Either x64 or arm64 works.
- About 2 GB of free RAM and 3 GB of disk (more if you install the DeepSeek Harness).
- A domain on Cloudflare (here: **quarks.stream**, bought through Cloudflare, so its DNS is already there).

## Setup on your Linux machine

### 1. Get the code

```sh
git clone https://github.com/partham20/localclaude.git
cd localclaude
```

### 2. Create the Cloudflare Tunnel

1. Open the [Cloudflare dashboard](https://dash.cloudflare.com), then go to **Zero Trust**, then
   **Networks**, then **Tunnels**. Click **Create a tunnel** and choose **Cloudflared**.
2. Name it `localclaude` and save it.
3. Under **Install and run a connector**, pick **Docker**. Copy the long token from the command it
   shows (the part after `--token`). You don't need to run that command.
4. Under **Public hostnames**, add one:
   - **Subdomain:** `chat` (or leave it empty to use `quarks.stream` itself)
   - **Domain:** `quarks.stream`
   - **Service:** type `HTTP`, URL `localclaude:8080`
5. Save. Cloudflare creates the DNS record and handles HTTPS.

### 3. Fill in `.env`

```sh
cp .env.example .env
openssl rand -base64 32      # paste this as LOCALCLAUDE_SECRET
id -u; id -g                 # paste these as LC_UID and LC_GID
nano .env                    # also paste the tunnel token as CLOUDFLARE_TUNNEL_TOKEN
chmod 600 .env
```

Keep a copy of `LOCALCLAUDE_SECRET` somewhere safe, such as a password manager. Without it, the
data in `./data` can't be opened.

### 4. Start it

```sh
mkdir -p data workspace
docker compose up -d --build
docker compose logs localclaude | grep "setup code"
```

The first build takes a few minutes. The last command prints the one-time **setup code**.
`docker compose ps` should show the app as `healthy`. The log has some `dbus` errors (`Failed to connect to the bus`):
Electron prints them because the container has no desktop, and you can ignore them.

### 5. Create your account

1. Open `https://chat.quarks.stream`.
2. Enter the setup code and choose a password.
3. Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator,
   1Password, Aegis…), then type the 6-digit code to finish.

### 6. Sign in to Claude (once, on the server)

LocalClaude's setup screen appears next. The easiest way for a server is an **auth token**:

1. On any computer with Claude Code, run `claude setup-token` and sign in with your Claude account.
2. Copy the token it prints (it starts with `sk-ant-oat01-`).
3. In LocalClaude, choose **Auth token** and paste it.

A Console API key, DeepSeek or OpenCode work the same way as on the desktop.

### 7. (Optional) A second lock with Cloudflare Access

To make Cloudflare ask for a one-time email code before anyone even reaches the sign-in page:

1. In Zero Trust, go to **Access**, then **Applications**, then **Add an application**, and choose **Self-hosted**.
2. Set **Application domain** to `chat.quarks.stream`.
3. Add a policy: **Allow**, **Include**, **Emails**, and enter your own email.

## Using it from a guest PC

1. Open a private/incognito window and go to `https://chat.quarks.stream`.
2. Sign in with your password and authenticator code, and tick **This is a shared computer**.
3. When you're done, choose **Sign out of this browser** in the account menu (bottom left), or just
   close the private window.

**Sign-ins and password…** in the same menu shows where you're signed in and has **Sign out everywhere**.
**Sign out of Claude** in that menu signs the *server* out of your Claude account, which you usually don't want.

## Day to day

| Task | Command |
| --- | --- |
| Update to the latest version | `git pull && docker compose up -d --build` |
| See the logs | `docker compose logs -f localclaude` |
| Stop / start | `docker compose stop` / `docker compose start` |
| Back up | copy `./data` (and keep `.env` somewhere safe) |
| Forgot your password or lost your phone | `docker compose exec localclaude rm /data/web/account.json /data/web/sessions.json && docker compose restart localclaude`, then set up again with the new setup code from the logs. Your chats and settings are kept. |

Files you add from the browser (attachments, imports) are uploaded to `./data/web/uploads`.
Files the app "saves" are downloaded to your browser.

## What's different from the desktop app

- **File dialogs** become a folder browser for the server's folders (start in `/workspace`). File
  pickers upload from the computer you're on, and saves download to it. Dragging files into a chat
  uploads them.
- **"Open in folder", "Open in VS Code" and Obsidian links** can't open desktop apps. Files are offered
  as downloads instead, and folders show their path on the server.
- **Computer use is off.** There's no screen to control. The **global shortcut** and **desktop
  notifications** aren't available either.
- **Claude subscription sign-in through the browser** opens Claude's page in a new tab. If it can't
  return to the server, use the auth token method above.
- **Remote Control, MCP servers, plugins, skills, projects, artifacts, designs, backups and the other
  engines** work as on the desktop, running on the server.

## Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `LOCALCLAUDE_SECRET` | (required in Docker) | Encrypts the data and 2FA secret. 16+ characters. `LOCALCLAUDE_SECRET_FILE` can point to a file instead. |
| `LOCALCLAUDE_DATA` | `/data` | Where everything is kept. |
| `LOCALCLAUDE_WORKSPACE` | `/workspace` | The folder Claude starts in, and where the folder browser opens. |
| `LOCALCLAUDE_PORT` / `LOCALCLAUDE_HOST` | `8080` / `0.0.0.0` in Docker | Where it listens. Outside Docker the host defaults to `127.0.0.1`. |
| `LOCALCLAUDE_TRUST_PROXY` | `1` in compose | Use Cloudflare's `CF-Connecting-IP` (or `X-Forwarded-For`) as the visitor's address for lockouts. Only set it behind a proxy. |
| `LOCALCLAUDE_SETUP_CODE` | random | Fixes the first-time setup code instead of a random one. |
| `LOCALCLAUDE_INSECURE_COOKIES` | off | Cookies without `Secure`, only for testing over plain HTTP on a LAN (not localhost, which works anyway). |

## Without Docker

On a Linux machine with Electron's libraries installed (the same packages as in the `Dockerfile`):

```sh
npm ci && npm run build
LOCALCLAUDE_SECRET=... npx electron --no-sandbox --ozone-platform=headless --disable-gpu . --server
```

It listens on `http://127.0.0.1:8080`. Put a tunnel or a reverse proxy with HTTPS in front of it. Never
expose it over plain HTTP.
