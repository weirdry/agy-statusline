# agy-statusline

Status line for the Antigravity CLI (`agy`), in the same layout as my Claude Code
[ccstatusline](https://github.com/sirmalloc/ccstatusline) setup.

```
Gemini 4 Neon 🤖 xhigh | auto 🧠 12.0% | 💫 ▓▓▓░░░░░░░ 34.0% 2d 3hr 4m
~/dotfiles ⎇ main (+3,-1)
```

- Line 1: model, effort, agy mode, context used, weekly quota used and time until it resets.
  The quota group appears once agy sends quota, a couple of seconds after start.
- Line 2: working directory (last three folders), git branch, uncommitted lines added and removed.

The layout is copied from ccstatusline by hand. This script does not read ccstatusline's config.

## Install

Needs Node 18+ and pnpm, with pnpm's global bin folder on `PATH`.

```sh
pnpm add -g github:weirdry/agy-statusline
```

Then set it in `~/.gemini/antigravity-cli/settings.json`:

```json
"statusLine": { "command": "agy-statusline" }
```

To update, run the install command again. To remove, run `/statusline delete` in agy, then
`pnpm remove -g agy-statusline`.

## Also on a new machine

Not part of this package: let agy see skills installed with `npx skills`. The path must be
absolute, since agy ignores `~/` here. This creates the file, so run it only when
`~/.gemini/config/skills.json` doesn't exist yet.

```sh
mkdir -p ~/.gemini/config && printf '{"entries":[{"path":"%s"}]}\n' "$HOME/.agents/skills" > ~/.gemini/config/skills.json
```
