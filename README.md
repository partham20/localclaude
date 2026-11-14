# LocalClaude

[![CI](https://github.com/partham20/localclaude/actions/workflows/ci.yml/badge.svg)](https://github.com/partham20/localclaude/actions/workflows/ci.yml)

A personal desktop app for Claude on **Windows and Linux**, powered by **Claude Code** through the official Claude Agent SDK, running on **your Claude subscription** (Pro / Max), a subscription token, or a Console API key if you'd rather pay as you go.

Everything runs and is stored **on this machine only**. Chats, settings and MCP config are encrypted with a key bound to this computer's machine ID, so copying the data folder to another PC won't open it, and nothing syncs to claude.ai.

## What it can do

| Feature | Notes |
|---|---|
| Chat with streaming replies | Markdown, tables, code with copy button, collapsible thinking |
| Message actions | Copy a message or reply, edit a message and send it again, retry the last reply (you choose whether to undo file changes first) |
| Search | The sidebar search covers chat titles and the text inside messages; **Ctrl+F** finds words in the open chat. Claude can also look up and read your earlier chats when you mention them |
| Images | Images you attach show as thumbnails in the chat, and so do screenshots tools return (computer use, image files Claude reads). Click for full size, copy or save; editing or retrying a message sends its images again |
| Claude Code-style transcript | `● Update(file)` tool rows with `⎿` summaries, numbered diffs for every edit, Normal/Verbose view (Ctrl+O), animated working status |
| Checkpoints & rewind | Hover a message → Rewind (or Esc Esc): restore the code, the conversation, or both to before that message |
| Artifacts | Claude makes web pages, React apps, SVG, Mermaid diagrams, documents and code in a side panel with Preview/Code, version history, copy, download and open in your browser. When a preview hits an error, **Fix with Claude** sends it to Claude. The Artifacts page lists every artifact from every chat. Stored encrypted with the chat; previews run in a sandboxed frame (React/Mermaid load their libraries from public CDNs) |
| Design | Like Claude Design: on the Design page, pick a prototype, slide deck, wireframe, one-pager or anything else, describe it (add screenshots for reference), and Claude designs it on a board beside the chat. Every screen, slide or board is a frame, in rows by section; drag a box to select frames (Shift+click adds, Ctrl+A selects all), pan with the wheel, Space+drag or the hand tool, zoom with Ctrl+wheel or a pinch. A frame builds up live while Claude writes it; for three or more, Claude writes a design system first and then all the screens at the same time, one subagent each. Open a frame to use it (at its own size, or desktop, tablet and mobile), step through them or **Present**, and switch between versions. Turn on **Comment** and click any part of a frame to tell Claude what to change there. Export a frame as PNG (at 2×), PDF or HTML, or every frame as one PDF (a deck, a page per slide). **Match a codebase's style** has Claude read a folder's colors, fonts and components first; **Build it in code** starts a chat in your project's folder that builds the design there. A design leaves out your MCP servers, Chrome and computer use, so it starts quickly |
| Projects | Group chats with shared instructions, knowledge, memory and a working folder. Knowledge files can be PDFs, Word, PowerPoint and Excel files, notes, code or data; when there's too much to send with every message Claude searches it instead. Link a folder (like part of your Obsidian vault) and it stays in sync. The project page shows how much of Claude's context it uses and lists every artifact from its chats |
| Obsidian | Link your vault (found automatically) and it becomes LocalClaude's knowledge store: Claude searches and reads your notes in any chat, saves notes when you ask, and your chats (with images) and memory are kept as notes. One switch in Settings → Obsidian turns it all off without unlinking |
| Files changed | A side panel lists every file Claude edited in the chat with its diffs, open it (or in VS Code), and undo the changes |
| Tasks, git and worktrees | Claude's task list shows above the reply box while it works. The header shows the folder's git branch and uncommitted changes; a new chat can work in its own git worktree on a new branch |
| Memory | Claude remembers useful facts across chats, per project or globally, and you can view, edit or delete them (project page, Settings → Memory & data). Encrypted like everything else |
| Pinning & sidebar | Drag the sidebar's edge to resize it. Chats are grouped by folder and project like Claude Code (with "+" to start a chat there), or by date; groups collapse. Pin chats and projects; chats with artifacts show a file icon. Select several chats (Ctrl/Shift+click) to pin, move, export or delete them, or drag chats onto a project |
| Export & import | Export a chat as Markdown, or selected chats / a project / everything as a ZIP of Markdown chats, images, artifacts, knowledge files, instructions, memory and a context summary. Import an export back, here or on another computer (Ctrl+Shift+E to export) |
| Backups | Password-protected backups of everything, by hand or automatically every day or week to a folder you choose (keeping the latest few). They open on any computer with your password |
| Computer use | Optional: Claude sees your screen and uses the mouse and keyboard, like computer use in the Claude app (see below) |
| Remote Control | Keep working from your phone: the phone button in the top bar (or typing `/remote-control`) starts Claude Code's Remote Control for the chat's folder. Use it from the Code tab of the Claude mobile app or claude.ai/code; LocalClaude shows the link and a QR code, and asks Claude Code's questions (turning it on, trusting the folder) in the app |
| Context meter | Ring in the composer shows how full the context window is, with a per-category breakdown |
| Full Claude Code toolset | Read/edit/create files, run shell commands, search the web, fetch pages, subagents, to-do lists |
| Permission prompts | Allow once / Always allow / Deny with a note, like the Claude app |
| 4 permission modes | Ask permissions · Auto-accept edits · Plan mode (approve the plan card) · Full access |
| Claude's questions | AskUserQuestion shows as clickable option cards |
| Working folders | Pick a folder per chat, add extra folders anytime |
| Attachments | Images (paste, drag-drop, 📎) go to Claude; other files are attached as `@path` mentions |
| Slash commands & skills | Type `/` for your commands and skills (from `~/.claude` and the project's `.claude/`) |
| Browser | Toggle "Use my Chrome browser" (Claude in Chrome extension), or add the Playwright MCP preset |
| MCP panel | Click "MCP n/m" in the status line for live server status, on/off switches and reconnect |
| MCP servers | Add, edit, test and switch off servers in Settings → Tools (or edit them as JSON); your `~/.claude.json` servers load too |
| Chat history | Searchable sidebar, rename, delete, resume any chat later |
| Model & effort | Opus / Sonnet / Haiku (or whatever your plan lists), effort level |
| Usage | Status line shows your plan's 5-hour window usage and reset time; Settings → Usage shows every limit (labelled as subscription usage while chats bill a Console key) |
| Response styles | Concise, Explanatory, Formal and more, per chat or as the default, plus your own |
| Notifications & titles | A notification when Claude finishes or needs you while the app is in the background; new chats get a short AI-written title |
| Quick access | A global shortcut (Ctrl+Alt+Space by default) brings LocalClaude forward with a new chat; the window remembers its size and place; right-click menus for copy, paste, spelling and links |
| Personal instructions | Settings → General: what Claude should call you (also shown in the sidebar), and instructions added to every chat |
| First-run setup | A setup screen with three ways to sign in: your Claude subscription in the browser, a token from `claude setup-token`, or a Console API key. Then pick a theme and accent. Tokens and keys are stored encrypted and locked to your OS account by the system keychain |
| Make it yours | **Settings → Appearance:** light/dark/system, 9 themes, any accent, every single color, interface/reply/code fonts (or any installed font), zoom, reply size, chat width, density, corners, frosted glass, glow, animations, message style and your own CSS; copy your look to another computer. **Settings → Keyboard:** rebind every shortcut. See [MODS.md](MODS.md) |
| Command palette | **Ctrl+K**: every action, settings page, theme and chat in one search, plus commands mods add |
| Mods | Folders of CSS, themes and scripts in your mods folder, switched on in **Settings → Mods**. Scripts can add commands, shortcuts, sidebar buttons and status items, react to chats, and change settings. The example mod shows how; [MODS.md](MODS.md) is the guide |

## Requirements

- **Node.js 22+** and npm (only to build it)
- A **Claude Pro or Max** subscription (or a Console API key)
- Windows 10/11 x64, or a Linux desktop (glibc, x64)

Claude Code itself is bundled; `npm install` downloads the right native binary for your OS.

## Run it

```bash
npm install
npm run dev
```

On first launch, a setup screen asks how to sign in:

- **Claude subscription** (recommended): a browser opens to the Claude sign-in page; approve it (if the page shows a code, paste it into the app). If you already use `claude` in a terminal, you're already signed in; the login is shared, so choose *check again*.
- **Auth token**: paste a token from `claude setup-token` (details below). Good for a computer that can't open a browser.
- **Console API key**: paste a key from the Anthropic Console. Everything then bills that key; no subscription needed (Remote Control and plan usage need one, so they're off).

Tokens and keys are kept in LocalClaude's encrypted store (AES-256 with a machine-bound key, plus Electron safeStorage: Windows DPAPI, the macOS Keychain, or the Linux Secret Service), never sent back to the window, and left out of exports and backups. Then pick a theme and an accent; everything else is in Settings → Appearance.

## Sign in with a subscription token instead

If you'd rather not sign in through the browser on a machine (or it can't open one), you can give LocalClaude a long-lived token for your Claude Pro or Max subscription. LocalClaude passes `CLAUDE_CODE_OAUTH_TOKEN` through to every Claude Code process it starts, so when it's set the app skips the sign-in screen and uses your subscription, the same as a normal sign-in.

**1. Get a token.** On any machine where Claude Code is installed and you're logged in, run:

```bash
claude setup-token
```

It opens the browser once to confirm, then prints a token that starts with `sk-ant-oat01-`. Copy it. It's a password for your subscription: don't share it, commit it, or paste it into chats.

**2. Give it to LocalClaude.** The easy way: choose **Auth token** on the setup screen (or Settings → Account & privacy → Subscription token) and paste it. It's stored encrypted and **Sign out** removes it.

Or set it as an environment variable on the machine that runs LocalClaude (it wins over a pasted token):

**Windows** (Command Prompt or PowerShell):

```bat
setx CLAUDE_CODE_OAUTH_TOKEN "sk-ant-oat01-..."
```

Then quit LocalClaude completely and start it again. `setx` only affects programs started after it runs, so an open LocalClaude (or the terminal you ran it in) won't see the token until it's restarted. To remove it later: `reg delete HKCU\Environment /v CLAUDE_CODE_OAUTH_TOKEN /f`, then restart the app.

**Linux:** add this line to `~/.bashrc` (or `~/.zshrc` if you use zsh):

```bash
export CLAUDE_CODE_OAUTH_TOKEN="sk-ant-oat01-..."
```

Then run `source ~/.bashrc` (or open a new terminal) and start LocalClaude from that terminal. Apps started from your desktop's menu or dock don't read `~/.bashrc`; to use one of those, put the same line in `~/.profile` too and log out and back in. To remove the token, delete the line(s) and do the same.

**macOS:** same as Linux, using `~/.zshrc` (the default shell).

**How you'll know it worked:** the app opens straight to a new chat, and **Settings → Account & privacy** shows *Sign-in: Subscription token (CLAUDE_CODE_OAUTH_TOKEN)*. The sidebar and Settings have no **Sign out** while the token is set, because signing out can't remove an environment variable; remove the variable and restart instead.

**Good to know:**

- The token is for **your own personal use** with your own subscription. Don't give it to other people or build it into a copy you share.
- One token can work on several of your own devices. Creating **one token per device** is better, though: if a laptop is lost or you stop using it, you can revoke just that one (in your Claude account settings) without signing out everywhere else.
- Usage counts against your plan's limits exactly like a normal sign-in. A Console API key you've added in Settings still takes over chats and designs if you chose that, as described below.

## Portable versions (no install)

Each release also has builds you can run without installing anything:

| File | How to run it |
|---|---|
| `LocalClaude-<version>-win-x64-portable.zip` | Windows 10/11 x64. Right-click → **Extract All**, open the folder, run `LocalClaude.exe`. Keep the whole folder together; move it anywhere, including a USB drive |
| `LocalClaude-<version>-linux-x64-portable.tar.gz` | Any x64 Linux desktop (glibc). `tar xzf LocalClaude-*-linux-x64-portable.tar.gz`, then run `./localclaude` inside the folder. Needs no FUSE, unlike the AppImage |
| `LocalClaude-<version>.AppImage` | Also portable: `chmod +x` it and run it. Needs `libfuse2` (`sudo apt install libfuse2t64` on Ubuntu 24.04) |

Notes:

- **Your chats aren't in the portable folder.** They're kept in the normal app-data folder (`%APPDATA%\LocalClaude` on Windows, `~/.config/LocalClaude` on Linux), shared with the installed version, and encrypted to this computer. Copying the portable folder to another PC gives you the app, not your chats; use a backup or export to move those.
- **Windows SmartScreen** may warn because the builds aren't code-signed: choose **More info → Run anyway**.
- **Linux, if the tar.gz or AppImage closes straight away with a message about `chrome-sandbox`** (common on Ubuntu 24.04 and later, which restricts the sandbox Chromium uses), run this once in the extracted folder: `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox`.
- Sign in as usual, or set a [subscription token](#sign-in-with-a-subscription-token-instead) first.

To build them yourself (on the OS you're targeting): `npm run dist:portable:win` or `npm run dist:portable:linux`. They land in `release/`.

## Build an installer

Build on the OS you're targeting:

```bash
# Windows → release/LocalClaude-Setup-<version>.exe and the portable .zip
npm run dist:win

# Linux → release/LocalClaude-<version>.AppImage, the .deb and the portable .tar.gz
npm run dist:linux
```

The installer is about 250 MB because it carries the native Claude Code binary.

Pushing a version tag (`git tag v1.2.3 && git push origin v1.2.3`) builds all of them, portable versions included, on GitHub and puts them, with the source code, in a draft release for that tag. Pull requests that change the packaging also build the portable versions; download them from the run's **Artifacts** on the Actions tab. Or skip the tag: on the Actions tab, **Release → Run workflow** builds a branch or commit and makes the release for the version in its `package.json`, creating the tag for you (tick **publish** to publish it straight away instead of leaving a draft).

## Computer use

Turn it on in **Settings → Tools & computer → Let Claude use this computer**. Claude then gets a `computer` tool that works like computer use in the Claude app: it takes screenshots of your primary display and can click, drag, scroll, type and press keys in any app.

- **Built in, no extra install.** Screenshots come from Electron; input goes through Windows' own `SendInput` API (via a small PowerShell helper) or `xdotool` on Linux (X11 only; Wayland isn't supported).
- **Permission prompts apply.** In "Ask permissions" mode every action asks first. Choose "Always allow" only if you're comfortable with that.
- **Claude can't operate LocalClaude itself.** Clicks on the LocalClaude window and keystrokes while it's focused are refused, so Claude can't approve its own permission prompts. Minimize LocalClaude or move it to another monitor while Claude works.
- **Primary display only.** Each screenshot is scaled to fit 1280×800 and costs about the same as any image you attach.

Anthropic's built-in computer use in the Claude Code CLI is macOS-only, and **Cowork** is a feature of the Claude desktop app with no SDK access, so neither can be used here directly. This tool is LocalClaude's own implementation of the same idea.

## How "subscription only" is enforced

LocalClaude removes `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and the Bedrock/Vertex/Foundry switches from the environment of every Claude Code process it starts. It keeps `CLAUDE_CODE_OAUTH_TOKEN`, since that's a subscription token ([above](#sign-in-with-a-subscription-token-instead)). Requests go through your Claude.ai login or that token, with one exception: if you add a Console API key (below), chats and designs bill that key instead.

Each chat's status line shows what Claude Code itself reports it is using (its `apiKeySource`). On the subscription, as expected, it shows nothing. With the Console key it shows "API key". If the report disagrees with what the app expects (an API key when chats should use the subscription, or the subscription when they should use the key), it shows a ⚠ warning there instead.

### Optional: use a Console API key for chats

Add a Console API key in **Settings → Account & privacy → Console API key** to bill chat and design sessions to it. Titles, usage checks, sign-in and remote control stay on your subscription, so you still need to be signed in. `ANTHROPIC_API_KEY` is still ignored.

The app checks the key with Anthropic before saving it (listing models, which costs nothing; a rejected key isn't saved, and if Anthropic can't be reached it's saved anyway). It's kept in the same encrypted, machine-bound store as your chats, is never sent back to the window or written to the log, and isn't included in exports or backups. **Remove saved key** deletes it.

You can also set `LOCALCLAUDE_API_KEY` when you start the app. It wins over a saved key while it's set:

```bash
LOCALCLAUDE_API_KEY=sk-ant-... npm run dev
```

While a key is in use, the sidebar shows "API key" instead of your plan, Settings → Account says what uses which, and Settings → Usage labels your plan's limits as subscription usage (API spend isn't shown in the app; check the Console). Settings → Account → "Chats and designs use" switches chats and designs back to your subscription without removing the key, and back again. Chats restart on the new source: idle ones straight away, busy ones when their turn ends. Without a key, only the field to add one appears.

Never commit the key. Check the Console after a small test message to confirm which balance was charged.

Anthropic currently lets the Agent SDK use your subscription's normal usage limits for personal projects like this. They announced, then paused, a plan to move SDK usage to a separate monthly credit; if that returns, this app would draw from that credit instead. Don't distribute builds for other people to sign in with; that needs Anthropic's approval.

## How "this machine only" works

- **Storage:** `vault/` in the app-data folder (Settings → About shows it). Every file is AES-256-GCM encrypted with a key derived (scrypt) from the OS machine ID (Windows `MachineGuid`, Linux `/etc/machine-id`). On top of that, Electron safeStorage adds Windows DPAPI or the Linux keyring.
- **Another PC:** the data refuses to open and shows a lock screen. The only option there is to erase it and start fresh.
- **Your Claude account elsewhere:** these chats never reach claude.ai, so the Claude app on other devices can't see them. Claude Code's own cloud Artifact tool and its auto-memory files are turned off in LocalClaude's sessions; artifacts and memory stay in LocalClaude's encrypted storage.
- **Backups and exports are the way out:** a backup is encrypted with your password and opens on any computer with LocalClaude. An export is plain Markdown (and JSON for the backup inside it), not encrypted, so treat the file like the chats themselves. Importing either on another computer is how you move your data; imported chats whose Claude Code transcript isn't there send their earlier messages to Claude as context on the next turn.
- **Obsidian:** notes LocalClaude writes into your vault (chats, memory, notes Claude saves) are ordinary Markdown files there, not encrypted, so that Obsidian can read them. They're only written when you turn those options on.
- **Remote Control:** sessions you use from your phone run on this computer, but they go through claude.ai to reach your phone, like Remote Control in Claude Code. Your LocalClaude chats aren't shared. Trusting a folder for it sets the same flag in `~/.claude.json` that Claude Code's trust prompt sets.
- **Claude Code transcripts:** Claude Code also keeps its own plain-text session transcripts under `~/.claude/projects`, which is how chats resume. They're on this machine only, but they are not encrypted.
- **Reinstalling the OS** changes the machine ID. The app then treats the PC as a new machine, so old chats are lost by design.

## Tips

- **Ctrl+K** command palette · **Ctrl+Shift+,** appearance · **Ctrl+Shift+L** light/dark · every shortcut can be changed in Settings → Keyboard
- **Ctrl+N** new chat · **Ctrl+,** settings · **Enter** send · **Shift+Enter** newline · **Esc** stop
- Like Claude Code: **Shift+Tab** cycles Ask → Auto-accept edits → Plan · **Esc Esc** opens rewind · **Ctrl+O** toggles Verbose · `/` lists commands with descriptions
- Rewind restores files Claude changed with its edit tools. Changes made by shell commands (e.g. `rm`, `git`) aren't tracked, same as in Claude Code.
- The working folder is fixed once a chat starts, because Claude Code ties the transcript to it. Use "＋ folder" to give access to more folders.
- **Full access** mode can't be used if you run the app as root on Linux; Claude Code refuses that for safety.
- **Windows:** if Claude's shell commands fail, install [Git for Windows](https://git-scm.com/download/win). Claude Code uses Git Bash for its Bash tool.
- **Linux:** no keyring (no gnome-keyring or KWallet) means only the machine-bound encryption layer is active. Settings → Account shows which layers are active.
- **Ctrl+F** finds in the chat · **Ctrl+click** / **Shift+click** selects chats in the sidebar · **Ctrl+Alt+Space** (anywhere) opens a new chat
- **Logs:** Settings → About shows the log file (what happened, not what you wrote). `LOCALCLAUDE_DEBUG=1 npm run dev` also prints Claude Code's stderr.

## Tests

```bash
npm test           # unit tests (LOCALCLAUDE_E2E=1 also sends one real message through Claude Code)
npm run test:e2e   # builds the app and clicks through it with a scripted Claude
```

`test:e2e` runs two suites: the app signed in, then the setup screen, Appearance, Keyboard, the command palette and the example mod (signed out, `node test/e2e/launch.mjs --setup` runs just that one).

The end-to-end tests run the real app (main process, preload and UI) with a stand-in for Claude Code that speaks the same protocol, in a throwaway profile, so they need no account or network. Set `LOCALCLAUDE_E2E_SHOTS=folder` to save screenshots. CI runs both on Windows and Linux.

## Project layout

```
src/main/agent.ts       Agent SDK sessions → UI events, permissions, interrupt, resume
src/main/claude.ts      bundled binary lookup, subscription-only env, sign-in (browser, token, key)
src/main/mods.ts        the mods folder: reading mod.json, CSS and themes, serving scripts (lcmod://)
src/main/computer.ts    computer-use MCP tool (screenshots, mouse, keyboard)
src/main/store.ts       encrypted, machine-bound storage
src/main/index.ts       window + IPC
src/main/artifacts.ts   artifact tool and preview pages
src/main/design.ts      Claude's instructions for designs, comment mode on the canvas
src/main/designExport.ts  designs as PDF and PNG (a hidden, sandboxed window)
src/main/memory.ts      memory tool
src/main/chatSearch.ts  full-text chat search (sidebar and Claude's tool)
src/main/images.ts      images kept with chats, thumbnails
src/main/extract.ts     text from PDF, Word, PowerPoint and Excel files
src/main/knowledge.ts   searchable knowledge (BM25) and its tools
src/main/obsidian.ts    vault detection, chats and memory as notes
src/main/backup.ts      password-protected and automatic backups
src/main/exporter.ts    Markdown/ZIP exports and import
src/main/git.ts         branch, changes and worktrees
src/main/mcpCheck.ts    testing MCP servers from Settings
src/main/fakeAgent.ts   the scripted Claude used by the end-to-end tests
src/preload/            safe bridge (contextIsolation + sandbox)
src/shared/             types + the chat reducer used by both processes
src/shared/customize.ts themes, colors, keyboard shortcuts, mod manifests
src/renderer/src/mods/  runs mods in the window and gives their scripts the API
src/renderer/           React UI (styles/ holds the stylesheets, in cascade order)
test/                   unit tests; test/e2e/ end-to-end tests
```
