// The browser version's own pages: first-time setup, sign-in and account. Plain HTML forms, no scripts.

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · LocalClaude</title>
<style>
:root{--bg:#faf9f5;--card:#fff;--text:#2b2a27;--muted:#76746d;--accent:#c2603e;--border:rgba(0,0,0,.12);--err:#b3261e}
@media (prefers-color-scheme:dark){:root{--bg:#151515;--card:#1d1d1d;--text:#e8e6df;--muted:#a19f97;--accent:#d97757;--border:rgba(255,255,255,.14);--err:#f28b82}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
main{width:100%;max-width:400px;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px}
h1{font-size:20px;margin:0 0 4px}
p{margin:0 0 16px;color:var(--muted)}
label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
input[type=password],input[type=text]{width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:transparent;color:inherit;font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
.code{letter-spacing:.3em;font-variant-numeric:tabular-nums;font-size:18px}
.check{display:flex;gap:8px;align-items:flex-start;font-weight:400;font-size:14px;margin-top:16px}
.check input{margin-top:4px}
button{width:100%;margin-top:20px;padding:11px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button.secondary{background:transparent;color:var(--text);border:1px solid var(--border)}
.err{color:var(--err);font-size:14px;margin:12px 0 0}
.qr{display:flex;justify-content:center;margin:12px 0;background:#fff;border-radius:12px;padding:8px}
.qr svg{width:200px;height:200px}
.secret{font:13px ui-monospace,monospace;word-break:break-all;background:rgba(128,128,128,.12);padding:8px;border-radius:8px}
.mark{font-weight:700;color:var(--accent);margin-bottom:14px;font-size:14px;letter-spacing:.02em}
table{width:100%;font-size:13px;border-collapse:collapse;margin-top:8px}
td{padding:6px 4px;border-top:1px solid var(--border);vertical-align:top}
a{color:var(--accent)}
</style>
</head>
<body><main><div class="mark">LocalClaude</div>${body}</main></body>
</html>`
}

const err = (e?: string): string => (e ? `<div class="err" role="alert">${esc(e)}</div>` : '')

export function loginPage(error?: string): string {
  return page(
    'Sign in',
    `<h1>Sign in</h1>
<p>Enter your password and the 6-digit code from your authenticator app.</p>
<form method="post" action="/login" autocomplete="on">
<label for="pw">Password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<label for="code">Authenticator code</label>
<input id="code" class="code" name="code" type="text" inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" autocomplete="one-time-code" required>
<label class="check"><input type="checkbox" name="shared" value="1"> This is a shared or public computer (sign out after 30 minutes idle, or when the browser closes)</label>
${err(error)}
<button type="submit">Sign in</button>
</form>`
  )
}

export function setupPage(error?: string): string {
  return page(
    'Set up',
    `<h1>Set up your account</h1>
<p>This LocalClaude has no account yet. Enter the setup code from the server's log, then choose a password.</p>
<form method="post" action="/setup" autocomplete="off">
<label for="sc">Setup code</label>
<input id="sc" name="setupCode" type="text" required autofocus>
<label for="pw">New password (12+ characters)</label>
<input id="pw" name="password" type="password" autocomplete="new-password" minlength="12" required>
<label for="pw2">Repeat password</label>
<input id="pw2" name="password2" type="password" autocomplete="new-password" minlength="12" required>
${err(error)}
<button type="submit">Continue</button>
</form>`
  )
}

export function setupTotpPage(qrSvg: string, secret: string, error?: string): string {
  return page(
    'Set up 2FA',
    `<h1>Add your authenticator</h1>
<p>Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Aegis…), then type the code it shows.</p>
<div class="qr">${qrSvg}</div>
<p>Can't scan? Enter this key:</p>
<div class="secret">${esc(secret.replace(/(.{4})/g, '$1 ').trim())}</div>
<form method="post" action="/setup/totp" autocomplete="off">
<label for="code">Code from the app</label>
<input id="code" class="code" name="code" type="text" inputmode="numeric" pattern="[0-9 ]{6,7}" maxlength="7" autocomplete="one-time-code" required autofocus>
${err(error)}
<button type="submit">Finish setup</button>
</form>`
  )
}

export function accountPage(
  sessions: { id: string; created: number; lastSeen: number; shared: boolean; ip: string; agent: string; current: boolean }[],
  notice?: string,
  error?: string
): string {
  const when = (t: number): string => new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const rows = sessions
    .map(
      (s) =>
        `<tr><td>${esc(s.agent.slice(0, 70) || 'Unknown browser')}${s.current ? ' <b>(this one)</b>' : ''}${s.shared ? ' · shared' : ''}<br><small>${esc(s.ip)}</small></td><td><small>last used<br>${when(s.lastSeen)}</small></td></tr>`
    )
    .join('')
  return page(
    'Account',
    `<h1>Account</h1>
${notice ? `<p>${esc(notice)}</p>` : '<p>Sign-ins to this LocalClaude.</p>'}
<table>${rows}</table>
<form method="post" action="/logout-all"><button type="submit" class="secondary">Sign out everywhere</button></form>
<form method="post" action="/logout"><button type="submit" class="secondary">Sign out</button></form>
<h1 style="margin-top:28px">Change password</h1>
<form method="post" action="/account/password" autocomplete="off">
<label for="cur">Current password</label>
<input id="cur" name="current" type="password" autocomplete="current-password" required>
<label for="np">New password (12+ characters)</label>
<input id="np" name="password" type="password" autocomplete="new-password" minlength="12" required>
<label for="code">Authenticator code</label>
<input id="code" class="code" name="code" type="text" inputmode="numeric" maxlength="7" autocomplete="one-time-code" required>
${err(error)}
<button type="submit">Change password</button>
</form>
<p style="margin-top:20px"><a href="/">Back to LocalClaude</a></p>`
  )
}
