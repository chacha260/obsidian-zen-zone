import { 
    Plugin, ItemView, WorkspaceLeaf, Notice, PluginSettingTab, App, 
    Setting, setIcon, Modal, ButtonComponent, moment, normalizePath, TFile
} from 'obsidian';

const VIEW_TYPE_ZEN = "zen-zone-view";

// ------------------------------------------------------------
// 0. Constants & Constraints
// ------------------------------------------------------------
const TIME_CONSTRAINTS = {
    work: { min: 15, max: 60, default: 25 },
    shortBreak: { min: 3, max: 15, default: 5 },
    longBreak: { min: 15, max: 45, default: 30 }
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

interface MusicReference {
    trackIndex: number;
    checkpointIndex: number; // -1 の場合は最初から
}

interface TaskItem {
    id: string;
    content: string;
    completed: boolean;
    header?: string;
    filePath?: string;
}

interface ZenZoneSettings {
    playlistData: PlaylistItem[];
    // Time Settings (minutes)
    workDuration: number;
    shortBreakDuration: number;
    longBreakDuration: number;
    // Preferences
    autoCollapseSidebars: boolean;
    hideHeader: boolean;
    autoLogToDaily: boolean;
    showStatusBarTimer: boolean;
    // Task Data
    tasks: TaskItem[];
    // Music Preferences (4 cycles)
    workMusic: MusicReference[];
    breakMusic: MusicReference[];
    // Daily Note Settings
    dailyNoteFormat: string;
    dailyNoteFolder: string;
    dailyNoteTargetHeader: string;
}

const DEFAULT_MUSIC_REF_WORK: MusicReference = { trackIndex: 0, checkpointIndex: -1 };
const DEFAULT_MUSIC_REF_BREAK: MusicReference = { trackIndex: 1, checkpointIndex: -1 };

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
        },
        { 
            title: "🌧 Rain Sounds", 
            url: "https://www.youtube.com/watch?v=mPZkdNFkNps",
            checkpoints: []
        }
    ],
    workDuration: TIME_CONSTRAINTS.work.default,
    shortBreakDuration: TIME_CONSTRAINTS.shortBreak.default,
    longBreakDuration: TIME_CONSTRAINTS.longBreak.default,
    autoCollapseSidebars: false,
    hideHeader: false,
    autoLogToDaily: false,
    showStatusBarTimer: false,
    tasks: [],
    workMusic: Array(4).fill(null).map(() => ({ ...DEFAULT_MUSIC_REF_WORK })),
    breakMusic: Array(4).fill(null).map(() => ({ ...DEFAULT_MUSIC_REF_BREAK })),
    dailyNoteFormat: "YYYY-MM-DD",
    dailyNoteFolder: "",
    dailyNoteTargetHeader: "Todo"
}

enum TimerState {
    Idle,
    Focus,
    ShortBreak,
    LongBreak
}

// ------------------------------------------------------------
// 2. YouTube Iframe Wrapper (Playlist Fix Applied)
// ------------------------------------------------------------
class YouTubeAudio {
    private iframe: HTMLIFrameElement;
    
    constructor(container: HTMLElement, videoId: string | null, listId: string | null) {
        const existing = container.querySelector('iframe');
        if (existing) existing.remove();

        this.iframe = container.createEl("iframe");
        this.iframe.width = "0";
        this.iframe.height = "0";
        
        let srcUrl = "https://www.youtube.com/embed/";
        
        if (videoId) {
            srcUrl += `${videoId}?enablejsapi=1&controls=0`;
            if (listId) {
                srcUrl += `&list=${listId}`;
            } else {
                srcUrl += `&loop=1&playlist=${videoId}`;
            }
        } else if (listId) {
            srcUrl += `?enablejsapi=1&controls=0&listType=playlist&list=${listId}`;
        }

        this.iframe.src = srcUrl;
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
    
    currentState: TimerState = TimerState.Idle;
    cycleCount: number = 0;
    isMusicPlaying: boolean = false; 

    ytPlayer: YouTubeAudio | null = null;
    currentVideoId: string | null = null;
    currentVolume: number = 0.5;

    // UI Elements
    taskCardEl: HTMLElement | null = null;
    musicBtnEl: HTMLButtonElement | null = null;
    timerDisplayEl: HTMLElement | null = null;
    statusLabelEl: HTMLElement | null = null;
    cycleIndicatorEl: HTMLElement | null = null;
    
    // Drag & Drop State
    dragSrcIndex: number = -1;
    taskListHeight: string | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ZenZonePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.timeLeft = this.plugin.settings.workDuration * 60;
    }

    getViewType() { return VIEW_TYPE_ZEN; }
    getDisplayText() { return "Zen Zone"; }
    getIcon() { return "zap"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("zen-view-container");

        // Inject Styles for Resizer
        const styleId = "zen-zone-styles";
        if (!document.getElementById(styleId)) {
            const style = document.createElement("style");
            style.id = styleId;
            style.innerHTML = `
                .zen-task-list-wrapper::-webkit-resizer {
                    background-color: var(--interactive-accent);
                    border-radius: 4px;
                    border: 2px solid var(--background-secondary);
                }
                .zen-task-list-wrapper { padding-bottom: 10px; }
            `;
            document.head.appendChild(style);
        }

        const header = container.createDiv({ cls: "zen-header" });
        header.createEl("h2", { text: "Zen Zone" }).style.margin = "10px 0 5px 0";
        
        // Task Card
        this.taskCardEl = container.createDiv({ cls: "zen-card zen-task-card" });
        this.renderTaskCard(this.taskCardEl);

        // Timer Card
        const timerCardEl = container.createDiv();
        this.renderTimerCard(timerCardEl);

        // Audio Card
        const audioCardEl = container.createDiv();
        this.renderAudioCard(audioCardEl);

        container.createDiv({
            text: "Cycle & Music settings in plugin options.",
            cls: "zen-footer-note"
        });
    }

    // --- Task UI ---
    renderTaskCard(container: HTMLElement) {
        container.empty();

        const focusWrapper = container.createDiv({ cls: "zen-task-focus-wrapper" });
        focusWrapper.createDiv({ text: "🔥 Current Focus", cls: "zen-sub-label" });

        const activeTask = this.plugin.settings.tasks[0];
        const focusDisplay = focusWrapper.createDiv({ cls: "zen-task-focus-display" });

        if (activeTask) {
            const cb = focusDisplay.createEl("input", { type: "checkbox", cls: "zen-task-cb-large" });
            cb.checked = false;
            cb.onclick = async () => {
                cb.checked = true;
                setTimeout(async () => {
                    const idx = this.plugin.settings.tasks.indexOf(activeTask);
                    if (idx > -1) {
                        await this.plugin.manageDailyTask(activeTask.content, activeTask.header, 'complete', activeTask.filePath);
                        this.plugin.settings.tasks.splice(idx, 1);
                        await this.plugin.saveSettings();
                        this.renderTaskCardRefresh();
                        new Notice("Task Completed! 🎉");
                    }
                }, 500);
            };

            const textSpan = focusDisplay.createSpan({ text: activeTask.content, cls: "zen-task-text-large" });
            if (activeTask.header) {
                const headerTag = textSpan.createSpan({ text: ` [${activeTask.header}]`, cls: "zen-task-header-tag" });
                headerTag.setAttribute("style", "font-size: 0.6em; color: var(--text-muted); margin-left: 8px; vertical-align: middle;");
            }
        } else {
            focusDisplay.createSpan({ text: "No active tasks. Great job! 🎉", cls: "zen-task-text-placeholder" });
        }

        const inputWrapper = container.createDiv({ cls: "zen-task-input-wrapper" });
        const defaultHeader = this.plugin.settings.dailyNoteTargetHeader || "Todo";
        const headerInput = inputWrapper.createEl("input", { type: "text", placeholder: defaultHeader, cls: "zen-task-add-input" });
        headerInput.style.flexGrow = "0";
        headerInput.style.width = "80px";
        headerInput.style.minWidth = "60px";
        headerInput.title = "Target Header (Optional)";

        const taskInput = inputWrapper.createEl("input", { type: "text", placeholder: "Add a new task...", cls: "zen-task-add-input" });

        const handleAddTask = async () => {
            if (!taskInput.value.trim()) return;
            const todayStr = moment().format(this.plugin.settings.dailyNoteFormat);
            const folder = this.plugin.settings.dailyNoteFolder ? normalizePath(this.plugin.settings.dailyNoteFolder) : "";
            const filePath = folder ? `${folder}/${todayStr}.md` : `${todayStr}.md`;
            
            const newTask: TaskItem = {
                id: Date.now().toString(),
                content: taskInput.value.trim(),
                completed: false,
                header: headerInput.value.trim() || undefined,
                filePath: filePath
            };

            this.plugin.settings.tasks.push(newTask);
            await this.plugin.manageDailyTask(newTask.content, newTask.header, 'add', filePath);
            await this.plugin.saveSettings();
            
            taskInput.value = "";
            this.renderTaskCardRefresh();
        };

        taskInput.addEventListener("keypress", (e) => { if (e.key === "Enter") handleAddTask(); });
        headerInput.addEventListener("keypress", (e) => { if (e.key === "Enter") taskInput.focus(); });

        const addBtn = inputWrapper.createEl("button", { text: "+", cls: "zen-task-add-btn" });
        addBtn.onclick = handleAddTask;

        const listWrapper = container.createDiv({ cls: "zen-task-list-wrapper" });
        listWrapper.style.resize = "vertical";
        listWrapper.style.overflow = "auto";
        listWrapper.style.minHeight = "100px";
        listWrapper.style.maxHeight = "none";
        listWrapper.style.paddingBottom = "5px";
        
        if (this.taskListHeight) {
            listWrapper.style.height = this.taskListHeight;
        } else {
            listWrapper.style.height = "200px";
        }

        listWrapper.addEventListener('dragover', (e) => { e.preventDefault(); if(e.dataTransfer) e.dataTransfer.dropEffect = 'move'; });
        listWrapper.addEventListener('drop', async (e) => {
            e.preventDefault();
            if (e.target === listWrapper && this.dragSrcIndex > -1) {
                const tasks = this.plugin.settings.tasks;
                const [moved] = tasks.splice(this.dragSrcIndex, 1);
                tasks.push(moved);
                await this.plugin.saveSettings();
                this.renderTaskCardRefresh();
                this.dragSrcIndex = -1;
            }
        });

        if (this.plugin.settings.tasks.length > 0) {
            this.plugin.settings.tasks.forEach((task, index) => {
                const row = listWrapper.createDiv({ cls: "zen-task-row" });
                row.draggable = true;
                row.style.cursor = "move";

                row.addEventListener('dragstart', (e) => {
                    this.dragSrcIndex = index;
                    row.style.opacity = '0.4';
                    if(e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', index.toString());
                    }
                });

                row.addEventListener('dragover', (e) => { e.preventDefault(); if(e.dataTransfer) e.dataTransfer.dropEffect = 'move'; return false; });
                row.addEventListener('drop', async (e) => {
                    e.stopPropagation();
                    if (this.dragSrcIndex !== index && this.dragSrcIndex > -1) {
                        const tasks = this.plugin.settings.tasks;
                        const [movedTask] = tasks.splice(this.dragSrcIndex, 1);
                        tasks.splice(index, 0, movedTask);
                        await this.plugin.saveSettings();
                        this.renderTaskCardRefresh();
                    }
                    return false;
                });
                row.addEventListener('dragend', () => { row.style.opacity = '1'; this.dragSrcIndex = -1; });

                const cb = row.createEl("input", { type: "checkbox", cls: "zen-task-cb" });
                cb.checked = false;
                cb.onclick = async () => {
                    cb.checked = true;
                    row.addClass('is-completed');
                    setTimeout(async () => {
                        const idx = this.plugin.settings.tasks.indexOf(task);
                        if (idx > -1) {
                            await this.plugin.manageDailyTask(task.content, task.header, 'complete', task.filePath);
                            this.plugin.settings.tasks.splice(idx, 1);
                            await this.plugin.saveSettings();
                            this.renderTaskCardRefresh();
                        }
                    }, 500);
                };

                const textSpan = row.createSpan({ cls: "zen-task-text" });
                textSpan.setText(task.content);
                if (task.header) {
                    const hSpan = textSpan.createSpan({ text: ` #${task.header}` });
                    hSpan.style.color = "var(--text-muted)";
                    hSpan.style.fontSize = "0.85em";
                    hSpan.style.marginLeft = "8px";
                }

                const controls = row.createDiv({ cls: "zen-task-row-controls" });

                if (index > 0) {
                    const upBtn = controls.createEl("button", { cls: "zen-task-control-btn" });
                    setIcon(upBtn, "arrow-up");
                    upBtn.onclick = async () => {
                        [this.plugin.settings.tasks[index], this.plugin.settings.tasks[index - 1]] = [this.plugin.settings.tasks[index - 1], this.plugin.settings.tasks[index]];
                        await this.plugin.saveSettings();
                        this.renderTaskCardRefresh();
                    };
                }

                if (index < this.plugin.settings.tasks.length - 1) {
                    const downBtn = controls.createEl("button", { cls: "zen-task-control-btn" });
                    setIcon(downBtn, "arrow-down");
                    downBtn.onclick = async () => {
                        [this.plugin.settings.tasks[index], this.plugin.settings.tasks[index + 1]] = [this.plugin.settings.tasks[index + 1], this.plugin.settings.tasks[index]];
                        await this.plugin.saveSettings();
                        this.renderTaskCardRefresh();
                    };
                }

                const delBtn = controls.createEl("button", { cls: "zen-task-control-btn is-danger" });
                setIcon(delBtn, "trash");
                delBtn.onclick = async () => {
                    await this.plugin.manageDailyTask(task.content, task.header, 'delete', task.filePath);
                    this.plugin.settings.tasks.splice(index, 1);
                    await this.plugin.saveSettings();
                    this.renderTaskCardRefresh();
                };
            });
        }
    }

    renderTaskCardRefresh() {
        if (this.taskCardEl) {
            const listWrapper = this.taskCardEl.querySelector(".zen-task-list-wrapper") as HTMLElement;
            if (listWrapper) {
                this.taskListHeight = listWrapper.style.height || `${listWrapper.offsetHeight}px`;
            }
            this.renderTaskCard(this.taskCardEl);
        }
    }

    // --- Timer UI ---
    renderTimerCard(parent: HTMLElement) {
        const card = parent.createDiv({ cls: "zen-card zen-timer-card" });
        card.style.padding = "10px";
        
        const metaRow = card.createDiv({ cls: "zen-timer-meta" });
        this.statusLabelEl = metaRow.createDiv({ cls: "zen-status-label", text: "Ready" });
        this.cycleIndicatorEl = metaRow.createDiv({ cls: "zen-cycle-indicator", text: "Cycle: 0/4" });

        this.timerDisplayEl = card.createDiv({ cls: "zen-timer-display" });
        this.timerDisplayEl.setText(this.formatTime(this.timeLeft));
        this.timerDisplayEl.style.fontSize = "3.5rem";
        this.timerDisplayEl.style.margin = "10px 0";

        const controls = card.createDiv({ cls: "zen-controls" });
        controls.style.display = "flex";
        controls.style.justifyContent = "space-between";
        controls.style.alignItems = "center";
        controls.style.width = "100%";
        controls.style.marginTop = "10px";

        const toggleBtn = controls.createEl("button", { cls: "zen-main-btn" });
        toggleBtn.setText("Start Focus");
        setIcon(toggleBtn, "timer");
        toggleBtn.onclick = () => this.toggleTimer(toggleBtn);
        
        const resetBtn = controls.createEl("button", { cls: "zen-sub-btn", text: "Reset" });
        resetBtn.style.backgroundColor = "#c0392b"; 
        resetBtn.style.color = "white";
        resetBtn.onclick = () => this.resetSystem(toggleBtn);
    }

    // --- Audio UI ---
    renderAudioCard(parent: HTMLElement) {
        const card = parent.createDiv({ cls: "zen-card zen-audio-card" });
        card.style.padding = "10px";
        const playlist = this.plugin.settings.playlistData;
        const playerContainer = card.createDiv({ cls: "zen-player-hidden" });

        const selectWrapper = card.createDiv({ cls: "zen-input-group" });
        selectWrapper.createDiv({ cls: "zen-label", text: "Manual Select" });
        
        const selectEl = selectWrapper.createEl("select", { cls: "zen-select" });
        
        let firstValidInfo: { videoId: string|null, listId: string|null } | null = null;
        let currentTrackCheckpoints: Checkpoint[] = [];

        playlist.forEach((track, index) => {
            const info = this.extractYouTubeInfo(track.url);
            if (info.videoId || info.listId) {
                const option = selectEl.createEl("option", { text: track.title });
                option.value = JSON.stringify({ info: info, index: index });
                if (!firstValidInfo) {
                    firstValidInfo = info;
                    currentTrackCheckpoints = track.checkpoints || [];
                }
            }
        });

        const checkpointsContainer = card.createDiv({ cls: "zen-checkpoints-area" });

        const initPlayer = (info: {videoId: string|null, listId: string|null}, checkpoints: Checkpoint[]) => {
            this.currentVideoId = info.videoId;
            this.ytPlayer = new YouTubeAudio(playerContainer, info.videoId, info.listId);
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

        if (firstValidInfo) initPlayer(firstValidInfo, currentTrackCheckpoints);

        selectEl.onchange = () => {
            try {
                const val = JSON.parse(selectEl.value);
                const track = playlist[val.index];
                initPlayer(val.info, track.checkpoints || []);
            } catch(e) { console.error(e); }
        };

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

        this.loadTrackByReference = (ref: MusicReference) => {
            const track = playlist[ref.trackIndex];
            if(!track) return;
            const info = this.extractYouTubeInfo(track.url);
            if(info.videoId || info.listId) {
                selectEl.value = JSON.stringify({ info: info, index: ref.trackIndex });
                initPlayer(info, track.checkpoints || []);
                
                if (ref.checkpointIndex >= 0 && track.checkpoints && track.checkpoints[ref.checkpointIndex]) {
                    const timeStr = track.checkpoints[ref.checkpointIndex].time;
                    const sec = this.parseTimeString(timeStr);
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
            this.stopTimer();
            this.currentState = TimerState.Idle;
            btn.setText("Resume Focus");
            btn.removeClass("is-active");
            setIcon(btn, "timer");
            this.plugin.exitZenMode();
            this.updateStatusDisplay();
            this.plugin.updateStatusBar("");
        } else {
            if (this.cycleCount === 0 && this.timeLeft === this.plugin.settings.workDuration * 60) {
                 this.startCycle(TimerState.Focus);
            } else {
                 this.runTimer(); 
            }
            
            this.currentState = (this.timeLeft === this.plugin.settings.workDuration * 60) ? TimerState.Focus : this.currentState;
            if(this.currentState === TimerState.Idle) this.currentState = TimerState.Focus;

            btn.setText("Stop Focus");
            btn.addClass("is-active");
            setIcon(btn, "x");
            this.plugin.enterZenMode();
            
            if (!this.isMusicPlaying) {
                this.playSceneMusic(this.currentState);
                this.toggleMusic();
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
        this.plugin.updateStatusBar("");
    }

    startCycle(state: TimerState) {
        this.currentState = state;
        
        if (state === TimerState.Focus) {
            this.timeLeft = this.plugin.settings.workDuration * 60;
        } else if (state === TimerState.ShortBreak) {
            this.timeLeft = this.plugin.settings.shortBreakDuration * 60;
        } else if (state === TimerState.LongBreak) {
            this.timeLeft = this.plugin.settings.longBreakDuration * 60;
        }
        
        this.playSceneMusic(state);
        this.updateStatusDisplay();
        this.runTimer();
    }

    runTimer() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        
        this.timerInterval = window.setInterval(() => {
            this.timeLeft--;
            const timeStr = this.formatTime(this.timeLeft);
            if (this.timerDisplayEl) this.timerDisplayEl.setText(timeStr);
            
            let icon = "⏳";
            if(this.currentState === TimerState.Focus) icon = "🔥";
            else if(this.currentState !== TimerState.Idle) icon = "☕";
            
            this.plugin.updateStatusBar(`${icon} ${timeStr}`);
            
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
        
        if (this.currentState === TimerState.Focus) {
            if (this.cycleCount >= 3) { // 0, 1, 2, 3(4th) -> Long Break
                this.startCycle(TimerState.LongBreak);
            } else {
                this.startCycle(TimerState.ShortBreak);
            }
        } else if (this.currentState === TimerState.ShortBreak) {
            this.cycleCount++;
            new Notice("🔔 Break is over. Back to Focus.");
            this.startCycle(TimerState.Focus);
        } else if (this.currentState === TimerState.LongBreak) {
            this.cycleCount++;
            this.plugin.showBreakOverlay();
            this.resetSystem(this.containerEl.querySelector(".zen-main-btn") as HTMLButtonElement);
            new Notice("🎉 All Cycles Complete!");
        }
    }

    playSceneMusic(state: TimerState) {
        const cycleIdx = Math.min(this.cycleCount, 3);
        let musicRef: MusicReference | null = null;
        
        if (state === TimerState.Focus) {
            musicRef = this.plugin.settings.workMusic[cycleIdx];
        } else {
            musicRef = this.plugin.settings.breakMusic[cycleIdx];
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
        
        const displayCycle = this.currentState === TimerState.Idle ? 0 : this.cycleCount + 1;
        this.cycleIndicatorEl.setText(`Cycle: ${Math.min(displayCycle, 4)}/4`);
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

    extractYouTubeInfo(input: string): { videoId: string | null, listId: string | null } {
        if (!input) return { videoId: null, listId: null };
        
        let videoId: string | null = null;
        let listId: string | null = null;

        const listMatch = input.match(/[?&]list=([a-zA-Z0-9_-]+)/);
        if (listMatch) {
            listId = listMatch[1];
        }

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

class ZenZoneSettingTab extends PluginSettingTab {
    plugin: ZenZonePlugin;
    tempSettings: { work: number, short: number, long: number };

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
        
        // --- General Settings ---
        containerEl.createEl('h3', { text: '⚙️ General' });
        new Setting(containerEl)
            .setName('Auto-collapse Sidebars')
            .setDesc('作業開始時にサイドバー（左右）を自動で閉じる')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.autoCollapseSidebars).onChange(async (val) => {
                this.plugin.settings.autoCollapseSidebars = val;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('Hide Header & UI Elements')
            .setDesc('作業開始時に上部のヘッダーやリボン等を非表示にする')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.hideHeader).onChange(async (val) => {
                this.plugin.settings.hideHeader = val;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl)
            .setName('Show Timer in Status Bar')
            .setDesc('ステータスバーに残り時間を表示する')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.showStatusBarTimer).onChange(async (val) => {
                this.plugin.settings.showStatusBarTimer = val;
                await this.plugin.saveSettings();
            }));

        // --- Daily Note Logging ---
        containerEl.createEl('h3', { text: '📝 Daily Note Logging' });
        new Setting(containerEl)
            .setName('Enable Auto-Log')
            .setDesc('タスク作成時にDaily Noteへ追記し、完了時に時間を記録する')
            .addToggle(toggle => toggle.setValue(this.plugin.settings.autoLogToDaily).onChange(async (val) => {
                this.plugin.settings.autoLogToDaily = val;
                await this.plugin.saveSettings();
                this.display(); // re-render to show/hide folder settings
            }));

        if (this.plugin.settings.autoLogToDaily) {
            new Setting(containerEl)
                .setName('Daily Note Folder')
                .setDesc('Daily Noteの保存フォルダ (例: DailyNotes)。空欄はルート。')
                .addText(text => text.setPlaceholder('DailyNotes').setValue(this.plugin.settings.dailyNoteFolder).onChange(async (val) => {
                    this.plugin.settings.dailyNoteFolder = val;
                    await this.plugin.saveSettings();
                }));
            new Setting(containerEl)
                .setName('Date Format')
                .setDesc('ファイル名の日付形式 (例: YYYY-MM-DD)')
                .addText(text => text.setPlaceholder('YYYY-MM-DD').setValue(this.plugin.settings.dailyNoteFormat).onChange(async (val) => {
                    this.plugin.settings.dailyNoteFormat = val;
                    await this.plugin.saveSettings();
                }));
            new Setting(containerEl)
                .setName('Default Target Header')
                .setDesc('タスクを追加するデフォルトの見出し名')
                .addText(text => text.setPlaceholder('Todo').setValue(this.plugin.settings.dailyNoteTargetHeader).onChange(async (val) => {
                    this.plugin.settings.dailyNoteTargetHeader = val;
                    await this.plugin.saveSettings();
                }));
        }

        // --- Timer Configuration ---
        containerEl.createEl('h3', { text: '⏱ Timer Configuration' });
        this.createTimeSetting(containerEl, "作業時間 (Focus)", `基本: ${TIME_CONSTRAINTS.work.default}分 | 範囲: ${TIME_CONSTRAINTS.work.min} - ${TIME_CONSTRAINTS.work.max}分`, TIME_CONSTRAINTS.work, 'work');
        this.createTimeSetting(containerEl, "小休憩 (Short Break)", `基本: ${TIME_CONSTRAINTS.shortBreak.default}分 | 範囲: ${TIME_CONSTRAINTS.shortBreak.min} - ${TIME_CONSTRAINTS.shortBreak.max}分`, TIME_CONSTRAINTS.shortBreak, 'short');
        this.createTimeSetting(containerEl, "大休憩 (Long Break)", `基本: ${TIME_CONSTRAINTS.longBreak.default}分 | 範囲: ${TIME_CONSTRAINTS.longBreak.min} - ${TIME_CONSTRAINTS.longBreak.max}分`, TIME_CONSTRAINTS.longBreak, 'long');

        const btnContainer = containerEl.createDiv({ cls: "zen-setting-apply-container" });
        btnContainer.style.marginTop = "10px";
        btnContainer.style.marginBottom = "10px";
        btnContainer.style.textAlign = "right";
        new ButtonComponent(btnContainer).setButtonText("設定を保存・反映").setCta().onClick(async () => {
            this.saveTimeSettings();
        });

        // --- Cycle Music Schedule ---
        containerEl.createEl('h3', { text: '🎵 Cycle Music Schedule' });
        containerEl.createDiv({ text: "Configure different music for each of the 4 cycles.", cls: "setting-item-description" });

        for (let i = 0; i < 4; i++) {
            const isLongBreak = (i === 3);
            containerEl.createEl('h4', { text: `Cycle ${i + 1}`, cls: "zen-cycle-header" });
            this.addMusicSetting(containerEl, "Focus Music", "", this.plugin.settings.workMusic[i]);
            this.addMusicSetting(containerEl, `Break Music (${isLongBreak ? "Long" : "Short"})`, "", this.plugin.settings.breakMusic[i]);
        }

        // --- Playlist Manager ---
        containerEl.createEl('h3', { text: 'Playlist Manager' });
        const listContainer = containerEl.createDiv();
        this.renderTrackList(listContainer);
        
        const addContainer = containerEl.createDiv({ cls: "zen-setting-add-container" });
        addContainer.style.marginTop = "10px";
        new ButtonComponent(addContainer).setButtonText("Add New Track").setCta().onClick(() => {
            new TrackEditorModal(this.app, null, async (newTrack) => {
                this.plugin.settings.playlistData.push(newTrack);
                await this.plugin.saveSettings();
                this.display();
            }).open();
        });
    }

    createTimeSetting(container: HTMLElement, name: string, desc: string, limits: {min: number, max: number}, key: 'work'|'short'|'long') {
        const setting = new Setting(container).setName(name).setDesc(desc);

        setting.addSlider(slider => {
            slider.setLimits(limits.min, limits.max, 1);
            slider.setValue(this.tempSettings[key]);
            slider.setDynamicTooltip();
            slider.onChange(val => {
                this.tempSettings[key] = val;
                const inputEl = setting.controlEl.querySelector(`input[type="number"]`) as HTMLInputElement;
                if(inputEl) inputEl.value = val.toString();
            });
        });

        setting.addText(text => {
            text.inputEl.type = "number";
            text.inputEl.style.width = "60px";
            text.setValue(this.tempSettings[key].toString());
            text.onChange(val => {
                const num = parseInt(val);
                if (!isNaN(num)) {
                    this.tempSettings[key] = num;
                    const sliderEl = setting.controlEl.querySelector(`input[type="range"]`) as HTMLInputElement;
                    if(sliderEl) sliderEl.value = num.toString();
                }
            });
        });
    }

    async saveTimeSettings() {
        const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);
        this.plugin.settings.workDuration = clamp(this.tempSettings.work, TIME_CONSTRAINTS.work.min, TIME_CONSTRAINTS.work.max);
        this.plugin.settings.shortBreakDuration = clamp(this.tempSettings.short, TIME_CONSTRAINTS.shortBreak.min, TIME_CONSTRAINTS.shortBreak.max);
        this.plugin.settings.longBreakDuration = clamp(this.tempSettings.long, TIME_CONSTRAINTS.longBreak.min, TIME_CONSTRAINTS.longBreak.max);
        
        await this.plugin.saveSettings();
        this.resetTempSettings();
        this.display();
        new Notice("Time settings saved!");
    }

    addMusicSetting(container: HTMLElement, name: string, desc: string, targetRef: MusicReference) {
        const setting = new Setting(container).setName(name).setDesc(desc);

        setting.addDropdown(dropdown => {
            this.plugin.settings.playlistData.forEach((track, idx) => {
                dropdown.addOption(idx.toString(), track.title);
            });
            dropdown.setValue(targetRef.trackIndex.toString());
            dropdown.onChange(async (val) => {
                targetRef.trackIndex = parseInt(val);
                targetRef.checkpointIndex = -1; 
                await this.plugin.saveSettings();
                this.display(); 
            });
        });

        setting.addDropdown(dropdown => {
            dropdown.addOption("-1", "Start");
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
    statusBarItem: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();
        
        this.statusBarItem = this.addStatusBarItem();
        this.updateStatusBar("");

        this.addSettingTab(new ZenZoneSettingTab(this.app, this));
        this.registerView(VIEW_TYPE_ZEN, (leaf) => new ZenView(leaf, this));
        this.addRibbonIcon('zap', 'Open Zen Zone', () => this.activateView());
    }

    async loadSettings() { 
        const loadedData = await this.loadData();
        const settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
        
        // Handle migration for workMusic/breakMusic from single ref to array
        if (!Array.isArray(settings.workMusic)) {
            const oldRef = loadedData?.workMusic || DEFAULT_MUSIC_REF_WORK;
            settings.workMusic = Array(4).fill(null).map(() => ({ ...oldRef }));
        }
        if (!Array.isArray(settings.breakMusic)) {
            const oldRef = loadedData?.breakMusic || DEFAULT_MUSIC_REF_BREAK;
            settings.breakMusic = Array(4).fill(null).map(() => ({ ...oldRef }));
        }
        
        this.settings = settings;
    }

    async saveSettings() { await this.saveData(this.settings); }

    updateStatusBar(text: string) {
        if (!this.statusBarItem) return;
        if (this.settings.showStatusBarTimer && text) {
            this.statusBarItem.setText(text);
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
        }
    }

    // --- Daily Note Utilities ---
    async ensureFolderExists(folderPath: string) {
        const parts = folderPath.split('/');
        // The last part is the file name, so we exclude it
        const folders = parts.slice(0, -1);
        if (folders.length === 0) return;

        let currentPath = '';
        for (const folder of folders) {
            currentPath = currentPath === '' ? folder : `${currentPath}/${folder}`;
            const abstractFile = this.app.vault.getAbstractFileByPath(currentPath);
            if (!abstractFile) {
                await this.app.vault.createFolder(currentPath);
            }
        }
    }

    getDailyNoteTemplatePath(): string | null {
        try {
            // Check if the core daily-notes plugin is enabled and get its template
            const dailyNotesPlugin = (this.app as any).internalPlugins.plugins["daily-notes"];
            if (dailyNotesPlugin && dailyNotesPlugin.enabled) {
                return dailyNotesPlugin.instance.options.template;
            }
        } catch (e) {
            console.error("ZenZone: Failed to get daily notes template path", e);
        }
        return null;
    }

    async getTemplateContent(templatePath: string): Promise<string> {
        const tFile = this.app.vault.getAbstractFileByPath(normalizePath(templatePath + ".md"));
        if (tFile instanceof TFile) {
            let content = await this.app.vault.read(tFile);
            
            // Basic template variable replacements (simulating some of Obsidian's defaults)
            const today = moment();
            content = content.replace(/{{\s*date\s*}}/gi, today.format("YYYY-MM-DD"));
            content = content.replace(/{{\s*time\s*}}/gi, today.format("HH:mm"));
            content = content.replace(/{{\s*title\s*}}/gi, today.format(this.settings.dailyNoteFormat));
            // Date with format e.g. {{date:YYYY-MM-DD}}
            content = content.replace(/{{\s*date:([^}]+)\s*}}/gi, (match, format) => {
                return today.format(format.trim());
            });

            return content;
        }
        return "";
    }

    async manageDailyTask(content: string, header: string | undefined, action: 'add' | 'complete' | 'delete', filePath?: string) {
        if (!this.settings.autoLogToDaily) return;

        const nowStr = moment();
        const folder = this.settings.dailyNoteFolder ? normalizePath(this.settings.dailyNoteFolder) : "";
        
        let targetPath = filePath;
        if (!targetPath) {
            const fileName = nowStr.format(this.settings.dailyNoteFormat);
            targetPath = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;
        }

        const targetHeader = header || this.settings.dailyNoteTargetHeader || "Todo";
        let file = this.app.vault.getAbstractFileByPath(targetPath);

        // --- Create Note if missing ---
        if (!file) {
            if (action === 'add') {
                try {
                    await this.ensureFolderExists(targetPath);
                    
                    let initialContent = "";
                    const templatePath = this.getDailyNoteTemplatePath();
                    
                    if (templatePath) {
                        initialContent = await this.getTemplateContent(templatePath);
                    }
                    
                    if (initialContent) {
                        await this.app.vault.create(targetPath, initialContent);
                        new Notice(`Daily Note Created from Template: ${targetPath}`);
                        file = this.app.vault.getAbstractFileByPath(targetPath);
                    } else {
                        // Fallback empty note structure
                        const taskLine = `- [ ] ${content}`;
                        initialContent = `# ${nowStr.format("YYYY-MM-DD")}\n\n## ${targetHeader}\n${taskLine}\n`;
                        await this.app.vault.create(targetPath, initialContent);
                        new Notice(`Daily Note Created: ${targetPath}`);
                        return; // Created with task already in it
                    }
                } catch (err) {
                    console.error("Failed to create daily note:", err);
                    new Notice("Failed to create Daily Note.");
                    return;
                }
            } else {
                console.warn(`Target file not found: ${targetPath}`);
                return;
            }
        }

        // --- Modify Note ---
        if (file instanceof TFile) {
            let fileContent = await this.app.vault.read(file);
            let updatedContent = fileContent;
            const escapeRegex = content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            if (action === 'add') {
                if (fileContent.includes(`- [ ] ${content}`)) return; // Prevent exact duplicates

                const taskLine = `- [ ] ${content}`;
                const escapedHeader = targetHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const headerRegex = new RegExp(`(#{1,6}\\s+${escapedHeader}[\\s\\S]*?)(?=\\n#{1,6}\\s|$)`, 'i');
                
                if (fileContent.match(headerRegex)) {
                    // Append to existing header section
                    updatedContent = fileContent.replace(headerRegex, (match) => {
                        return `${match.trimEnd()}\n${taskLine}\n`;
                    });
                } else {
                    // Append header and task to bottom if header doesn't exist
                    updatedContent = fileContent.trimEnd() + `\n\n## ${targetHeader}\n${taskLine}`;
                }
                new Notice(`Task added to ${targetHeader}`);

            } else if (action === 'complete') {
                const searchRegex = new RegExp(`^([\\s\\t]*)[-*+]\\s+\\[ \\]\\s+${escapeRegex}\\s*$`, 'm');
                const completedLine = `- [x] ${nowStr.format("HH:mm")} ${content}`;
                
                if (searchRegex.test(fileContent)) {
                    updatedContent = fileContent.replace(searchRegex, `$1${completedLine}`);
                    new Notice(`Task marked completed in ${file.basename}`);
                } else {
                    new Notice(`Task not found in ${file.basename}.`);
                }

            } else if (action === 'delete') {
                const searchRegex = new RegExp(`^([\\s\\t]*)[-*+]\\s+\\[.\\]\\s+.*?${escapeRegex}\\s*(\\n|$)`, 'm');
                if (searchRegex.test(fileContent)) {
                    updatedContent = fileContent.replace(searchRegex, "");
                    new Notice(`Task deleted from ${file.basename}`);
                }
            }

            if (fileContent !== updatedContent) {
                await this.app.vault.modify(file, updatedContent);
            }
        }
    }

    // --- View/Mode Management ---
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
        if (this.settings.autoCollapseSidebars) {
            if (this.app.workspace.leftSplit) this.app.workspace.leftSplit.collapse();
            if (this.app.workspace.rightSplit) this.app.workspace.rightSplit.collapse();
        }
        if (this.settings.hideHeader) {
            document.body.classList.add('zen-hide-header');
        }
        new Notice("🧘 Focus Mode On");
    }

    exitZenMode() {
        document.body.classList.remove('zen-mode-active');
        document.body.classList.remove('zen-hide-header');
        this.updateStatusBar(""); // Clear status timer
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