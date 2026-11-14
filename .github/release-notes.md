A personal desktop app for Claude on Windows and Linux, powered by Claude Code and your own Claude Pro or Max subscription. See the [README](https://github.com/partham20/localclaude#readme) for everything it does.

## What's new

- **Skills** (Settings → Skills). See every skill your chats can use: yours, your default folder's and your plugins'. Switch any off, write or edit one, or add one from a folder or a `.zip` / `.skill` file.
- **Plugins** (Settings → Plugins). Browse Claude Code's plugin directory and any marketplace you add, then install, switch on and off, update or uninstall plugins. It uses Claude Code's own plugin commands, so Claude Code in a terminal sees the same plugins.
- **Connectors** (Settings → Connectors). Add popular connectors (Notion, Linear, Sentry, Atlassian, GitHub, Context7 and more) in one click, use **Sign in** for servers that need you to log in, and copy the MCP servers Claude Code already has. Your MCP server list moved here from Tools & computer.
- **DeepSeek chats** get your skills, your plugins' MCP servers and the connectors you signed in to. Plugins' slash commands, agents and hooks are Claude Code features, so they stay in Claude Code chats.
- **Your name and profile picture** (since 1.6.0). Click your name at the bottom left to change it or your picture.
- **DeepSeek Harness** (since 1.5.0). Add a DeepSeek API key and switch any chat between Claude Code and DeepSeek from the model menu.

## Downloads

| File | For |
|---|---|
| `LocalClaude-Setup-<version>.exe` | Windows 10/11 (x64). Run it and follow the installer |
| `LocalClaude-<version>.AppImage` | Any Linux desktop (x64, glibc). `chmod +x` it and run it; needs `libfuse2` |
| `localclaude_<version>_amd64.deb` | Debian and Ubuntu: `sudo apt install ./localclaude_<version>_amd64.deb` |
| `LocalClaude-<version>-win-x64-portable.zip` | Windows, no install: extract it and run `LocalClaude.exe` |
| `LocalClaude-<version>-linux-x64-portable.tar.gz` | Linux, no install and no FUSE: extract it and run `./localclaude` |
| Source code (zip / tar.gz) | Build it yourself: `npm install`, then `npm run dist:win` or `npm run dist:linux` |

The installers aren't code-signed, so Windows SmartScreen may say "Windows protected your PC": choose **More info → Run anyway**.

On first launch, the setup screen asks how to sign in: your Claude subscription in the browser, a token from `claude setup-token` ([how](https://github.com/partham20/localclaude#sign-in-with-a-subscription-token-instead)), or a Console API key. Your chats are stored encrypted on that computer only.

Make it yours in **Settings → Appearance** (themes, colors, fonts, sizes, your own CSS), **Settings → Keyboard**, **Ctrl+K**, and **Settings → Mods** ([guide](https://github.com/partham20/localclaude/blob/main/MODS.md)).

**Personal use:** LocalClaude signs in with your own Claude subscription. Anthropic allows that for personal projects; offering it to other people to sign in with needs Anthropic's approval.
