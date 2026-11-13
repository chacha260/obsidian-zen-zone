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

**Zen Zone** puts a pomodoro timer, an ambient music player and a short task list into one side panel. The timer and the music are independent: run either one alone, or let the timer switch the music for you at every phase. Both keep going when the panel is closed.

## Features

### 🍅 Focus timer

- **Configurable run:** 1 to 12 focus cycles with short breaks, closing on a long break. Every duration is yours to set.
- **Your pace:** start breaks and focus phases automatically, or have the timer wait for you. Skip a phase at any time.
- **Runs without the panel:** the status bar shows the countdown and the current task; select it for a menu to pause, skip, reset, control the music or open the panel.
- **Sleep-proof:** the countdown tracks an absolute deadline, so it neither drifts nor stalls when your machine sleeps.
- **Notifications:** phase changes raise a system notification when Obsidian is in the background.
- **Transition sounds:** play an audio file from your vault at each phase change, with a configurable pause before the music resumes.
- **Zen mode:** while the timer runs, the sidebars can collapse and the ribbon, tab headers and view headers can be hidden. Sidebars are reopened afterwards.
- **Focus totals:** completed focus phases are counted per day; the panel shows today's total and a bar chart of the last seven days.

### 🎧 Ambient audio

- **Two kinds of tracks:** a YouTube video or playlist, or an audio file or a folder of audio files in your vault. Local tracks work offline.
- **Keeps playing:** music belongs to the plugin, not the panel, so it continues when the panel is closed.
- **Transport controls:** previous, next, shuffle and repeat (off / all / one), with a volume slider. All of it is remembered.
- **Per-cycle scheduling:** give each cycle its own focus and break track.
- **Checkpoints:** name timestamps inside a track ("Morning", "Night") and jump to them with one tap.
- **Small floating video:** a YouTube track shows its video in a small player in the corner. You can turn this off in the settings.
- **Lazy and self-releasing:** a player is created on your first play, never before, and is discarded after a configurable stretch of silence. Playback resumes from the same position.

### ✅ Tasks and daily note logging

- **Current focus:** the top task is shown above the list. Select any other task to make it the current one.
- **Estimates:** give a task an expected number of pomodoros and watch the tally (`🍅2/4`) as focus phases complete. It turns to a warning colour once the estimate is used up.
- **Edit in place:** rename a task or change its estimate without leaving the panel; the daily note follows.
- **Undo:** completing or deleting a task offers an undo, which also puts the daily note back.
- **Reorderable backlog:** drag and drop, or move tasks up and down.
- **Daily note logging (optional):** adding a task appends a checkbox under a heading in today's daily note; completing it stamps the time and the 🍅 tally; deleting it removes the line.
- **Done today:** tasks you completed today stay listed under the backlog and can be reopened.
- **Carry-over:** tasks still filed in an earlier day's note can be moved to today's note in one step; the old line is marked as forwarded (`- [>]`).
- **Import:** pull open checkboxes you wrote into today's daily note by hand into the task list.
- **Focus log (optional):** each completed focus phase appends a line such as `- 09:00–09:25 🍅 Write report` to today's daily note.
- A new daily note uses your Daily notes template when one is configured.

### 🧭 Panel

- The timer sits at the top, with a ring that empties as the phase runs and one dot per cycle.
- The task and music sections fold away; the panel remembers which ones you closed.

### 🌐 Languages

The interface follows Obsidian's language. English and Japanese are included.

---

## Commands

| Command | What it does |
|:---|:---|
| **Open panel** | Opens the side panel. |
| **Start or pause the focus timer** | Starts, pauses or resumes the session. |
| **Skip to the next phase** | Ends the current phase early. |
| **Reset the focus session** | Returns to the first cycle. |
| **Play or pause the music** | Toggles playback. |
| **Play the next track** | Moves on in the current playlist or folder. |

No hotkeys are assigned by default. Set your own in **Settings → Hotkeys**.

---

## Network use and privacy

- **YouTube:** YouTube tracks are streamed by embedding YouTube's player (`https://www.youtube.com/embed/…`). This is the only network access the plugin makes. Nothing is requested until you start playing a YouTube track, and nothing at all if you only use the timer, tasks and local audio.
- When the player is active, YouTube receives what any embedded YouTube video receives: your IP address, the video or playlist being played, and YouTube's own cookies. YouTube's terms and privacy policy apply, and YouTube may show ads according to its own rules.
- By default the video is shown in a small floating player. The setting **Show YouTube video** can turn that off; YouTube's terms expect an embedded player to stay visible, so that choice is yours to make.
- The plugin loads no remote scripts into Obsidian. It controls the embedded player by messaging its frame.
- No telemetry, no analytics, no account. Your notes and tasks never leave your vault.
- The plugin writes only to its own settings and, when daily note logging is enabled, to your daily notes.

---

## Getting started

**Requires Obsidian 1.13.0 or newer.** Works on desktop and mobile; the status bar timer is desktop only because mobile has no status bar.

### Manual installation

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/chacha260/obsidian-zen-zone/releases/latest).
2. Copy them into `<Vault>/.obsidian/plugins/zen-zone/`.
3. Reload Obsidian and enable **Zen Zone** in **Settings → Community plugins**.

### First steps

1. Select the ⚡ icon in the ribbon to open the panel.
2. Open **Settings → Zen Zone** and add your tracks under **Playlist**. Paste a YouTube video or playlist URL (one that contains `list=`), or pick an audio file or folder from your vault.
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
| `src/audio/` | The audio engine, the YouTube player with its message protocol, and the local file player |
| `src/view/` | The side panel: `zen-view` plus the task, timer and audio cards |
| `src/settings/` | Settings tab and the track editor modal |
| `tests/` | Unit tests for the pure modules |

All styling lives in `styles.css` so themes can override it.

### Releasing

1. Run `npm version <new version>`. This updates `package.json`, `manifest.json` and `versions.json`, commits, and creates the tag (the bare version, with no leading `v`).
2. Push the commit and the tag: `git push --follow-tags`.
3. The **Release** workflow lints, tests and builds the plugin, then publishes a GitHub release with `main.js`, `manifest.json` and `styles.css` attached.

The workflow can also be started by hand from the **Actions** tab. It then releases the version found in `manifest.json` from the selected branch, optionally as a draft.

## License

[MIT](LICENSE)

<div align="center">

Made with 💜 for the Obsidian Community.

</div>

2KioNMMplOs
