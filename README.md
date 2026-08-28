<div align="center">

# 🧘 Zen Zone for Obsidian

**Focus. Flow. Breathe.**
<br>
A scientifically designed focus companion for your Obsidian workspace.

[![Release](https://img.shields.io/github/v/release/chacha260/obsidian-zen-zone?style=flat-square&color=8A2BE2)](https://github.com/chacha260/obsidian-zen-zone/releases)
[![Downloads](https://img.shields.io/github/downloads/chacha260/obsidian-zen-zone/total?style=flat-square&color=success)](https://github.com/chacha260/obsidian-zen-zone/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

<p align="center">
  <img src="https://images.unsplash.com/photo-1519681393784-d120267933ba?ixlib=rb-1.2.1&auto=format&fit=crop&w=1200&q=80" alt="Zen Zone Banner" width="100%" style="border-radius: 10px; opacity: 0.9;">
  </p>

</div>

---

## 🧠 Concept: Engineered for Flow

**Zen Zone** is not just a timer or a music player. It is a **UX Psychology-driven tool** designed to reduce cognitive load and induce the "Flow State" (Zone).

By decoupling time management from environmental control, it respects your autonomy and helps you construct the perfect mental environment for deep work within Obsidian.

## ✨ Key Features

### 1. 🍅 Focus Timer (Zen Mode)
Activate **Zen Mode** to eliminate distractions.
- **Distraction-free:** Hides sidebars and status bars automatically.
- **Visual Clarity:** Large, tabular-numeral display for instant recognition.
- **Full Pomodoro Cycle:** Four focus blocks with short breaks, closing on a long break.
- **Runs Without the Panel:** The session lives in the plugin, not the view. Close the Zen panel and the countdown keeps going in the status bar; drive it from the command palette with *Start or pause the focus timer*.
- **Sleep-Proof:** The countdown tracks an absolute deadline, so it neither drifts nor stalls when your machine sleeps.
- **Completion Loop:** A "Session Complete" overlay utilizes the *Zeigarnik Effect* to provide closure and a moment to breathe.

### 2. 🎧 Ambient Audio Engine
Seamlessly integrate YouTube ambiances (Lofi, Jazz, Nature sounds) without leaving your notes.
- **Invisible Player:** Audio plays in the background. No ads, no distractions.
- **Decoupled Control:** Play music without the timer, or run the timer in silence. You have full control.
- **Transport Controls:** Skip, shuffle and repeat (off / all / one) across a whole YouTube playlist.
- **Per-Cycle Scheduling:** Give each of the four cycles its own focus and break track.
- **Lazy & Self-Releasing:** The YouTube player is created on your first play, never before, and is torn down again after a configurable stretch of silence — resuming from the same position when you come back. A silent focus session costs nothing.
- **Volume Mixer:** Independent volume control separate from your system audio.

### 3. 🔖 Smart Checkpoints
Don't waste willpower searching for "the good part" of a track.
- **Quick Jump:** Define timestamps (e.g., "Bass Drop", "Morning Mood") in settings.
- **One-Tap Access:** Switch moods instantly with large, Fitts's Law-compliant buttons.

### 4. ⚙️ GUI Playlist Manager
- **No JSON Editing:** A clean, modal-based interface to manage your favorite tracks.
- **Cognitive Ease:** Visual hierarchy helps you organize titles, URLs, and checkpoints effortlessly.

### 5. ✅ Tasks & Daily Note Logging
Keep the one thing you are working on in front of you.
- **Current Focus:** The top task is pinned above the list, so intent survives the session.
- **Reorderable Backlog:** Drag and drop, or nudge tasks up and down.
- **Daily Note Sync:** Adding a task appends a checkbox to today's daily note; completing it stamps the time. Uses your Daily Notes template when one is configured.

---

## 🎨 Design Philosophy

This plugin was refactored by a **UX Psychology Architect** based on the following principles:

> **Gestalt Principles (Common Region)**
> Controls are grouped into distinct cards ("Timer" vs "Audio") to help your brain process information faster.

> **Von Restorff Effect**
> The primary action ("Start Focus") is visually isolated and emphasized, reducing decision fatigue.

> **Fitts's Law**
> Interactive elements like checkpoints have expanded clickable areas, making interaction fluid and error-free.

---

## 🚀 Getting Started

**Requires Obsidian 1.5.0 or newer.**

1. **Install:** Download `main.js`, `manifest.json`, and `styles.css` into your `.obsidian/plugins/zen-zone/` folder.
2. **Enable:** Turn on **Zen Zone** in Obsidian Community Plugins settings.
3. **Open:** Click the ⚡ (Zap) icon in the ribbon to open the Zen Zone view.
4. **Configure:** Go to settings to add your favorite YouTube ambience tracks.

## 📸 Screenshots

| Focus Mode | Settings GUI |
|:---:|:---:|
| *[Insert Image of Zen View]* | *[Insert Image of Settings Modal]* |
| Clean interface for deep work. | Easy playlist management. |

---

---

## 🛠 Development

```bash
npm install
npm run dev     # esbuild in watch mode -> main.js
npm run build   # type-check, then a production bundle
```

The plugin is bundled from `src/`:

| Path | Responsibility |
|:---|:---|
| `src/main.ts` | Plugin entry: settings, view registration, zen mode, status bar |
| `src/session.ts` | The pomodoro state machine, owned by the plugin so it outlives the panel |
| `src/constants.ts`, `src/types.ts`, `src/utils.ts` | Defaults, shared types and pure helpers |
| `src/daily-note.ts` | Reading and rewriting task lines in the daily note |
| `src/audio/youtube-audio.ts` | The hidden YouTube IFrame player |
| `src/view/` | The side panel: `zen-view` plus the task, timer and audio cards |
| `src/settings/` | Settings tab and the track editor modal |

All styling lives in `styles.css` so themes can override it.

<div align="center">

Made with 💜 for the Obsidian Community.

</div>

2KioNMMplOs
