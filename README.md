原因はずばり、**現在のコードがURLから「動画ID（`v=...`）」だけを抽出していて、「プレイリストID（`&list=...`）」の部分を捨ててしまっているから**です。また、YouTubeのプレイヤー（iframe）を生成する際に、「単曲ループ」の設定がハードコードされているため、1曲目が終わっても次の曲に進みません。

プレイリスト全体を再生させるには、URLから `list` の情報も抽出し、iframeのURLパラメータに渡すように改修する必要があります。

`main.ts` の以下の3箇所を書き換えることで解決します！

### 1. `YouTubeAudio` クラスのコンストラクタを修正

ファイルの63行目付近にある `YouTubeAudio` クラスを、`listId` を受け取れるように変更します。

**変更前:**

```typescript
class YouTubeAudio {
    private iframe: HTMLIFrameElement;
    
    constructor(container: HTMLElement, videoId: string) {
        const existing = container.querySelector('iframe');
        if (existing) existing.remove();

        this.iframe = container.createEl("iframe");
        this.iframe.width = "0";
        this.iframe.height = "0";
        this.iframe.src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&controls=0&loop=1&playlist=${videoId}`;
        this.iframe.allow = "autoplay";
        this.iframe.style.display = "none";
    }
//...

```

**変更後:**

```typescript
class YouTubeAudio {
    private iframe: HTMLIFrameElement;
    
    constructor(container: HTMLElement, videoId: string | null, listId: string | null) {
        const existing = container.querySelector('iframe');
        if (existing) existing.remove();

        this.iframe = container.createEl("iframe");
        this.iframe.width = "0";
        this.iframe.height = "0";
        
        // ベースとなるURL
        let srcUrl = "https://www.youtube.com/embed/";
        
        if (videoId) {
            srcUrl += `${videoId}?enablejsapi=1&controls=0`;
            if (listId) {
                // プレイリストIDがある場合は付与する（自動で次の曲に進むようになります）
                srcUrl += `&list=${listId}`;
            } else {
                // 単曲の場合は従来通りループさせる
                srcUrl += `&loop=1&playlist=${videoId}`;
            }
        } else if (listId) {
            // 動画IDがなく、プレイリストIDだけの場合
            srcUrl += `?enablejsapi=1&controls=0&listType=playlist&list=${listId}`;
        }

        this.iframe.src = srcUrl;
        this.iframe.allow = "autoplay";
        this.iframe.style.display = "none";
    }
//...

```

---

### 2. URL抽出関数の置き換え

ファイルの367行目付近にある `extractVideoId` メソッドを、リストIDも抽出できる `extractYouTubeInfo` に置き換えます。

**変更前:**

```typescript
    extractVideoId(input: string): string | null {
        if (!input) return null;
        if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
        const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = input.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

```

**変更後（このまま置き換えてください）:**

```typescript
    extractYouTubeInfo(input: string): { videoId: string | null, listId: string | null } {
        if (!input) return { videoId: null, listId: null };
        
        let videoId: string | null = null;
        let listId: string | null = null;

        // 1. URLから "list=xxx" の部分を抽出
        const listMatch = input.match(/[?&]list=([a-zA-Z0-9_-]+)/);
        if (listMatch) {
            listId = listMatch[1];
        }

        // 2. 既存の動画ID抽出ロジック
        if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
            videoId = input;
        } else {
            const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
            const match = input.match(regExp);
            if (match && match[2].length === 11) {
                videoId = match[2];
            }
        }

        return { videoId, listId };
    }

```

---

### 3. `renderAudioCard` の再生呼び出し部分を修正

抽出関数の変更に合わせて、160行目付近にある `renderAudioCard` 内のロジックを修正します。

**変更前:**

```typescript
        let firstValidId: string | null = null;
        let currentTrackCheckpoints: Checkpoint[] = [];

        playlist.forEach((track, index) => {
            const videoId = this.extractVideoId(track.url);
            if (videoId) {
                const option = selectEl.createEl("option", { text: track.title });
                option.value = JSON.stringify({ id: videoId, index: index });
                if (!firstValidId) {
                    firstValidId = videoId;
                    currentTrackCheckpoints = track.checkpoints || [];
                }
            }
        });

        // --- Checkpoints Container (Reference for re-rendering) ---
        const checkpointsContainer = card.createDiv({ cls: "zen-checkpoints-area" });

        // --- Player Init Logic ---
        const initPlayer = (videoId: string, checkpoints: Checkpoint[]) => {
            this.currentVideoId = videoId;
            this.ytPlayer = new YouTubeAudio(playerContainer, videoId);
//...
        if (firstValidId) initPlayer(firstValidId, currentTrackCheckpoints);

        selectEl.onchange = () => {
            try {
                const val = JSON.parse(selectEl.value);
                const track = playlist[val.index];
                initPlayer(val.id, track.checkpoints || []);
            } catch(e) { console.error(e); }
        };

```

**変更後:**

```typescript
        // 型を変更
        let firstValidInfo: { videoId: string|null, listId: string|null } | null = null;
        let currentTrackCheckpoints: Checkpoint[] = [];

        playlist.forEach((track, index) => {
            const info = this.extractYouTubeInfo(track.url); // メソッド名を変更
            if (info.videoId || info.listId) {
                const option = selectEl.createEl("option", { text: track.title });
                option.value = JSON.stringify({ info: info, index: index }); // infoをまるごと保存
                if (!firstValidInfo) {
                    firstValidInfo = info;
                    currentTrackCheckpoints = track.checkpoints || [];
                }
            }
        });

        // --- Checkpoints Container (Reference for re-rendering) ---
        const checkpointsContainer = card.createDiv({ cls: "zen-checkpoints-area" });

        // --- Player Init Logic ---
        // 引数にオブジェクトを受け取るように変更
        const initPlayer = (info: {videoId: string|null, listId: string|null}, checkpoints: Checkpoint[]) => {
            this.currentVideoId = info.videoId;
            this.ytPlayer = new YouTubeAudio(playerContainer, info.videoId, info.listId);
//...
        // 初回ロード部分の変更
        if (firstValidInfo) initPlayer(firstValidInfo, currentTrackCheckpoints);

        selectEl.onchange = () => {
            try {
                const val = JSON.parse(selectEl.value);
                const track = playlist[val.index];
                initPlayer(val.info, track.checkpoints || []); // val.id から val.info に変更
            } catch(e) { console.error(e); }
        };

```

**最後に、同メソッドの下の方（212行目付近）の `loadTrackByReference` も合わせます:**

**変更前:**

```typescript
        // Expose initPlayer for other methods to use
        this.loadTrackByReference = (ref: MusicReference) => {
            const track = playlist[ref.trackIndex];
            if(!track) return;
            const videoId = this.extractVideoId(track.url);
            if(videoId) {
                // UI上のSelect要素も合わせる（見た目の同期）
                selectEl.value = JSON.stringify({ id: videoId, index: ref.trackIndex });
                initPlayer(videoId, track.checkpoints || []);

```

**変更後:**

```typescript
        // Expose initPlayer for other methods to use
        this.loadTrackByReference = (ref: MusicReference) => {
            const track = playlist[ref.trackIndex];
            if(!track) return;
            const info = this.extractYouTubeInfo(track.url); // ここを変更
            if(info.videoId || info.listId) {
                // UI上のSelect要素も合わせる（見た目の同期）
                selectEl.value = JSON.stringify({ info: info, index: ref.trackIndex }); // idからinfoへ
                initPlayer(info, track.checkpoints || []); // videoIdからinfoへ

```

---

### まとめ

この3ステップの修正を反映させて `main.ts` を再ビルドすれば、`&list=...` が含まれるURLを設定した際に、プレイリストの曲が最後まで順次再生されるようになります。

もし書き換えでエラーが出たり、うまくいかない箇所があれば、該当のエラーやコード部分を教えてくださいね！

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
- **Completion Loop:** A "Session Complete" overlay utilizes the *Zeigarnik Effect* to provide closure and a moment to breathe.

### 2. 🎧 Ambient Audio Engine
Seamlessly integrate YouTube ambiances (Lofi, Jazz, Nature sounds) without leaving your notes.
- **Invisible Player:** Audio plays in the background. No ads, no distractions.
- **Decoupled Control:** Play music without the timer, or run the timer in silence. You have full control.
- **Volume Mixer:** Independent volume control separate from your system audio.

### 3. 🔖 Smart Checkpoints
Don't waste willpower searching for "the good part" of a track.
- **Quick Jump:** Define timestamps (e.g., "Bass Drop", "Morning Mood") in settings.
- **One-Tap Access:** Switch moods instantly with large, Fitts's Law-compliant buttons.

### 4. ⚙️ GUI Playlist Manager
- **No JSON Editing:** A clean, modal-based interface to manage your favorite tracks.
- **Cognitive Ease:** Visual hierarchy helps you organize titles, URLs, and checkpoints effortlessly.

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

<div align="center">

Made with 💜 for the Obsidian Community.

</div>

2KioNMMplOs
