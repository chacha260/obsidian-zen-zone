import { Plugin, ItemView, WorkspaceLeaf, Notice, PluginSettingTab, App, Setting, setIcon, Modal, ButtonComponent, DropdownComponent } from 'obsidian';

const VIEW_TYPE_ZEN = "zen-zone-view";

// ------------------------------------------------------------
// 0. Constants & Constraints
// ------------------------------------------------------------
const TIME_CONSTRAINTS = {
    work: { min: 15, max: 30, default: 25 },
    shortBreak: { min: 3, max: 10, default: 5 },
    longBreak: { min: 15, max: 30, default: 30 }
};

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

// 音楽設定用の参照型
interface MusicReference {
    trackIndex: number;
    checkpointIndex: number; // -1 の場合は最初から
}

interface ZenZoneSettings {
    playlistData: PlaylistItem[];
    // Time Settings (minutes)
    workDuration: number;
    shortBreakDuration: number;
    longBreakDuration: number;
    // Music Preferences
    workMusic: MusicReference;
    breakMusic: MusicReference;
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
    ],
    workDuration: TIME_CONSTRAINTS.work.default,
    shortBreakDuration: TIME_CONSTRAINTS.shortBreak.default,
    longBreakDuration: TIME_CONSTRAINTS.longBreak.default,
    workMusic: { trackIndex: 0, checkpointIndex: -1 },
    breakMusic: { trackIndex: 1, checkpointIndex: -1 }
}

enum TimerState {
    Idle,
    Focus,      // 作業中
    ShortBreak, // 短い休憩
    LongBreak   // 長い休憩
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
// 3. Main View
// ------------------------------------------------------------
class ZenView extends ItemView {
    plugin: ZenZonePlugin;
    timerInterval: number | null = null;
    timeLeft: number = 0;
    
    // State
    currentState: TimerState = TimerState.Idle;
    cycleCount: number = 0; // 0 to 3 (4 cycles)
    isMusicPlaying: boolean = false; 

    ytPlayer: YouTubeAudio | null = null;
    currentVideoId: string | null = null;
    currentVolume: number = 0.5;

    // UI Elements
    musicBtnEl: HTMLButtonElement | null = null;
    timerDisplayEl: HTMLElement | null = null;
    statusLabelEl: HTMLElement | null = null;
    cycleIndicatorEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ZenZonePlugin) {
        super(leaf);
        this.plugin = plugin;
        // 初期時間は設定から読み込む
        this.timeLeft = this.plugin.settings.workDuration * 60;
    }

    getViewType() { return VIEW_TYPE_ZEN; }
    getDisplayText() { return "Zen Zone"; }
    getIcon() { return "zap"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("zen-view-container");

        const header = container.createDiv({ cls: "zen-header" });
        header.createEl("h2", { text: "Zen Zone" });
        
        this.renderTimerCard(container);
        this.renderAudioCard(container);

        container.createDiv({
            text: "Cycle & Music settings in plugin options.",
            cls: "zen-footer-note"
        });
    }

    renderTimerCard(parent: HTMLElement) {
        const card = parent.createDiv({ cls: "zen-card zen-timer-card" });
        
        // Status & Cycle info
        const metaRow = card.createDiv({ cls: "zen-timer-meta" });
        this.statusLabelEl = metaRow.createDiv({ cls: "zen-status-label", text: "Ready" });
        this.cycleIndicatorEl = metaRow.createDiv({ cls: "zen-cycle-indicator", text: "Cycle: 0/4" });

        // Timer Display
        this.timerDisplayEl = card.createDiv({ cls: "zen-timer-display" });
        this.timerDisplayEl.setText(this.formatTime(this.timeLeft));

        // Controls
        const controls = card.createDiv({ cls: "zen-controls" });
        
        // UI改善: 誤クリック防止のため距離を離す (Flexbox)
        controls.style.display = "flex";
        controls.style.justifyContent = "space-between";
        controls.style.alignItems = "center";
        controls.style.width = "100%";
        controls.style.marginTop = "5px";

        const toggleBtn = controls.createEl("button", { cls: "zen-main-btn" });
        toggleBtn.setText("Start Focus");
        setIcon(toggleBtn, "timer");
        toggleBtn.onclick = () => this.toggleTimer(toggleBtn);
        
        // Reset Button
        const resetBtn = controls.createEl("button", { cls: "zen-sub-btn", text: "Reset" });
        
        // UI改善: リセットボタンに色をつけて目立たせる
        resetBtn.style.backgroundColor = "var(--interactive-accent-hover)"; // 必要に応じて具体的な色コードに変更 (#e74c3c など)
        resetBtn.style.color = "var(--text-on-accent)";
        resetBtn.style.border = "1px solid var(--background-modifier-border)";
        // 注意色にする場合
        resetBtn.style.backgroundColor = "#c0392b"; 
        resetBtn.style.color = "white";

        resetBtn.onclick = () => this.resetSystem(toggleBtn);
    }

    renderAudioCard(parent: HTMLElement) {
        const card = parent.createDiv({ cls: "zen-card zen-audio-card" });
        const playlist = this.plugin.settings.playlistData;
        const playerContainer = card.createDiv({ cls: "zen-player-hidden" });

        // --- Track Selection ---
        const selectWrapper = card.createDiv({ cls: "zen-input-group" });
        selectWrapper.createDiv({ cls: "zen-label", text: "Manual Select" });
        
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

        // --- Checkpoints Container (Reference for re-rendering) ---
        const checkpointsContainer = card.createDiv({ cls: "zen-checkpoints-area" });

        // --- Player Init Logic ---
        const initPlayer = (videoId: string, checkpoints: Checkpoint[]) => {
            this.currentVideoId = videoId;
            this.ytPlayer = new YouTubeAudio(playerContainer, videoId);
            this.ytPlayer.setVolume(this.currentVolume);
            this.renderCheckpoints(checkpointsContainer, checkpoints);

            if (this.isMusicPlaying) {
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

        // --- Playback Controls ---
        const controlsRow = card.createDiv({ cls: "zen-audio-controls-row" });
        controlsRow.style.display = "flex";
        controlsRow.style.alignItems = "center";
        controlsRow.style.gap = "10px";
        controlsRow.style.marginTop = "5px";

        this.musicBtnEl = controlsRow.createEl("button", { cls: "zen-music-btn" });
        setIcon(this.musicBtnEl, "play");
        this.musicBtnEl.onclick = () => this.toggleMusic();

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

        // Expose initPlayer for other methods to use
        this.loadTrackByReference = (ref: MusicReference) => {
            const track = playlist[ref.trackIndex];
            if(!track) return;
            const videoId = this.extractVideoId(track.url);
            if(videoId) {
                // UI上のSelect要素も合わせる（見た目の同期）
                selectEl.value = JSON.stringify({ id: videoId, index: ref.trackIndex });
                initPlayer(videoId, track.checkpoints || []);
                
                // チェックポイント指定があればシーク
                if (ref.checkpointIndex >= 0 && track.checkpoints && track.checkpoints[ref.checkpointIndex]) {
                    const timeStr = track.checkpoints[ref.checkpointIndex].time;
                    const sec = this.parseTimeString(timeStr);
                    // Playerのロード時間を少し待つ必要がある
                    setTimeout(() => {
                        this.ytPlayer?.seekTo(sec);
                        new Notice(`🎵 Loaded: ${track.title} (${track.checkpoints![ref.checkpointIndex].label})`);
                    }, 1500); 
                } else {
                    new Notice(`🎵 Loaded: ${track.title}`);
                }
            }
        };
    }
    
    // 外部からPlayerを操作するためのプレースホルダ関数（renderAudioCard内で実装される）
    loadTrackByReference: (ref: MusicReference) => void = () => {};

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
                    if (!this.isMusicPlaying) this.toggleMusic(); 
                }
            };
        });
    }

    // --- Core Logic: Timer & Cycle ---

    toggleTimer(btn: HTMLButtonElement) {
        if (this.currentState !== TimerState.Idle) {
            // STOP/PAUSE
            this.stopTimer();
            this.currentState = TimerState.Idle;
            btn.setText("Resume Focus");
            btn.removeClass("is-active");
            setIcon(btn, "timer");
            this.plugin.exitZenMode();
            this.updateStatusDisplay();
        } else {
            // START
            // サイクル開始時でなければ再開、0なら初期スタート
            if (this.cycleCount === 0 && this.timeLeft === this.plugin.settings.workDuration * 60) {
                 this.startCycle(TimerState.Focus);
            } else {
                 this.runTimer(); // Resume
            }
            
            this.currentState = (this.timeLeft === this.plugin.settings.workDuration * 60) ? TimerState.Focus : this.currentState;
            if(this.currentState === TimerState.Idle) this.currentState = TimerState.Focus; // Default Fallback

            btn.setText("Stop Focus");
            btn.addClass("is-active");
            setIcon(btn, "x");
            this.plugin.enterZenMode();
            
            // 最初のスタート時、設定された音楽を再生
            if (!this.isMusicPlaying) {
                this.playSceneMusic(this.currentState);
                this.toggleMusic(); // Play
            }
        }
    }

    resetSystem(btn: HTMLButtonElement) {
        this.stopTimer();
        this.currentState = TimerState.Idle;
        this.cycleCount = 0;
        this.timeLeft = this.plugin.settings.workDuration * 60;
        
        if (this.timerDisplayEl) this.timerDisplayEl.setText(this.formatTime(this.timeLeft));
        this.updateStatusDisplay();
        
        btn.setText("Start Focus");
        btn.removeClass("is-active");
        setIcon(btn, "timer");
        this.plugin.exitZenMode();
    }

    startCycle(state: TimerState) {
        this.currentState = state;
        
        // 時間設定
        if (state === TimerState.Focus) {
            this.timeLeft = this.plugin.settings.workDuration * 60;
            // Focus開始時に音楽切り替え
            this.playSceneMusic(TimerState.Focus);
        } else if (state === TimerState.ShortBreak) {
            this.timeLeft = this.plugin.settings.shortBreakDuration * 60;
            // Break開始時に音楽切り替え
            this.playSceneMusic(TimerState.ShortBreak);
        } else if (state === TimerState.LongBreak) {
            this.timeLeft = this.plugin.settings.longBreakDuration * 60;
            // Break開始時に音楽切り替え
            this.playSceneMusic(TimerState.LongBreak);
        }
        
        this.updateStatusDisplay();
        this.runTimer();
    }

    runTimer() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        
        this.timerInterval = window.setInterval(() => {
            this.timeLeft--;
            if (this.timerDisplayEl) this.timerDisplayEl.setText(this.formatTime(this.timeLeft));
            
            if (this.timeLeft <= 0) {
                this.handlePhaseComplete();
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    handlePhaseComplete() {
        this.stopTimer();
        
        // Cycle Logic
        if (this.currentState === TimerState.Focus) {
            // 作業終了 -> 休憩へ
            this.cycleCount++;
            new Notice(`👏 Cycle ${this.cycleCount} Complete!`);
            
            if (this.cycleCount >= 4) {
                // 4回終わったら長い休憩
                this.startCycle(TimerState.LongBreak);
            } else {
                // それ以外は短い休憩
                this.startCycle(TimerState.ShortBreak);
            }
        } else if (this.currentState === TimerState.ShortBreak) {
            // 短休憩終了 -> 作業へ
            new Notice("🔔 Break is over. Back to Focus.");
            this.startCycle(TimerState.Focus);
        } else if (this.currentState === TimerState.LongBreak) {
            // 長休憩終了 -> 全セット完了
            this.plugin.showBreakOverlay();
            this.resetSystem(this.containerEl.querySelector(".zen-main-btn") as HTMLButtonElement);
            new Notice("🎉 All Cycles Complete!");
        }
    }

    playSceneMusic(state: TimerState) {
        // 現在の設定を取得
        let musicRef: MusicReference | null = null;
        if (state === TimerState.Focus) {
            musicRef = this.plugin.settings.workMusic;
        } else {
            musicRef = this.plugin.settings.breakMusic;
        }

        if (musicRef) {
            this.loadTrackByReference(musicRef);
        }
    }

    updateStatusDisplay() {
        if (!this.statusLabelEl || !this.cycleIndicatorEl) return;
        
        let label = "Ready";
        if (this.currentState === TimerState.Focus) label = "🔥 FOCUS";
        else if (this.currentState === TimerState.ShortBreak) label = "☕ Break (Short)";
        else if (this.currentState === TimerState.LongBreak) label = "🌴 Break (Long)";
        
        this.statusLabelEl.setText(label);
        
        // 4サイクル中の何回目かを表示。休憩中もサイクル数は維持または次への準備
        const displayCycle = this.cycleCount < 4 ? this.cycleCount + 1 : 4;
        this.cycleIndicatorEl.setText(`Cycle: ${this.currentState === TimerState.Idle ? 0 : displayCycle}/4`);
    }

    // --- Music Control ---
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
        if(this.ytPlayer) this.ytPlayer.pause(); 
    }
}

// ------------------------------------------------------------
// 4. Settings GUI
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

        new Setting(contentEl).setName("Title").addText(text => text.setValue(this.track.title).onChange(value => this.track.title = value));
        new Setting(contentEl).setName("URL").addText(text => text.setValue(this.track.url).onChange(value => this.track.url = value));

        contentEl.createEl("h3", { text: "Checkpoints" });
        const checkpointsContainer = contentEl.createDiv();
        this.renderCheckpoints(checkpointsContainer);

        const footer = contentEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(footer).setButtonText("Cancel").onClick(() => this.close());
        new ButtonComponent(footer).setButtonText("Save").setCta().onClick(() => {
            if(!this.track.title || !this.track.url) { new Notice("Required fields missing"); return; }
            this.onSubmit(this.track);
            this.close();
        });
    }

    renderCheckpoints(container: HTMLElement) {
        container.empty();
        if (this.track.checkpoints && this.track.checkpoints.length > 0) {
            this.track.checkpoints.forEach((cp, index) => {
                const row = container.createDiv({ cls: "zen-setting-checkpoint-row" });
                row.style.display = "flex"; row.style.gap = "10px"; row.style.marginBottom = "10px";
                
                const labelInput = row.createEl("input", { type: "text", value: cp.label, placeholder: "Label" });
                labelInput.onchange = (e: any) => cp.label = e.target.value;
                const timeInput = row.createEl("input", { type: "text", value: cp.time, placeholder: "Time" });
                timeInput.onchange = (e: any) => cp.time = e.target.value;
                
                const delBtn = row.createEl("button");
                setIcon(delBtn, "trash");
                delBtn.onclick = () => { this.track.checkpoints?.splice(index, 1); this.renderCheckpoints(container); };
            });
        }
        new ButtonComponent(container).setButtonText("+ Add Checkpoint").onClick(() => {
            if (!this.track.checkpoints) this.track.checkpoints = [];
            this.track.checkpoints.push({ label: "", time: "" });
            this.renderCheckpoints(container);
        });
    }
    onClose() { this.contentEl.empty(); }
}

// B. Main Settings Tab (Enhanced)
class ZenZoneSettingTab extends PluginSettingTab {
    plugin: ZenZonePlugin;
    
    // 一時的な値を保持する変数（反映ボタンを押すまで保存しない）
    tempSettings: {
        work: number,
        short: number,
        long: number
    };

    constructor(app: App, plugin: ZenZonePlugin) { 
        super(app, plugin); 
        this.plugin = plugin; 
        this.resetTempSettings();
    }

    resetTempSettings() {
        this.tempSettings = {
            work: this.plugin.settings.workDuration,
            short: this.plugin.settings.shortBreakDuration,
            long: this.plugin.settings.longBreakDuration
        };
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Zen Zone Settings' });
        
        // --- 1. Timer Settings (Enhanced with Sliders + Input + Validation) ---
        containerEl.createEl('h3', { text: '⏱ Timer Configuration' });
        
        // Work Duration
        this.createTimeSetting(
            containerEl, 
            "作業時間 (Focus)", 
            `基本: ${TIME_CONSTRAINTS.work.default}分 | 範囲: ${TIME_CONSTRAINTS.work.min} - ${TIME_CONSTRAINTS.work.max}分`,
            TIME_CONSTRAINTS.work,
            'work'
        );

        // Short Break
        this.createTimeSetting(
            containerEl, 
            "小休憩 (Short Break)", 
            `基本: ${TIME_CONSTRAINTS.shortBreak.default}分 | 範囲: ${TIME_CONSTRAINTS.shortBreak.min} - ${TIME_CONSTRAINTS.shortBreak.max}分`,
            TIME_CONSTRAINTS.shortBreak,
            'short'
        );

        // Long Break
        this.createTimeSetting(
            containerEl, 
            "大休憩 (Long Break)", 
            `基本: ${TIME_CONSTRAINTS.longBreak.default}分 | 範囲: ${TIME_CONSTRAINTS.longBreak.min} - ${TIME_CONSTRAINTS.longBreak.max}分`,
            TIME_CONSTRAINTS.longBreak,
            'long'
        );

        // --- Apply Button for Time Settings ---
        const btnContainer = containerEl.createDiv({ cls: "zen-setting-apply-container" });
        btnContainer.style.marginTop = "20px";
        btnContainer.style.marginBottom = "30px";
        btnContainer.style.textAlign = "right";

        new ButtonComponent(btnContainer)
            .setButtonText("設定を保存・反映")
            .setCta() // Call to Action color
            .onClick(async () => {
                this.saveTimeSettings();
            });


        // --- 2. Music Automation Settings ---
        containerEl.createEl('h3', { text: '🎵 Scene Music' });
        containerEl.createDiv({ text: "Automatically switch music when phase changes.", cls: "setting-item-description" });

        this.addMusicSetting(containerEl, "Work Music", "Music to play during Focus", this.plugin.settings.workMusic);
        this.addMusicSetting(containerEl, "Break Music", "Music to play during Break", this.plugin.settings.breakMusic);

        // --- 3. Playlist Manager ---
        containerEl.createEl('h3', { text: 'Playlist Manager' });
        const listContainer = containerEl.createDiv();
        this.renderTrackList(listContainer);
        
        const addContainer = containerEl.createDiv({ cls: "zen-setting-add-container" });
        addContainer.style.marginTop = "20px";
        new ButtonComponent(addContainer).setButtonText("Add New Track").setCta().onClick(() => {
            new TrackEditorModal(this.app, null, async (newTrack) => {
                this.plugin.settings.playlistData.push(newTrack);
                await this.plugin.saveSettings();
                this.display();
            }).open();
        });
    }

    // Helper to create sync slider + input
    createTimeSetting(container: HTMLElement, name: string, desc: string, limits: {min: number, max: number}, key: 'work'|'short'|'long') {
        const setting = new Setting(container)
            .setName(name)
            .setDesc(desc);

        // 1. Slider
        setting.addSlider(slider => {
            slider.setLimits(limits.min, limits.max, 1);
            slider.setValue(this.tempSettings[key]);
            slider.setDynamicTooltip();
            slider.onChange(val => {
                this.tempSettings[key] = val;
                // テキストボックスも更新 (DOM操作で簡易的に同期)
                const inputEl = setting.controlEl.querySelector(`input[type="number"]`) as HTMLInputElement;
                if(inputEl) inputEl.value = val.toString();
            });
        });

        // 2. Number Input (addTextを使い、属性をnumberにする)
        setting.addText(text => {
            text.inputEl.type = "number";
            text.inputEl.style.width = "60px";
            text.setValue(this.tempSettings[key].toString());
            text.onChange(val => {
                const num = parseInt(val);
                if (!isNaN(num)) {
                    this.tempSettings[key] = num;
                    // スライダーも更新
                    const sliderEl = setting.controlEl.querySelector(`input[type="range"]`) as HTMLInputElement;
                    if(sliderEl) sliderEl.value = num.toString();
                }
            });
        });
    }

    async saveTimeSettings() {
        // バリデーションとクランプ処理
        const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

        // Work
        const wLimit = TIME_CONSTRAINTS.work;
        const newWork = clamp(this.tempSettings.work, wLimit.min, wLimit.max);

        // Short
        const sLimit = TIME_CONSTRAINTS.shortBreak;
        const newShort = clamp(this.tempSettings.short, sLimit.min, sLimit.max);

        // Long
        const lLimit = TIME_CONSTRAINTS.longBreak;
        const newLong = clamp(this.tempSettings.long, lLimit.min, lLimit.max);

        // 設定の保存
        this.plugin.settings.workDuration = newWork;
        this.plugin.settings.shortBreakDuration = newShort;
        this.plugin.settings.longBreakDuration = newLong;
        
        await this.plugin.saveSettings();
        
        // Temp変数を保存された値で更新
        this.resetTempSettings();

        // UIリフレッシュ (自動補正された値を表示するため)
        this.display();
        
        new Notice("Time settings saved and applied! (Values clamped to limits)");
    }

    addMusicSetting(container: HTMLElement, name: string, desc: string, targetRef: MusicReference) {
        const setting = new Setting(container)
            .setName(name)
            .setDesc(desc);

        // Track Selector
        setting.addDropdown(dropdown => {
            this.plugin.settings.playlistData.forEach((track, idx) => {
                dropdown.addOption(idx.toString(), track.title);
            });
            dropdown.setValue(targetRef.trackIndex.toString());
            dropdown.onChange(async (val) => {
                targetRef.trackIndex = parseInt(val);
                // トラックが変わったらチェックポイントはリセット
                targetRef.checkpointIndex = -1; 
                await this.plugin.saveSettings();
                this.display(); // チェックポイントのDropdownを更新するためにリロード
            });
        });

        // Checkpoint Selector (Optional)
        setting.addDropdown(dropdown => {
            dropdown.addOption("-1", "Start from beginning");
            const selectedTrack = this.plugin.settings.playlistData[targetRef.trackIndex];
            if (selectedTrack && selectedTrack.checkpoints) {
                selectedTrack.checkpoints.forEach((cp, idx) => {
                    dropdown.addOption(idx.toString(), `${cp.label} (${cp.time})`);
                });
            }
            dropdown.setValue(targetRef.checkpointIndex.toString());
            dropdown.onChange(async (val) => {
                targetRef.checkpointIndex = parseInt(val);
                await this.plugin.saveSettings();
            });
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
        content.createDiv({ text: "Great work! You've completed 4 cycles." });
        const closeBtn = content.createEl("button", { text: "Finish" });
        closeBtn.onclick = () => { if (this.overlayEl) { this.overlayEl.remove(); this.overlayEl = null; } };
    }
}