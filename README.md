<div align="center">

# 🧘 Zen Zone for Obsidian

**Focus. Flow. Breathe.**
<br>
A focus companion for your Obsidian workspace: pomodoro timer, YouTube ambience and daily note task logging.

[![Release](https://img.shields.io/github/v/release/chacha260/obsidian-zen-zone?style=flat-square&color=8A2BE2)](https://github.com/chacha260/obsidian-zen-zone/releases)
[![Downloads](https://img.shields.io/github/downloads/chacha260/obsidian-zen-zone/total?style=flat-square&color=success)](https://github.com/chacha260/obsidian-zen-zone/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

<p align="center">
  <img src="https://images.unsplash.com/photo-1519681393784-d120267933ba?ixlib=rb-1.2.1&auto=format&fit=crop&w=1200&q=80" alt="Zen Zone Banner" width="100%" style="border-radius: 10px; opacity: 0.9;">
  </p>

</div>

---

## What it does

**Zen Zone** puts a pomodoro timer, an ambient music player and a short task list into one side panel. The timer and the music are independent: run either one alone, or let the timer switch the music for you at every phase.

## Features

### 🍅 Focus timer

- **Full pomodoro run:** four focus blocks with short breaks, closing on a long break. Durations are configurable.
- **Zen mode:** while the timer runs, the sidebars can collapse and the ribbon, tab headers and view headers can be hidden.
- **Runs without the panel:** the session belongs to the plugin, not the view. Close the panel and the countdown continues in the status bar; select the status bar timer to bring the panel back.
- **Sleep-proof:** the countdown tracks an absolute deadline, so it neither drifts nor stalls when your machine sleeps.
- **Transition sounds:** play an audio file from your vault at each phase change, with a configurable pause before the music resumes.

### 🎧 Ambient audio

- **Background playback:** YouTube videos and playlists play through a hidden player.
- **Transport controls:** skip, shuffle and repeat (off / all / one) across a playlist, with an independent volume slider.
- **Per-cycle scheduling:** give each of the four cycles its own focus and break track.
- **Checkpoints:** name timestamps inside a track ("Morning", "Night") and jump to them with one tap.
- **Lazy and self-releasing:** the player is created on your first play, never before, and is discarded after a configurable stretch of silence. Playback resumes from the same position.

Music plays from the panel, so it stops when the panel is closed. The timer keeps running.

### ✅ Tasks and daily note logging

- **Current focus:** the top task is pinned above the list.
- **Reorderable backlog:** drag and drop, or move tasks up and down.
- **Daily note logging (optional):** adding a task appends a checkbox under a heading in today's daily note; completing it stamps the time; deleting it removes the line. A new daily note uses your Daily notes template when one is configured.

### 🌐 Languages

The interface follows Obsidian's language. English and Japanese are included.

---

## Commands

| Command | What it does |
|:---|:---|
| **Zen Zone: Open panel** | Opens the side panel. |
| **Zen Zone: Start or pause the focus timer** | Starts, pauses or resumes the session. |
| **Zen Zone: Reset the focus session** | Returns to the first cycle. |

No hotkeys are assigned by default. Set your own in **Settings → Hotkeys**.

---

## Network use and privacy

- **YouTube:** music is streamed by embedding YouTube's player (`https://www.youtube.com/embed/…`) in a hidden frame. This is the only network access the plugin makes. Nothing is requested until you start playback, and nothing is requested at all if you only use the timer and tasks.
- When the player is active, YouTube receives what any embedded YouTube video receives: your IP address, the video or playlist being played, and YouTube's own cookies. YouTube's terms and privacy policy apply, and YouTube may show ads according to its own rules.
- The plugin loads no remote scripts into Obsidian. It controls the embedded player by messaging its frame.
- No telemetry, no analytics, no account. Your notes and tasks never leave your vault.
- The plugin writes only to its own settings and, when daily note logging is enabled, to your daily notes.

---

## Getting started

**Requires Obsidian 1.5.0 or newer.** Works on desktop and mobile; the status bar timer is desktop only because mobile has no status bar.

### Manual installation

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/chacha260/obsidian-zen-zone/releases).
2. Copy them into `<Vault>/.obsidian/plugins/zen-zone/`.
3. Reload Obsidian and enable **Zen Zone** in **Settings → Community plugins**.

### First steps

1. Select the ⚡ icon in the ribbon to open the panel.
2. Open **Settings → Zen Zone** and add your tracks under **Playlist**. Paste a YouTube video URL or a playlist URL (one that contains `list=`).
3. Choose the music for each cycle under **Cycle music**.
4. Select **Start focus**.

---

## Development

```bash
npm install
npm run dev     # esbuild in watch mode -> main.js
npm run build   # type-check, then a production bundle
npm run lint
npm test
```

The plugin is bundled from `src/`:

| Path | Responsibility |
|:---|:---|
| `src/main.ts` | Plugin entry: settings, view registration, commands, zen mode, status bar |
| `src/session.ts` | The pomodoro state machine, owned by the plugin so it outlives the panel |
| `src/i18n.ts` | Interface strings (English and Japanese) |
| `src/constants.ts`, `src/types.ts`, `src/utils.ts`, `src/moment.ts`, `src/dom.ts` | Defaults, shared types and helpers |
| `src/daily-note.ts`, `src/task-lines.ts` | Daily note access, and the pure line edits behind it |
| `src/audio/` | The hidden YouTube player and the message protocol that drives it |
| `src/view/` | The side panel: `zen-view` plus the task, timer and audio cards |
| `src/settings/` | Settings tab and the track editor modal |
| `tests/` | Unit tests for the pure modules |

All styling lives in `styles.css` so themes can override it.

### Releasing

1. Run `npm version <new version>`; this updates `manifest.json` and `versions.json`.
2. Push the commit and the tag (the tag is the bare version, with no leading `v`).
3. The release workflow builds the plugin and opens a draft release with `main.js`, `manifest.json` and `styles.css` attached. Review and publish it.

## License

[MIT](LICENSE)

<div align="center">

Made with 💜 for the Obsidian Community.

</div>

2KioNMMplOs
