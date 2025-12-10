import { Plugin, ItemView, WorkspaceLeaf, Notice, PluginSettingTab, App, Setting, setIcon, Modal, ButtonComponent } from 'obsidian';

const VIEW_TYPE_ZEN = "zen-zone-view";

// ------------------------------------------------------------
// 1. Data Interfaces
// ------------------------------------------------------------
interface Checkpoint {
    label: string;
    time: string;
}

interface PlaylistItem {
    title: string;
    url: string;
    checkpoints?: Checkpoint[];
}

interface ZenZoneSettings {
    playlistData: PlaylistItem[];
}

const DEFAULT_SETTINGS: ZenZoneSettings = {
    playlistData: [
        { 
            title: "☕ Lofi Girl - Study", 
            url: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
            checkpoints: []
        },
        { 
            title: "🎷 Jazz - Relax", 
            url: "https://www.youtube.com/watch?v=Dx5qFachd3A",
            checkpoints: [
                { label: "🌅 Morning", time: "0:00" },
                { label: "🌃 Night", time: "10:30" }
            ]
        }
    ]
}

// ------------------------------------------------------------
// 2. YouTube Iframe Wrapper
// ------------------------------------------------------------
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

    private postCommand(command: string, args: any[] = []) {
        if (this.iframe.contentWindow) {
            this.iframe.contentWindow.postMessage(JSON.stringify({
                'event': 'command',
                'func': command,
                'args': args
            }), '*');
        }
    }

    play() { this.postCommand('playVideo'); }
    pause() { this.postCommand('pauseVideo'); }
    setVolume(vol0to1: number) { this.postCommand('setVolume', [vol0to1 * 100]); }
    seekTo(seconds: number) { this.postCommand('seekTo', [seconds, true]); }
}

// ------------------------------------------------------------
// 3. Main View (UX Optimized: Decoupled Control)
// ------------------------------------------------------------
class ZenView extends ItemView {
    plugin: ZenZonePlugin;
    timerInterval: number | null = null;
    timeLeft: number = 25 * 60; 
    
    // State separation
    isTimerRunning: boolean = false;
    isMusicPlaying: boolean = false; 

    ytPlayer: YouTubeAudio | null = null;
    currentVideoId: string | null = null;
    currentVolume: number = 0.5;

    // UI Elements for updates
    musicBtnEl: HTMLButtonElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ZenZonePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return VIEW_TYPE_ZEN; }
    getDisplayText() { return "Zen Zone"; }
    getIcon() { return "zap"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("zen-view-container");

        // Header
        const header = container.createDiv({ cls: "zen-header" });
        header.createEl("h2", { text: "Zen Zone" });
        
        // 1. Timer Card (Focus Control)
        this.renderTimerCard(container);

        // 2. Audio Card (Environment Control)
        this.renderAudioCard(container);

        // Footer Note
        container.createDiv({
            text: "Settings available in plugin options.",
            cls: "zen-footer-note"
        });
    }

    renderTimerCard(parent: HTMLElement) {
        const card = parent.createDiv({ cls: "zen-card zen-timer-card" });
        
        // Timer Display
        const timerDisplay = card.createDiv({ cls: "zen-timer-display" });
        timerDisplay.setText(this.formatTime(this.timeLeft));

        // Primary Action Button (Timer Only)
        const controls = card.createDiv({ cls: "zen-controls" });
        const toggleBtn = controls.createEl("button", { cls: "zen-main-btn" });
        toggleBtn.setText("Start Focus");
        setIcon(toggleBtn, "timer"); // Icon changed to represent Timer/Focus
        
        toggleBtn.onclick = () => this.toggleTimer(toggleBtn, timerDisplay);
    }

    renderAudioCard(parent: HTMLElement) {
        const card = parent.createDiv({ cls: "zen-card zen-audio-card" });
        const playlist = this.plugin.settings.playlistData;

        // Hidden Player Container
        const playerContainer = card.createDiv({ cls: "zen-player-hidden" });

        // --- Track Selection ---
        const selectWrapper = card.createDiv({ cls: "zen-input-group" });
        selectWrapper.createDiv({ cls: "zen-label", text: "Ambience" });
        
        const selectEl = selectWrapper.createEl("select", { cls: "zen-select" });
        
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

        // --- Player Controls (Play/Pause & Volume) ---
        // <Common Region>: Grouping playback controls
        const controlsRow = card.createDiv({ cls: "zen-audio-controls-row" });
        controlsRow.style.display = "flex";
        controlsRow.style.alignItems = "center";
        controlsRow.style.gap = "15px";
        controlsRow.style.marginTop = "10px";

        // Play/Pause Button
        this.musicBtnEl = controlsRow.createEl("button", { cls: "zen-music-btn" });
        setIcon(this.musicBtnEl, "play");
        this.musicBtnEl.onclick = () => this.toggleMusic();

        // Volume Slider
        const volumeWrapper = controlsRow.createDiv({ cls: "zen-volume-wrapper" });
        volumeWrapper.style.flexGrow = "1";
        volumeWrapper.style.display = "flex";
        volumeWrapper.style.alignItems = "center";
        volumeWrapper.style.gap = "8px";

        const volIcon = volumeWrapper.createDiv({ cls: "zen-label" });
        setIcon(volIcon, "volume-2");

        this.createSlider(volumeWrapper, (val) => {
            this.currentVolume = val;
            if (this.ytPlayer) this.ytPlayer.setVolume(val);
        });

        // --- Checkpoints Area ---
        const checkpointsContainer = card.createDiv({ cls: "zen-checkpoints-area" });

        // Player Logic
        const initPlayer = (videoId: string, checkpoints: Checkpoint[]) => {
            this.currentVideoId = videoId;
            // Re-create player
            this.ytPlayer = new YouTubeAudio(playerContainer, videoId);
            this.ytPlayer.setVolume(this.currentVolume);
            
            // Checkpoints render
            this.renderCheckpoints(checkpointsContainer, checkpoints);

            // Music State Handling
            // 曲変更時：再生中ならそのまま再生、停止中なら停止のまま
            if (this.isMusicPlaying) {
                // Iframeのロード時間を考慮して少し待つ
                setTimeout(() => {
                    if(this.ytPlayer) {
                        this.ytPlayer.setVolume(this.currentVolume);
                        this.ytPlayer.play();
                    }
                }, 1000);
            }
        };

        if (firstValidId) initPlayer(firstValidId, currentTrackCheckpoints);

        selectEl.onchange = () => {
            try {
                const val = JSON.parse(selectEl.value);
                const track = playlist[val.index];
                initPlayer(val.id, track.checkpoints || []);
            } catch(e) { console.error(e); }
        };
    }

    renderCheckpoints(container: HTMLElement, checkpoints: Checkpoint[]) {
        container.empty();
        if(!checkpoints || checkpoints.length === 0) return;

        container.createDiv({ cls: "zen-sub-label", text: "Quick Jump" });
        const grid = container.createDiv({ cls: "zen-chip-grid" });

        checkpoints.forEach(cp => {
            const btn = grid.createEl("button", { cls: "zen-chip" });
            btn.setText(cp.label);
            
            btn.onclick = () => {
                const seconds = this.parseTimeString(cp.time);
                if (this.ytPlayer) {
                    this.ytPlayer.seekTo(seconds);
                    new Notice(`⏩ Jumped to ${cp.label}`);
                    // ジャンプしたら自動再生する方がUXが良い（意図が明確なため）
                    if (!this.isMusicPlaying) this.toggleMusic(); 
                }
            };
        });
    }

    // --- Logic: Music Control ---
    toggleMusic() {
        if (!this.ytPlayer) return;

        if (this.isMusicPlaying) {
            this.ytPlayer.pause();
            this.isMusicPlaying = false;
            if(this.musicBtnEl) {
                setIcon(this.musicBtnEl, "play");
                this.musicBtnEl.removeClass("is-playing");
            }
        } else {
            this.ytPlayer.play();
            this.isMusicPlaying = true;
            if(this.musicBtnEl) {
                setIcon(this.musicBtnEl, "pause");
                this.musicBtnEl.addClass("is-playing");
            }
        }
    }

    // --- Logic: Timer Control (Decoupled) ---
    toggleTimer(btn: HTMLButtonElement, display: HTMLElement) {
        if (this.isTimerRunning) {
            // STOP FOCUS
            this.stopTimer();
            btn.setText("Start Focus");
            btn.removeClass("is-active");
            setIcon(btn, "timer");
            this.plugin.exitZenMode();
            // Note: Music continues playing (Decoupled)
        } else {
            // START FOCUS
            this.isTimerRunning = true;
            btn.setText("Stop Focus");
            btn.addClass("is-active");
            setIcon(btn, "x"); // 'x' icon for stopping
            this.plugin.enterZenMode();
            // Note: Music is NOT triggered here
            
            this.timerInterval = window.setInterval(() => {
                this.timeLeft--;
                display.setText(this.formatTime(this.timeLeft));
                if (this.timeLeft <= 0) this.completeSession(btn);
            }, 1000);
        }
    }

    stopTimer() {
        this.isTimerRunning = false;
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    completeSession(btn: HTMLButtonElement) {
        this.stopTimer();
        this.plugin.exitZenMode();
        
        // Timer Reset
        btn.setText("Start Focus");
        btn.removeClass("is-active");
        setIcon(btn, "timer");
        this.timeLeft = 25 * 60;
        
        this.plugin.showBreakOverlay();

        // Optional: Pause music on session complete?
        // ユーザーの達成感を演出するために、セッション完了時は音楽を止める（静寂に戻す）のが一般的ですが
        // ここでは「完全な分離」を優先し、音楽はそのままにします。
        // もし止めたければここで this.toggleMusic() を呼びます。
    }

    // --- Helpers ---
    parseTimeString(timeStr: string): number {
        const parts = timeStr.split(':').map(Number);
        if (parts.length === 1) return parts[0];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return 0;
    }

    extractVideoId(input: string): string | null {
        if (!input) return null;
        if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
        const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
        const match = input.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    createSlider(container: HTMLElement, callback: (val: number) => void) {
        const slider = container.createEl("input", { 
            type: "range", 
            cls: "zen-slider",
            attr: { min: 0, max: 1, step: 0.05, value: this.currentVolume } 
        });
        slider.oninput = (e: any) => callback(parseFloat(e.target.value));
    }

    formatTime(seconds: number): string {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    async onClose() { 
        // Close時はさすがに止める
        if(this.ytPlayer) this.ytPlayer.pause(); 
    }
}

// ------------------------------------------------------------
// 4. Settings GUI (Modal & Tab)
// ------------------------------------------------------------

// A. Track Editor Modal
class TrackEditorModal extends Modal {
    track: PlaylistItem;
    onSubmit: (track: PlaylistItem) => void;

    constructor(app: App, track: PlaylistItem | null, onSubmit: (track: PlaylistItem) => void) {
        super(app);
        this.track = track ? JSON.parse(JSON.stringify(track)) : { title: "", url: "", checkpoints: [] };
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.track.title ? "Edit Track" : "New Track" });

        // Basic Info
        new Setting(contentEl)
            .setName("Title")
            .setDesc("Display name for the track")
            .addText(text => text.setValue(this.track.title).onChange(value => this.track.title = value));

        new Setting(contentEl)
            .setName("URL")
            .setDesc("YouTube URL")
            .addText(text => text.setValue(this.track.url).onChange(value => this.track.url = value));

        // Checkpoints
        contentEl.createEl("h3", { text: "Checkpoints" });
        const checkpointsContainer = contentEl.createDiv();
        this.renderCheckpoints(checkpointsContainer);

        // Buttons
        const footer = contentEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(footer).setButtonText("Cancel").onClick(() => this.close());
        new ButtonComponent(footer).setButtonText("Save").setCta().onClick(() => {
            if(!this.track.title || !this.track.url) {
                new Notice("Title and URL are required.");
                return;
            }
            this.onSubmit(this.track);
            this.close();
        });
    }

renderCheckpoints(container: HTMLElement) {
        container.empty();
        if (this.track.checkpoints && this.track.checkpoints.length > 0) {
            this.track.checkpoints.forEach((cp, index) => {
                const row = container.createDiv({ cls: "zen-setting-checkpoint-row" });
                row.style.display = "flex";
                row.style.gap = "10px";
                row.style.marginBottom = "10px";
                row.style.alignItems = "center";

                const labelInput = row.createEl("input", { type: "text", value: cp.label, placeholder: "Label" });
                labelInput.style.flex = "2";
                labelInput.onchange = (e: any) => cp.label = e.target.value;

                const timeInput = row.createEl("input", { type: "text", value: cp.time, placeholder: "Time (e.g. 3:20)" });
                timeInput.style.flex = "1";
                timeInput.onchange = (e: any) => cp.time = e.target.value;

                const delBtn = row.createEl("button");
                setIcon(delBtn, "trash");
                delBtn.onclick = () => {
                    this.track.checkpoints?.splice(index, 1);
                    this.renderCheckpoints(container);
                };
            });
        } else {
            // 【修正箇所】styleプロパティをオブジェクト内から除外
            const msg = container.createDiv({ text: "No checkpoints added yet." });
            msg.style.color = "var(--text-muted)";
            msg.style.marginBottom = "10px";
        }
        
        const addBtn = new ButtonComponent(container).setButtonText("+ Add Checkpoint").onClick(() => {
            if (!this.track.checkpoints) this.track.checkpoints = [];
            this.track.checkpoints.push({ label: "", time: "" });
            this.renderCheckpoints(container);
        });
        addBtn.buttonEl.style.width = "100%";
    }

    onClose() { this.contentEl.empty(); }
}

// B. Main Settings Tab
class ZenZoneSettingTab extends PluginSettingTab {
    plugin: ZenZonePlugin;
    constructor(app: App, plugin: ZenZonePlugin) { super(app, plugin); this.plugin = plugin; }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Zen Zone Settings' });
        
        containerEl.createEl('h3', { text: 'Playlist Manager' });
        const listContainer = containerEl.createDiv();
        this.renderTrackList(listContainer);

        const addContainer = containerEl.createDiv({ cls: "zen-setting-add-container" });
        addContainer.style.marginTop = "20px";
        
        new ButtonComponent(addContainer)
            .setButtonText("Add New Track")
            .setCta()
            .onClick(() => {
                new TrackEditorModal(this.app, null, async (newTrack) => {
                    this.plugin.settings.playlistData.push(newTrack);
                    await this.plugin.saveSettings();
                    this.display();
                }).open();
            });
    }

renderTrackList(container: HTMLElement) {
        container.empty();
        this.plugin.settings.playlistData.forEach((track, index) => {
            new Setting(container)
                .setName(track.title)
                .setDesc(track.url)
                .addButton(btn => btn.setIcon("pencil").onClick(() => {
                    new TrackEditorModal(this.app, track, async (updatedTrack) => {
                        this.plugin.settings.playlistData[index] = updatedTrack;
                        await this.plugin.saveSettings();
                        this.display();
                    }).open();
                }))
                .addButton(btn => btn.setIcon("trash").setClass("zen-danger-btn").onClick(async () => {
                    this.plugin.settings.playlistData.splice(index, 1);
                    await this.plugin.saveSettings();
                    this.display();
                    new Notice("Track deleted.");
                }));
        });
        
        if (this.plugin.settings.playlistData.length === 0) {
            // 【修正箇所】styleプロパティをオブジェクト内から除外
            const msg = container.createDiv({ text: "No tracks." });
            msg.style.textAlign = "center";
            msg.style.color = "var(--text-muted)";
            msg.style.padding = "20px";
        }
    }
}

// ------------------------------------------------------------
// 5. Plugin Main Class
// ------------------------------------------------------------
export default class ZenZonePlugin extends Plugin {
    settings: ZenZoneSettings;
    overlayEl: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new ZenZoneSettingTab(this.app, this));
        this.registerView(VIEW_TYPE_ZEN, (leaf) => new ZenView(leaf, this));
        this.addRibbonIcon('zap', 'Open Zen Zone', () => this.activateView());
    }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }

    async activateView() {
        const { workspace } = this.app;
        let leaf: WorkspaceLeaf | null | undefined = workspace.getLeavesOfType(VIEW_TYPE_ZEN)[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            if(leaf) await leaf.setViewState({ type: VIEW_TYPE_ZEN, active: true });
        }
        if(leaf) workspace.revealLeaf(leaf);
    }

    enterZenMode() {
        document.body.classList.add('zen-mode-active');
        if (this.app.workspace.leftSplit) this.app.workspace.leftSplit.collapse();
        if (this.app.workspace.rightSplit) this.app.workspace.rightSplit.collapse();
        new Notice("🧘 Focus Mode On");
    }

    exitZenMode() {
        document.body.classList.remove('zen-mode-active');
        new Notice("Focus Mode Off");
    }

    showBreakOverlay() {
        this.overlayEl = document.body.createDiv({ cls: "zen-break-overlay" });
        const content = this.overlayEl.createDiv({ cls: "zen-break-content" });
        content.createEl("h1", { text: "🎉 Session Complete" });
        content.createDiv({ text: "Take a deep breath." });
        const closeBtn = content.createEl("button", { text: "Return" });
        closeBtn.onclick = () => { if (this.overlayEl) { this.overlayEl.remove(); this.overlayEl = null; } };
    }
}