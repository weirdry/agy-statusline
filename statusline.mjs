#!/usr/bin/env node
// agy (Antigravity CLI) status line, rendered directly from agy's status-line JSON.
//
// Mirrors the Claude Code ccstatusline layout (~/.config/ccstatusline/settings.json)
// glyph for glyph: same widgets, colors, number formats and NBSP output. It does not
// read that file, so a layout change made in the ccstatusline TUI must be copied here.
//
//   Gemini 4 Neon 🤖 xhigh | auto 🧠 12.0% | 💫 ▓▓▓░░░░░░░ 34.0% 2d 3hr 4m
//   ~/dotfiles ⎇ main (+3,-1)
//
// Differences from ccstatusline, on purpose:
//   - the cyan slot shows agy's mode (agy hides its own mode label once a custom line is set);
//   - the 💫 group disappears while agy has not sent quota yet, instead of showing a bare 💫;
//   - lines are cut at agy's terminal width, not at Claude Code's footer margins (−6 / −40).

import { execFile } from "node:child_process";
import { homedir } from "node:os";

const COLOR = { white: 188, brightGreen: 155, cyan: 30, brightCyan: 80, brightBlack: 59, brightBlue: 111 };
const SEP = Symbol("separator");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
// East Asian wide/fullwidth ranges (Hangul, CJK, fullwidth forms) take two columns.
const WIDE = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x20000, 0x3fffd],
];

const text = (value, color = "white") => (value ? { value, color } : null);
const percent = (n) => `${Math.max(0, Math.min(100, n)).toFixed(1)}%`;

let input = "";
for await (const chunk of process.stdin) input += chunk;
let data;
try {
  data = JSON.parse(input);
} catch {
  process.exit(0);
}

const fullName = data.model?.display_name ?? data.model?.id ?? "";
const effortSuffix = /\s*\(([^)]*)\)$/.exec(fullName)?.[1];
const usedContext = data.context_window?.used_percentage;
const weekly = quotaBucket("weekly");
const cwd = data.cwd || data.workspace?.current_dir || data.workspace?.project_dir;
const git = await gitState(cwd);

const lines = [
  [
    text(fullName.replace(/\s*\(.*\)$/, "")),
    text(" "), text("🤖"), text(" "),
    text((data.model?.effort ?? effortSuffix)?.toLowerCase(), "brightGreen"),
    SEP,
    text(data.cycle_mode, "cyan"),
    text(" "), text("🧠"), text(" "),
    text(typeof usedContext === "number" ? percent(usedContext) : null),
    ...(weekly
      ? [
          SEP,
          text("💫"), text(" "),
          text(`${slider(weekly.usedPercent)} ${percent(weekly.usedPercent)}`, "brightBlue"),
          text(" "),
          text(duration(weekly.remainingMs), "brightBlack"),
        ]
      : []),
  ],
  [
    text(shortenPath(data.cwd), "cyan"),
    text(" "),
    text(`⎇ ${git.inside && git.branch ? git.branch : "no git"}`, "brightCyan"),
    text(" "),
    text(git.inside ? `(+${git.insertions},-${git.deletions})` : "(no git)", "brightBlack"),
  ],
];

let out = "";
for (const items of lines) {
  const line = truncate(renderLine(items), data.terminal_width);
  if (stripEscapes(line).trim()) out += `\x1b[0m${line.replace(/ /g, " ")}\n`;
}
process.stdout.write(out);

// agy quota keys look like <family>-[<codename>-…]<window>: gemini-5h, gemini-weekly,
// gemini-argon-wtu-weekly, 3p-weekly. Gemini models draw on the gemini family, other
// models (Claude, GPT-OSS) on 3p. A codename bucket applies only to the model of that
// name; when several apply, the most consumed one wins. remaining_fraction is omitempty,
// so a missing value means the bucket is used up.
function quotaBucket(window) {
  const family = /^(gemini|orchestrator)/i.test(fullName) ? "gemini" : "3p";
  let best = null;
  for (const [key, bucket] of Object.entries(data.quota ?? {})) {
    if (!key.startsWith(`${family}-`) || !key.endsWith(window)) continue;
    const codename = key.slice(family.length + 1, -window.length).split("-")[0];
    if (codename && !fullName.toLowerCase().includes(codename)) continue;
    const remaining = bucket?.remaining_fraction ?? 0;
    if (!best || remaining < best.remaining) best = { remaining, bucket };
  }
  if (!best) return null;
  const resetMs = best.bucket.reset_time
    ? Date.parse(best.bucket.reset_time)
    : Date.now() + (best.bucket.reset_in_seconds ?? 0) * 1000;
  return {
    usedPercent: (1 - best.remaining) * 100,
    remainingMs: Number.isFinite(resetMs) ? Math.max(0, Math.min(WEEK_MS, resetMs - Date.now())) : 0,
  };
}

function slider(usedPercent) {
  const filled = Math.round((Math.max(0, Math.min(100, usedPercent)) / 100) * 10);
  return "▓".repeat(filled) + "░".repeat(10 - filled);
}

function duration(ms) {
  const totalHours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const parts = [days > 0 && `${days}d`, hours > 0 && `${hours}hr`, minutes > 0 && `${minutes}m`].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "0m";
}

function shortenPath(path) {
  if (!path) return null;
  const home = homedir();
  let display = path;
  if (path === home) display = "~";
  else if (path.startsWith(`${home}/`)) display = `~${path.slice(home.length)}`;
  const parts = display.split("/").filter(Boolean);
  if (parts.length <= 3) return display;
  return `${display.startsWith("~") ? "~/" : ""}.../${parts.slice(-3).join("/")}`;
}

async function gitState(dir) {
  const run = (...args) =>
    new Promise((resolve) =>
      execFile(
        "git",
        args,
        { cwd: dir || undefined, encoding: "utf8", timeout: 5000, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } },
        (error, stdout) => resolve(error ? "" : stdout.trimEnd()),
      ),
    );
  const [inside, branch, unstaged, staged] = await Promise.all([
    run("rev-parse", "--is-inside-work-tree"),
    run("symbolic-ref", "--short", "HEAD"),
    run("diff", "--shortstat"),
    run("diff", "--cached", "--shortstat"),
  ]);
  const count = (stat, word) => Number(new RegExp(`(\\d+)\\s+${word}`).exec(stat)?.[1] ?? 0);
  return {
    inside: inside === "true",
    branch,
    insertions: count(unstaged, "insertions?") + count(staged, "insertions?"),
    deletions: count(unstaged, "deletions?") + count(staged, "deletions?"),
  };
}

// A separator shows only after content since the previous separator; trailing ones drop.
function renderLine(items) {
  const parts = [];
  let contentSinceSeparator = false;
  for (const item of items) {
    if (item === SEP) {
      if (contentSinceSeparator) parts.push(SEP);
      contentSinceSeparator = false;
    } else if (item) {
      parts.push(`\x1b[38;5;${COLOR[item.color]}m${item.value}\x1b[39m`);
      contentSinceSeparator = true;
    }
  }
  while (parts.at(-1) === SEP) parts.pop();
  return parts.map((part) => (part === SEP ? " | " : part)).join("");
}

function stripEscapes(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function clusterWidth(g) {
  const cp = g.codePointAt(0);
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || /^[\p{M}​-‏⁠﻿]+$/u.test(g)) return 0;
  if (/\p{Emoji_Presentation}/u.test(g) || (/\p{Extended_Pictographic}/u.test(g) && g.includes("️"))) return 2;
  return WIDE.some(([lo, hi]) => cp >= lo && cp <= hi) ? 2 : 1;
}

// Cut to the terminal width with "...", keeping escape codes seen so far (as ccstatusline does).
function truncate(line, maxWidth) {
  if (!(maxWidth > 0)) return line;
  const tokens = line.split(/(\x1b\[[0-9;]*m)/).filter(Boolean);
  const width = tokens.reduce(
    (sum, t) => (t.startsWith("\x1b") ? sum : sum + [...graphemes.segment(t)].reduce((w, s) => w + clusterWidth(s.segment), 0)),
    0,
  );
  if (width <= maxWidth) return line;
  if (maxWidth <= 3) return ".".repeat(maxWidth);
  let out = "";
  let used = 0;
  for (const t of tokens) {
    if (t.startsWith("\x1b")) {
      out += t;
      continue;
    }
    for (const { segment } of graphemes.segment(t)) {
      const w = clusterWidth(segment);
      if (used + w > maxWidth - 3) return `${out}...`;
      out += segment;
      used += w;
    }
  }
  return out;
}
