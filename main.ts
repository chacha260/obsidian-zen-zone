import { Plugin, ItemView, WorkspaceLeaf, Notice, PluginSettingTab, App, Setting, setIcon, Modal, ButtonComponent, TFile, normalizePath } from 'obsidian';

// --- Type Declarations ---
declare global {
	interface Window {
		YT: any;
		onYouTubeIframeAPIReady: () => void;
		moment: () => any;
	}
}

// --- Constants & Interfaces ---
const VIEW_TYPE_ZEN = "zen-zone-view";
const TIME_CONSTRAINTS = {
	work: { min: 15, max: 60, default: 25 },
	shortBreak: { min: 3, max: 15, default: 5 },
	longBreak: { min: 15, max: 45, default: 30 }
};

interface Checkpoint { label: string; time: string; }
interface PlaylistItem { title: string; url: string; checkpoints?: Checkpoint[]; }
interface MusicReference { trackIndex: number; checkpointIndex: number; }
interface ZenTask {
	id: string;
	content: string;
	completed: boolean;
	header?: string;
	filePath?: string;
}

interface ZenZoneSettings {
	playlistData: PlaylistItem[];
	workDuration: number;
	shortBreakDuration: number;
	longBreakDuration: number;
	autoCollapseSidebars: boolean;
	hideHeader: boolean;
	autoLogToDaily: boolean;
	showStatusBarTimer: boolean;
	tasks: ZenTask[];
	workMusic: MusicReference[];
	breakMusic: MusicReference[];
	dailyNoteFormat: string;
	dailyNoteFolder: string;
	dailyNoteTargetHeader: string;
	soundStart: string;
	durationStart: number;
	soundFocusToShort: string;
	durationFocusToShort: number;
	soundShortToFocus: string;
	durationShortToFocus: number;
	soundFocusToLong: string;
	durationFocusToLong: number;
	soundLongToFinish: string;
	durationLongToFinish: number;
}

const DEFAULT_MUSIC_REF: MusicReference = { trackIndex: 0, checkpointIndex: -1 };
const DEFAULT_BREAK_REF: MusicReference = { trackIndex: 1, checkpointIndex: -1 };

const DEFAULT_SETTINGS: ZenZoneSettings = {
	playlistData: [
		{ title: "☕ Lofi Girl - Study", url: "https://www.youtube.com/watch?v=jfKfPfyJRdk", checkpoints: [] },
		{ title: "🎷 Jazz - Relax", url: "https://www.youtube.com/watch?v=Dx5qFachd3A", checkpoints: [{ label: "🌅 Morning", time: "0:00" }, { label: "🌃 Night", time: "10:30" }] },
		{ title: "🌧 Rain Sounds", url: "https://www.youtube.com/watch?v=mPZkdNFkNps", checkpoints: [] }
	],
	workDuration: TIME_CONSTRAINTS.work.default,
	shortBreakDuration: TIME_CONSTRAINTS.shortBreak.default,
	longBreakDuration: TIME_CONSTRAINTS.longBreak.default,
	autoCollapseSidebars: false,
	hideHeader: false,
	autoLogToDaily: false,
	showStatusBarTimer: false,
	tasks: [],
	workMusic: Array(4).fill(null).map(() => ({ ...DEFAULT_MUSIC_REF })),
	breakMusic: Array(4).fill(null).map(() => ({ ...DEFAULT_BREAK_REF })),
	dailyNoteFormat: 'YYYY-MM-DD',
	dailyNoteFolder: '',
	dailyNoteTargetHeader: 'Todo',
	soundStart: '', durationStart: 5,
	soundFocusToShort: '', durationFocusToShort: 5,
	soundShortToFocus: '', durationShortToFocus: 5,
	soundFocusToLong: '', durationFocusToLong: 5,
	soundLongToFinish: '', durationLongToFinish: 5
};

enum TimerState { Idle, Focus, ShortBreak, LongBreak }
enum RepeatMode { Off, All, One }

// =========================================================================
// 1. Main Plugin Class
// =========================================================================
export default class ZenZonePlugin extends Plugin {
	settings!: ZenZoneSettings;
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
		const loaded = await this.loadData();
		const merged = Object.assign({}, DEFAULT_SETTINGS, loaded);
		if (!Array.isArray(merged.workMusic)) { const oldWork = loaded?.workMusic || DEFAULT_MUSIC_REF; merged.workMusic = Array(4).fill(null).map(() => ({ ...oldWork })); }
		if (!Array.isArray(merged.breakMusic)) { const oldBreak = loaded?.breakMusic || DEFAULT_BREAK_REF; merged.breakMusic = Array(4).fill(null).map(() => ({ ...oldBreak })); }
		this.settings = merged;
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

	async ensureFolderExists(path: string) {
		const folders = path.split('/').slice(0, -1);
		if (folders.length === 0) return;
		let currentPath = "";
		for (const folder of folders) {
			currentPath = currentPath === "" ? folder : `${currentPath}/${folder}`;
			const existing = this.app.vault.getAbstractFileByPath(currentPath);
			if (!existing) {
				await this.app.vault.createFolder(currentPath);
			}
		}
	}

	getDailyNoteTemplatePath(): string | null {
		try {
			// @ts-ignore
			const dailyNotesPlugin = this.app.internalPlugins.plugins["daily-notes"];
			if (dailyNotesPlugin && dailyNotesPlugin.enabled) {
				return dailyNotesPlugin.instance.options.template;
			}
		} catch (e) {
			console.error("ZenZone: Failed to get daily notes template path", e);
		}
		return null;
	}

	async getTemplateContent(templatePath: string): Promise<string> {
		const templateFile = this.app.vault.getAbstractFileByPath(normalizePath(templatePath + ".md"));
		if (templateFile instanceof TFile) {
			let content = await this.app.vault.read(templateFile);
			const now = window.moment();
			content = content.replace(/{{\s*date\s*}}/gi, now.format("YYYY-MM-DD"));
			content = content.replace(/{{\s*time\s*}}/gi, now.format("HH:mm"));
			content = content.replace(/{{\s*title\s*}}/gi, now.format(this.settings.dailyNoteFormat));
			content = content.replace(/{{\s*date:([^}]+)\s*}}/gi, (match, fmt) => {
				return now.format(fmt.trim());
			});
			return content;
		}
		return "";
	}

	async manageDailyTask(taskContent: string, customHeader: string | undefined, type: 'add' | 'complete' | 'delete', specificFilePath?: string) {
		if (!this.settings.autoLogToDaily) return;
		const date = window.moment();
		const folder = this.settings.dailyNoteFolder ? normalizePath(this.settings.dailyNoteFolder) : "";
		let filePath = specificFilePath;
		if (!filePath) {
			const fileName = date.format(this.settings.dailyNoteFormat);
			filePath = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;
		}
		const targetHeader = customHeader || this.settings.dailyNoteTargetHeader || "Todo";
		let file = this.app.vault.getAbstractFileByPath(filePath);
		if (!file) {
			if (type === 'add') {
				try {
					await this.ensureFolderExists(filePath);
					let initialContent = "";
					const templatePath = this.getDailyNoteTemplatePath();
					if (templatePath) {
						initialContent = await this.getTemplateContent(templatePath);
					}
					if (!initialContent) {
						const line = `- [ ] ${taskContent}`;
						initialContent = `# ${date.format("YYYY-MM-DD")}\n\n## ${targetHeader}\n${line}\n`;
						await this.app.vault.create(filePath, initialContent);
						new Notice(`Daily Note Created: ${filePath}`);
						return;
					} else {
						await this.app.vault.create(filePath, initialContent);
						new Notice(`Daily Note Created from Template: ${filePath}`);
						file = this.app.vault.getAbstractFileByPath(filePath);
					}
				} catch (error) {
					console.error("Failed to create daily note:", error);
					new Notice("Failed to create Daily Note.");
					return;
				}
			} else {
				console.warn(`Target file not found: ${filePath}`);
				return;
			}
		}
		if (file instanceof TFile) {
			const currentContent = await this.app.vault.read(file);
			let newContent = currentContent;
			const taskEscaped = taskContent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			if (type === 'add') {
				if (currentContent.includes(`- [ ] ${taskContent}`)) return;
				const lineToAdd = `- [ ] ${taskContent}`;
				const headerEscaped = targetHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const sectionRegex = new RegExp(`(#{1,6}\\s+${headerEscaped}[\\s\\S]*?)(?=\\n#{1,6}\\s|$)`, 'i');
				const match = currentContent.match(sectionRegex);
				if (match) {
					newContent = currentContent.replace(sectionRegex, (matchedSection) => {
						return `${matchedSection.trimEnd()}\n${lineToAdd}\n`;
					});
				} else {
					newContent = currentContent.trimEnd() + `\n\n## ${targetHeader}\n${lineToAdd}`;
				}
				new Notice(`Task added to ${targetHeader}`);
			} else if (type === 'complete') {
				const taskRegex = new RegExp(`^([\\s\\t]*)[-*+]\\s+\\[ \\]\\s+${taskEscaped}\\s*$`, 'm');
				const timeStr = date.format("HH:mm");
				const completedLine = `- [x] ${timeStr} ${taskContent}`;
				if (taskRegex.test(currentContent)) {
					newContent = currentContent.replace(taskRegex, `$1${completedLine}`);
					new Notice(`Task marked completed in ${file.basename}`);
				} else {
					new Notice(`Task not found in ${file.basename}.`);
				}
			} else if (type === 'delete') {
				const deleteRegex = new RegExp(`^([\\s\\t]*)[-*+]\\s+\\[.\\]\\s+.*?${taskEscaped}\\s*(\\n|$)`, 'm');
				if (deleteRegex.test(currentContent)) {
					newContent = currentContent.replace(deleteRegex, '');
					new Notice(`Task deleted from ${file.basename}`);
				}
			}
			if (currentContent !== newContent) {
				await this.app.vault.modify(file, newContent);
			}
		}
	}

	playLocalSound(path: string) {
		if (!path) return;
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		if (file instanceof TFile) {
			const resourcePath = this.app.vault.adapter.getResourcePath(file.path);
			const audio = new Audio(resourcePath);
			audio.play().catch(e => console.error("Failed to play sound:", e));
		}
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null | undefined = workspace.getLeavesOfType(VIEW_TYPE_ZEN)[0];
		if (!leaf) { leaf = workspace.getRightLeaf(false); if(leaf) await leaf.setViewState({ type: VIEW_TYPE_ZEN, active: true }); }
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
		this.updateStatusBar("");
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

// =========================================================================
// YouTubeAudio クラス - 改良版(メモリリーク対策)
// =========================================================================
class YouTubeAudio {
    private player: any = null;
    private isReady: boolean = false;
    private containerId: string;
    private playQueued: boolean = false;
    private initialVolume: number = 50;

    // 🔥 現在のトラック情報を保持
    private currentVideoId: string | null = null;
    private currentListId: string | null = null;

    // 🔥 ポーリング廃止(メモリリーク原因)
    private lastPlaylistIndex: number = -1;
    private lastVideoTitle: string = "";
    private repeatMode: RepeatMode = RepeatMode.Off;
    private manualTrackChange: boolean = false;

    public onPlaylistInfo?: (index: number, list: string[], title: string, author: string) => void;
    public onStateChange?: (state: number) => void;

    constructor(
        private container: HTMLElement,
        videoId: string | null,
        listId: string | null
    ) {
        const existing = container.querySelector('.yt-player-wrapper');
        if (existing) existing.remove();

        const wrapper = container.createDiv({ cls: 'yt-player-wrapper' });
        this.containerId = "yt-player-" + Date.now();
        wrapper.id = this.containerId;
        wrapper.style.display = "none";

        this.currentVideoId = videoId;
        this.currentListId = listId;

        this.initAPI(videoId, listId);
    }

    private initAPI(videoId: string | null, listId: string | null) {
        if (!window.YT) {
            const script = document.createElement("script");
            script.src = "https://www.youtube.com/iframe_api";
            const firstScript = document.getElementsByTagName("script")[0];
            if (firstScript && firstScript.parentNode) {
                firstScript.parentNode.insertBefore(script, firstScript);
            } else {
                document.head.appendChild(script);
            }
        }

        const initPlayer = () => {
            const playerVars: any = {
                controls: 0,
                autoplay: 0,
                enablejsapi: 1,
                origin: window.location.origin,
                // 🔥 メモリ削減のための設定
                modestbranding: 1,
                rel: 0,
                showinfo: 0,
                iv_load_policy: 3 // アノテーション無効化
            };

            if (listId) {
                playerVars.listType = "playlist";
                playerVars.list = listId;
            } else if (videoId) {
                playerVars.loop = 1;
                playerVars.playlist = videoId;
            }

            this.player = new window.YT.Player(this.containerId, {
                height: "0",
                width: "0",
                videoId: videoId || undefined,
                playerVars: playerVars,
                events: {
                    onReady: this.onPlayerReady.bind(this),
                    onStateChange: this.onPlayerStateChange.bind(this)
                }
            });
        };

        if (window.YT && window.YT.Player) {
            initPlayer();
        } else {
            const previous = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                if (previous) previous();
                initPlayer();
            };
        }
    }

    private onPlayerReady(event: any) {
        this.isReady = true;
        this.player.setVolume(this.initialVolume);
        if (this.playQueued) {
            this.player.playVideo();
            this.playQueued = false;
        }

        // 🔥 初回のみ情報取得
        this.updatePlaylistInfo();
    }

    private onPlayerStateChange(event: any) {
        if (this.onStateChange) this.onStateChange(event.data);

        // State 1 (Playing) / State 5 (Cued)
        if (event.data === 1 || event.data === 5) {
            // 🔁 Repeat One: プレイリスト内の自動送りを阻止
            if (event.data === 1
                && this.repeatMode === RepeatMode.One
                && !this.manualTrackChange) {
                try {
                    const currentIndex = this.player.getPlaylistIndex();
                    if (this.lastPlaylistIndex >= 0
                        && currentIndex !== this.lastPlaylistIndex) {
                        this.player.playVideoAt(this.lastPlaylistIndex);
                        return;
                    }
                } catch (e) { /* ignore */ }
            }
            this.updatePlaylistInfo();
        }

        // State 0 (Ended)
        if (event.data === 0) {
            if (this.repeatMode === RepeatMode.One) {
                // 🔁 同じ曲を先頭から再生
                setTimeout(() => {
                    if (this.player) {
                        this.player.seekTo(0, true);
                        this.player.playVideo();
                    }
                }, 100);
            } else if (this.repeatMode === RepeatMode.Off) {
                // 🔥 リピートなし → バッファクリア（既存動作）
                this.clearBuffers();
            }
            // RepeatMode.All → player.setLoop(true) で YouTube 側が処理
        }
    }

    // 🔥 ポーリング廃止:イベント駆動のみ
    private updatePlaylistInfo() {
        try {
            if (!this.onPlaylistInfo || !this.player.getPlaylist) return;

            const list = this.player.getPlaylist();
            const index = this.player.getPlaylistIndex();
            let title = "";

            try {
                const data = this.player.getVideoData();
                if (data && data.title) title = data.title;
            } catch (e) {}

            // 🔥 変更があった場合のみコールバック実行
            if (index !== this.lastPlaylistIndex || title !== this.lastVideoTitle) {
                this.lastPlaylistIndex = index;
                this.lastVideoTitle = title;
                this.onPlaylistInfo(
                    index !== undefined ? index : -1,
                    list || [],
                    title,
                    ""
                );
            }
        } catch (e) {
            // エラーを無視
        }
    }

    // 🔁 Repeat Mode Methods
    setRepeatMode(mode: RepeatMode) {
        this.repeatMode = mode;
        this.applyRepeatMode();
    }

    getRepeatMode(): RepeatMode {
        return this.repeatMode;
    }

    private applyRepeatMode() {
        if (!this.isReady || !this.player) return;
        if (typeof this.player.setLoop === 'function') {
            this.player.setLoop(this.repeatMode !== RepeatMode.Off);
        }
    }

    // 🔥 バッファを強制的にクリア
    private clearBuffers() {
        try {
            if (!this.player) return;

            // 一時停止してシーク位置をリセット
            if (typeof this.player.pauseVideo === 'function') {
                this.player.pauseVideo();
            }

            // 少し待機してから先頭にシーク
            setTimeout(() => {
                if (this.player && typeof this.player.seekTo === 'function') {
                    this.player.seekTo(0, true);
                }
            }, 100);
        } catch (e) {
            console.warn("Buffer clear failed:", e);
        }
    }

    // 🔥 改良版:重複ロード防止 + バッファクリア
    loadVideoOrPlaylist(videoId: string | null, listId: string | null): void {
        if (!this.isReady || !this.player) return;

        // 🔥 同じ動画/プレイリストなら何もしない
        if (videoId === this.currentVideoId && listId === this.currentListId) {
            console.log("Same track, skipping load");
            return;
        }

        try {
            // 🔥 1. 現在の再生を完全停止
            if (typeof this.player.stopVideo === 'function') {
                this.player.stopVideo();
            }

            // 🔥 2. バッファをクリア
            this.clearBuffers();

            // 🔥 3. 300ms待機してから新しい動画をロード
            setTimeout(() => {
                if (!this.player) return;

                this.currentVideoId = videoId;
                this.currentListId = listId;

                if (listId) {
                    this.player.loadPlaylist({
                        listType: 'playlist',
                        list: listId,
                        index: 0,
                        startSeconds: 0
                    });
                } else if (videoId) {
                    this.player.loadVideoById({
                        videoId: videoId,
                        startSeconds: 0
                    });
                }

                // 🔥 情報更新
                setTimeout(() => this.updatePlaylistInfo(), 500);
                // 🔁 リピート設定を再適用
                setTimeout(() => this.applyRepeatMode(), 800);

            }, 300);

        } catch (e) {
            console.error("Failed to load video/playlist:", e);
        }
    }

    // 🔥 完全な破棄処理
    destroy() {
        console.log("YouTubeAudio: Starting destroy...");

        if (this.player) {
            try {
                // 🔥 1. 停止
                if (typeof this.player.stopVideo === 'function') {
                    this.player.stopVideo();
                }

                // 🔥 2. バッファクリア
                this.clearBuffers();

                // 🔥 3. 500ms待ってから破棄
                setTimeout(() => {
                    if (this.player) {
                        try {
                            this.player.destroy();
                            console.log("YouTubeAudio: Player destroyed");
                        } catch (e) {
                            console.warn("Player destroy error:", e);
                        }
                        this.player = null;
                    }
                }, 500);

            } catch (e) {
                console.warn("YouTube player destroy error:", e);
            }
        }

        // 🔥 DOM完全削除
        setTimeout(() => {
            const wrapper = document.getElementById(this.containerId);
            if (wrapper) {
                while (wrapper.firstChild) {
                    wrapper.removeChild(wrapper.firstChild);
                }
                wrapper.remove();
                console.log("YouTubeAudio: DOM cleaned");
            }
        }, 600);

        // 🔥 コールバック完全削除
        this.onPlaylistInfo = undefined;
        this.onStateChange = undefined;

        // 🔥 状態リセット
        this.isReady = false;
        this.currentVideoId = null;
        this.currentListId = null;
        this.lastPlaylistIndex = -1;
        this.lastVideoTitle = "";
        this.repeatMode = RepeatMode.Off;
        this.manualTrackChange = false;
    }

    play() {
        if (this.isReady && this.player && this.player.playVideo) {
            this.player.playVideo();
        } else {
            this.playQueued = true;
        }
    }

    pause() {
        if (this.isReady && this.player && this.player.pauseVideo) {
            this.player.pauseVideo();
        } else {
            this.playQueued = false;
        }
    }

    setVolume(vol0to1: number) {
        this.initialVolume = vol0to1 * 100;
        if (this.isReady && this.player && this.player.setVolume) {
            this.player.setVolume(this.initialVolume);
        }
    }

    seekTo(seconds: number) {
        if (this.isReady && this.player && this.player.seekTo) {
            this.player.seekTo(seconds, true);
        }
    }

    setShuffle(shuffle: boolean) {
        if (this.isReady && this.player && this.player.setShuffle) {
            this.player.setShuffle(shuffle);
        }
    }

    nextVideo() {
        if (this.isReady && this.player && this.player.nextVideo) {
            this.manualTrackChange = true;
            this.player.nextVideo();
            setTimeout(() => {
                this.manualTrackChange = false;
                this.clearBuffers();
                this.updatePlaylistInfo();
            }, 1000);
        }
    }

    previousVideo() {
        if (this.isReady && this.player && this.player.previousVideo) {
            this.manualTrackChange = true;
            this.player.previousVideo();
            setTimeout(() => {
                this.manualTrackChange = false;
                this.clearBuffers();
                this.updatePlaylistInfo();
            }, 1000);
        }
    }

    isPlayerReady(): boolean {
        return this.isReady;
    }

    // 🔥 外部から現在のトラック情報を取得
    getCurrentTrackInfo(): { videoId: string | null; listId: string | null } {
        return {
            videoId: this.currentVideoId,
            listId: this.currentListId
        };
    }
}

// =========================================================================
// ZenView クラス - メモリリーク修正版
// =========================================================================
class ZenView extends ItemView {
    plugin: ZenZonePlugin;
    timerInterval: number | null = null;
    timeLeft: number = 0;
    currentState: TimerState = TimerState.Idle;
    cycleCount: number = 0;
    isMusicPlaying: boolean = false;

    // Media State
    ytPlayer: YouTubeAudio | null = null;
    currentVideoId: string | null = null;
    currentVolume: number = 0.5;
    isShuffle: boolean = false;
    repeatMode: RepeatMode = RepeatMode.Off;

    // UI Elements
    taskCardEl: HTMLElement | null = null;
    musicBtnEl: HTMLButtonElement | null = null;
    timerDisplayEl: HTMLElement | null = null;
    statusLabelEl: HTMLElement | null = null;
    cycleIndicatorEl: HTMLElement | null = null;
    playlistOrderEl: HTMLElement | null = null;
    videoTitleEl: HTMLElement | null = null;

    // Drag & Drop
    dragSrcIndex: number = -1;
    taskListHeight: string | null = null;
    transitionTimeoutId: number | null = null;

    // イベントリスナー管理
    private eventListeners: Array<{
        element: HTMLElement | HTMLInputElement;
        event: string;
        handler: EventListener;
    }> = [];

    constructor(leaf: WorkspaceLeaf, plugin: ZenZonePlugin) {
        super(leaf);
        this.plugin = plugin;
        this.timeLeft = this.plugin.settings.workDuration * 60;
    }

    getViewType() { return VIEW_TYPE_ZEN; }
    getDisplayText() { return "Zen Zone"; }
    getIcon() { return "zap"; }

    private addEventListener(element: HTMLElement | HTMLInputElement, event: string, handler: EventListener) {
        element.addEventListener(event, handler);
        this.eventListeners.push({ element, event, handler });
    }

    private removeAllEventListeners() {
        this.eventListeners.forEach(({ element, event, handler }) => {
            element.removeEventListener(event, handler);
        });
        this.eventListeners = [];
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("zen-view-container");

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

        this.taskCardEl = container.createDiv({ cls: "zen-card zen-task-card" });
        this.renderTaskCard(this.taskCardEl);

        const timerContainer = container.createDiv();
        this.renderTimerCard(timerContainer);

        const audioContainer = container.createDiv();
        this.renderAudioCard(audioContainer);

        container.createDiv({ text: "Cycle & Music settings in plugin options.", cls: "zen-footer-note" });
    }

    // --- Repeat Button Helper ---
    private updateRepeatButtonIcon(btn: HTMLElement) {
        if (this.repeatMode === RepeatMode.Off) {
            setIcon(btn, "repeat");
            btn.removeClass("is-active");
            btn.title = "Repeat: Off";
        } else if (this.repeatMode === RepeatMode.All) {
            setIcon(btn, "repeat");
            btn.addClass("is-active");
            btn.title = "Repeat: All";
        } else if (this.repeatMode === RepeatMode.One) {
            setIcon(btn, "repeat-1");
            btn.addClass("is-active");
            btn.title = "Repeat: One ♾️";
        }
    }

    // --- Task UI ---
    renderTaskCard(card: HTMLElement) {
        card.empty();
        const focusWrapper = card.createDiv({ cls: "zen-task-focus-wrapper" });
        focusWrapper.createDiv({ text: "🔥 Current Focus", cls: "zen-sub-label" });
        const activeTask = this.plugin.settings.tasks[0];
        const focusDisplay = focusWrapper.createDiv({ cls: "zen-task-focus-display" });

        if (activeTask) {
            const cb = focusDisplay.createEl("input", { type: "checkbox", cls: "zen-task-cb-large" });
            cb.checked = false;
            const cbHandler = async () => {
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
            this.addEventListener(cb, 'click', cbHandler);

            const taskText = focusDisplay.createSpan({ text: activeTask.content, cls: "zen-task-text-large" });
            if (activeTask.header) {
                const headerTag = taskText.createSpan({ text: ` [${activeTask.header}]`, cls: "zen-task-header-tag" });
                headerTag.setAttribute("style", "font-size: 0.6em; color: var(--text-muted); margin-left: 8px; vertical-align: middle;");
            }
        } else {
            focusDisplay.createSpan({ text: "No active tasks. Great job! 🎉", cls: "zen-task-text-placeholder" });
        }

        const inputWrapper = card.createDiv({ cls: "zen-task-input-wrapper" });
        const defaultHeader = this.plugin.settings.dailyNoteTargetHeader || "Todo";
        const headerInput = inputWrapper.createEl("input", { type: "text", placeholder: defaultHeader, cls: "zen-task-add-input" });
        headerInput.style.flexGrow = "0";
        headerInput.style.width = "80px";
        headerInput.style.minWidth = "60px";
        headerInput.title = "Target Header (Optional)";

        const inputEl = inputWrapper.createEl("input", { type: "text", placeholder: "Add a new task...", cls: "zen-task-add-input" });

        const addTask = async () => {
            if (!inputEl.value.trim()) return;
            const date = window.moment();
            const fileName = date.format(this.plugin.settings.dailyNoteFormat);
            const folder = this.plugin.settings.dailyNoteFolder ? normalizePath(this.plugin.settings.dailyNoteFolder) : "";
            const currentFilePath = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;

            const newTask: ZenTask = {
                id: Date.now().toString(),
                content: inputEl.value.trim(),
                completed: false,
                header: headerInput.value.trim() || undefined,
                filePath: currentFilePath
            };

            this.plugin.settings.tasks.push(newTask);
            await this.plugin.manageDailyTask(newTask.content, newTask.header, 'add', currentFilePath);
            await this.plugin.saveSettings();
            inputEl.value = "";
            this.renderTaskCardRefresh();
        };

        const inputKeyHandler = (e: Event) => { 
            if ((e as KeyboardEvent).key === "Enter") addTask(); 
        };
        const headerKeyHandler = (e: Event) => { 
            if ((e as KeyboardEvent).key === "Enter") inputEl.focus(); 
        };

        this.addEventListener(inputEl, 'keypress', inputKeyHandler);
        this.addEventListener(headerInput, 'keypress', headerKeyHandler);

        const addBtn = inputWrapper.createEl("button", { text: "+", cls: "zen-task-add-btn" });
        this.addEventListener(addBtn, 'click', addTask);

        const listWrapper = card.createDiv({ cls: "zen-task-list-wrapper" });
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

        const dragOverHandler = (e: Event) => {
            e.preventDefault();
            const de = e as DragEvent;
            if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
        };

        const dropHandler = async (e: Event) => {
            e.preventDefault();
            const de = e as DragEvent;
            if (de.target === listWrapper && this.dragSrcIndex > -1) {
                const items = this.plugin.settings.tasks;
                const [reorderedItem] = items.splice(this.dragSrcIndex, 1);
                items.push(reorderedItem);
                await this.plugin.saveSettings();
                this.renderTaskCardRefresh();
                this.dragSrcIndex = -1;
            }
        };

        this.addEventListener(listWrapper, 'dragover', dragOverHandler);
        this.addEventListener(listWrapper, 'drop', dropHandler);

        if (this.plugin.settings.tasks.length > 0) {
            this.plugin.settings.tasks.forEach((task: ZenTask, index: number) => {
                const row = listWrapper.createDiv({ cls: "zen-task-row" });
                row.draggable = true;
                row.style.cursor = "move";

                const dragStartHandler = (e: Event) => {
                    this.dragSrcIndex = index;
                    row.style.opacity = '0.4';
                    const de = e as DragEvent;
                    if (de.dataTransfer) {
                        de.dataTransfer.effectAllowed = 'move';
                        de.dataTransfer.setData('text/plain', index.toString());
                    }
                };

                const rowDragOverHandler = (e: Event) => {
                    e.preventDefault();
                    const de = e as DragEvent;
                    if (de.dataTransfer) de.dataTransfer.dropEffect = 'move';
                    return false;
                };

                const rowDropHandler = async (e: Event) => {
                    e.stopPropagation();
                    if (this.dragSrcIndex !== index && this.dragSrcIndex > -1) {
                        const items = this.plugin.settings.tasks;
                        const [reorderedItem] = items.splice(this.dragSrcIndex, 1);
                        items.splice(index, 0, reorderedItem);
                        await this.plugin.saveSettings();
                        this.renderTaskCardRefresh();
                    }
                    return false;
                };

                const dragEndHandler = () => {
                    row.style.opacity = '1';
                    this.dragSrcIndex = -1;
                };

                this.addEventListener(row, 'dragstart', dragStartHandler);
                this.addEventListener(row, 'dragover', rowDragOverHandler);
                this.addEventListener(row, 'drop', rowDropHandler);
                this.addEventListener(row, 'dragend', dragEndHandler);

                const cb = row.createEl("input", { type: "checkbox", cls: "zen-task-cb" });
                cb.checked = false;

                const cbClickHandler = async () => {
                    cb.checked = true;
                    row.addClass("is-completed");
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
                this.addEventListener(cb, 'click', cbClickHandler);

                const textSpan = row.createSpan({ cls: "zen-task-text" });
                textSpan.setText(task.content);
                if (task.header) {
                    const headerSpan = textSpan.createSpan({ text: ` #${task.header}` });
                    headerSpan.style.color = "var(--text-muted)";
                    headerSpan.style.fontSize = "0.85em";
                    headerSpan.style.marginLeft = "8px";
                }

                const controls = row.createDiv({ cls: "zen-task-row-controls" });

                if (index > 0) {
                    const upBtn = controls.createEl("button", { cls: "zen-task-control-btn" });
                    setIcon(upBtn, "arrow-up");
                    const upHandler = async () => {
                        [this.plugin.settings.tasks[index], this.plugin.settings.tasks[index - 1]] = 
                        [this.plugin.settings.tasks[index - 1], this.plugin.settings.tasks[index]];
                        await this.plugin.saveSettings();
                        this.renderTaskCardRefresh();
                    };
                    this.addEventListener(upBtn, 'click', upHandler);
                }

                if (index < this.plugin.settings.tasks.length - 1) {
                    const downBtn = controls.createEl("button", { cls: "zen-task-control-btn" });
                    setIcon(downBtn, "arrow-down");
                    const downHandler = async () => {
                        [this.plugin.settings.tasks[index], this.plugin.settings.tasks[index + 1]] = 
                        [this.plugin.settings.tasks[index + 1], this.plugin.settings.tasks[index]];
                        await this.plugin.saveSettings();
                        this.renderTaskCardRefresh();
                    };
                    this.addEventListener(downBtn, 'click', downHandler);
                }

                const delBtn = controls.createEl("button", { cls: "zen-task-control-btn is-danger" });
                setIcon(delBtn, "trash");
                const delHandler = async () => {
                    await this.plugin.manageDailyTask(task.content, task.header, 'delete', task.filePath);
                    this.plugin.settings.tasks.splice(index, 1);
                    await this.plugin.saveSettings();
                    this.renderTaskCardRefresh();
                };
                this.addEventListener(delBtn, 'click', delHandler);
            });
        }
    }

    renderTaskCardRefresh() {
        if (this.taskCardEl) {
            const currentWrapper = this.taskCardEl.querySelector('.zen-task-list-wrapper') as HTMLElement;
            if (currentWrapper) {
                this.taskListHeight = currentWrapper.style.height || `${currentWrapper.offsetHeight}px`;
            }
            this.removeAllEventListeners();
            this.renderTaskCard(this.taskCardEl);
        }
    }

    // --- Timer UI ---
    renderTimerCard(parent: HTMLElement) {
        const card = parent.createDiv({ cls: "zen-card zen-audio-card" });
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
        const toggleHandler = () => this.toggleTimer(toggleBtn);
        this.addEventListener(toggleBtn, 'click', toggleHandler);

        const resetBtn = controls.createEl("button", { cls: "zen-sub-btn", text: "Reset" });
        resetBtn.style.backgroundColor = "#c0392b";
        resetBtn.style.color = "white";
        const resetHandler = () => this.resetSystem(toggleBtn);
        this.addEventListener(resetBtn, 'click', resetHandler);
    }

// --- Audio UI ---
    renderAudioCard(parent: HTMLElement) {
        const card = parent.createDiv({ cls: "zen-card zen-audio-card" });
        card.style.padding = "10px";

        const playlist = this.plugin.settings.playlistData;
        const playerContainer = card.createDiv({ cls: "zen-player-hidden" });

        // 🔥 プレイヤーは1度だけ作成
        if (!this.ytPlayer) {
            const firstTrack = playlist[0];
            if (firstTrack) {
                const info = this.extractYouTubeInfo(firstTrack.url);
                this.ytPlayer = new YouTubeAudio(
                    playerContainer,
                    info.videoId,
                    info.listId
                );
                this.ytPlayer.setVolume(this.currentVolume);

                // 🔥 コールバックも1度だけ設定
                this.ytPlayer.onPlaylistInfo = (index, list, title) => {
                    this.updatePlaylistUI(index, list, title);
                };
            }
        }

        const selectWrapper = card.createDiv({ cls: "zen-input-group" });
        selectWrapper.createDiv({ cls: "zen-label", text: "Manual Select" });
        const selectEl = selectWrapper.createEl("select", { cls: "zen-select" });

        let currentTrackCheckpoints: Checkpoint[] = [];

        playlist.forEach((track: PlaylistItem, index: number) => {
            const info = this.extractYouTubeInfo(track.url);
            if (info.videoId || info.listId) {
                const option = selectEl.createEl("option", { text: track.title });
                option.value = index.toString();
                if (index === 0) {
                    currentTrackCheckpoints = track.checkpoints || [];
                }
            }
        });

        const checkpointsContainer = card.createDiv({ cls: "zen-checkpoints-area" });
        this.renderCheckpoints(checkpointsContainer, currentTrackCheckpoints);

        const selectChangeHandler = () => {
            const trackIndex = parseInt(selectEl.value);
            const track = playlist[trackIndex];
            if (!track) return;

            const info = this.extractYouTubeInfo(track.url);
            currentTrackCheckpoints = track.checkpoints || [];

            // 🔥 プレイヤーを再生成せず、URLだけ変更
            if (this.ytPlayer?.isPlayerReady()) {
                this.ytPlayer.loadVideoOrPlaylist(info.videoId, info.listId);
                if (this.isShuffle) {
                    setTimeout(() => this.ytPlayer?.setShuffle(true), 500);
                }
            }

            this.renderCheckpoints(checkpointsContainer, currentTrackCheckpoints);
            if (this.playlistOrderEl) this.playlistOrderEl.setText("");
        };
        this.addEventListener(selectEl, 'change', selectChangeHandler);

        const topControls = card.createDiv({ cls: "zen-audio-top-controls" });
        topControls.style.display = "flex";
        topControls.style.justifyContent = "space-between";
        topControls.style.alignItems = "baseline";

        this.playlistOrderEl = topControls.createSpan({ text: "", cls: "zen-playlist-display" });
        this.playlistOrderEl.style.fontSize = "0.75em";
        this.playlistOrderEl.style.color = "var(--text-muted)";
        this.playlistOrderEl.style.marginLeft = "5px";

        this.videoTitleEl = card.createDiv({ cls: "zen-video-title" });
        this.videoTitleEl.style.fontSize = "0.85em";
        this.videoTitleEl.style.fontWeight = "600";
        this.videoTitleEl.style.color = "var(--text-normal)";
        this.videoTitleEl.style.marginTop = "5px";
        this.videoTitleEl.style.whiteSpace = "nowrap";
        this.videoTitleEl.style.overflow = "hidden";
        this.videoTitleEl.style.textOverflow = "ellipsis";
        this.videoTitleEl.style.display = "none";

        const controlsRow = card.createDiv({ cls: "zen-audio-controls-row" });
        controlsRow.style.display = "flex";
        controlsRow.style.alignItems = "center";
        controlsRow.style.gap = "10px";
        controlsRow.style.marginTop = "10px";

        this.musicBtnEl = controlsRow.createEl("button", { cls: "zen-music-btn" });
        setIcon(this.musicBtnEl, "play");
        const musicBtnHandler = () => this.toggleMusic();
        this.addEventListener(this.musicBtnEl, 'click', musicBtnHandler);

        const prevBtn = controlsRow.createEl("button", { cls: "zen-music-btn-small" });
        setIcon(prevBtn, "skip-back");
        prevBtn.title = "Previous (Playlist)";
        const prevHandler = () => this.ytPlayer?.previousVideo();
        this.addEventListener(prevBtn, 'click', prevHandler);

        const nextBtn = controlsRow.createEl("button", { cls: "zen-music-btn-small" });
        setIcon(nextBtn, "skip-forward");
        nextBtn.title = "Next (Playlist)";
        const nextHandler = () => this.ytPlayer?.nextVideo();
        this.addEventListener(nextBtn, 'click', nextHandler);

        const shuffleBtn = controlsRow.createEl("button", { cls: "zen-music-btn-small" });
        setIcon(shuffleBtn, "shuffle");
        shuffleBtn.title = "Shuffle (Playlist)";
        if (this.isShuffle) shuffleBtn.addClass('is-active');
        const shuffleHandler = () => {
            this.isShuffle = !this.isShuffle;
            if (this.isShuffle) shuffleBtn.addClass('is-active');
            else shuffleBtn.removeClass('is-active');
            this.ytPlayer?.setShuffle(this.isShuffle);
        };
        this.addEventListener(shuffleBtn, 'click', shuffleHandler);

        // 🔁 Repeat Button
        const repeatBtn = controlsRow.createEl("button", { cls: "zen-music-btn-small" });
        this.updateRepeatButtonIcon(repeatBtn);
        const repeatHandler = () => {
            // Off → All → One → Off
            if (this.repeatMode === RepeatMode.Off) {
                this.repeatMode = RepeatMode.All;
                new Notice("🔁 Repeat: All");
            } else if (this.repeatMode === RepeatMode.All) {
                this.repeatMode = RepeatMode.One;
                new Notice("🔂 Repeat: One");
            } else {
                this.repeatMode = RepeatMode.Off;
                new Notice("Repeat: Off");
            }
            this.updateRepeatButtonIcon(repeatBtn);
            this.ytPlayer?.setRepeatMode(this.repeatMode);
        };
        this.addEventListener(repeatBtn, 'click', repeatHandler);

        const volumeWrapper = controlsRow.createDiv({ cls: "zen-volume-wrapper" });
        volumeWrapper.style.flexGrow = "1";
        volumeWrapper.style.display = "flex";
        volumeWrapper.style.alignItems = "center";
        volumeWrapper.style.gap = "8px";
        volumeWrapper.style.marginLeft = "auto";

        const volIcon = volumeWrapper.createDiv({ cls: "zen-label" });
        setIcon(volIcon, "volume-2");
        this.createSlider(volumeWrapper, (val) => {
            this.currentVolume = val;
            if (this.ytPlayer) this.ytPlayer.setVolume(val);
        });

        // loadTrackByReference を定義
        this.loadTrackByReference = (ref: MusicReference, autoPlay: boolean = true) => {
            const track = playlist[ref.trackIndex];
            if (!track) return;

            const info = this.extractYouTubeInfo(track.url);
            selectEl.value = ref.trackIndex.toString();

            if (!this.ytPlayer?.isPlayerReady()) return;

            // 🔥 現在のトラック情報を取得
            const current = this.ytPlayer.getCurrentTrackInfo();

            // 🔥 同じトラックかチェック
            const isSameTrack = 
                current.videoId === info.videoId && 
                current.listId === info.listId;

            if (isSameTrack) {
                // 🔥 同じトラック:チェックポイントへのシークのみ
                if (ref.checkpointIndex >= 0 && track.checkpoints && track.checkpoints[ref.checkpointIndex]) {
                    const timeStr = track.checkpoints[ref.checkpointIndex].time;
                    const sec = this.parseTimeString(timeStr);
                    this.ytPlayer.seekTo(sec);
                    if (autoPlay) this.ytPlayer.play();
                    new Notice(`⏩ Jumped to ${track.checkpoints[ref.checkpointIndex].label}`);
                } else if (autoPlay) {
                    this.ytPlayer.play();
                }
                return;
            }

            // 🔥 異なるトラック:loadを実行
            this.ytPlayer.loadVideoOrPlaylist(info.videoId, info.listId);

            if (ref.checkpointIndex >= 0 && track.checkpoints && track.checkpoints[ref.checkpointIndex]) {
                const timeStr = track.checkpoints[ref.checkpointIndex].time;
                const sec = this.parseTimeString(timeStr);
                setTimeout(() => {
                    this.ytPlayer?.seekTo(sec);
                    if (autoPlay) this.ytPlayer?.play();
                    new Notice(`🎵 Loaded: ${track.title} (${track.checkpoints![ref.checkpointIndex].label})`);
                }, 1500);
            } else {
                if (autoPlay) {
                    setTimeout(() => this.ytPlayer?.play(), 800);
                }
                new Notice(`🎵 Loaded: ${track.title}`);
            }

            this.renderCheckpoints(checkpointsContainer, track.checkpoints || []);
        };
    }

    private updatePlaylistUI(index: number, list: string[], title: string) {
        if (this.playlistOrderEl) {
            if (list?.length > 0) {
                this.playlistOrderEl.setText(`Video ${index + 1} / ${list.length}`);
            } else {
                this.playlistOrderEl.setText("");
            }
        }

        if (this.videoTitleEl) {
            if (title) {
                this.videoTitleEl.setText(title);
                this.videoTitleEl.style.display = "block";
            } else {
                this.videoTitleEl.style.display = "none";
            }
        }
    }

    loadTrackByReference: (ref: MusicReference, autoPlay?: boolean) => void = () => {};

    renderCheckpoints(container: HTMLElement, checkpoints: Checkpoint[]) {
        container.empty();
        if(!checkpoints || checkpoints.length === 0) return;
        container.createDiv({ cls: "zen-sub-label", text: "Quick Jump" });
        const grid = container.createDiv({ cls: "zen-chip-grid" });
        checkpoints.forEach((cp: Checkpoint, idx: number) => {
            const btn = grid.createEl("button", { cls: "zen-chip" });
            btn.setText(cp.label);
            const btnHandler = () => {
                const seconds = this.parseTimeString(cp.time);
                if (this.ytPlayer) {
                    this.ytPlayer.seekTo(seconds);
                    new Notice(`⏩ Jumped to ${cp.label}`);
                    if (!this.isMusicPlaying) this.toggleMusic();
                }
            };
            this.addEventListener(btn, 'click', btnHandler);
        });
    }

    playSequence(soundPath: string, durationSec: number, nextMusicRef: MusicReference | null, onComplete: () => void) {
        this.plugin.playLocalSound(soundPath);
        if (nextMusicRef) {
            this.loadTrackByReference(nextMusicRef, false);
        }
        if (soundPath && durationSec > 0) {
            new Notice(`Waiting ${durationSec}s...`);
            if (this.transitionTimeoutId) {
                window.clearTimeout(this.transitionTimeoutId);
            }
            this.transitionTimeoutId = window.setTimeout(() => {
                this.transitionTimeoutId = null;
                if (this.ytPlayer) {
                    this.ytPlayer.seekTo(0);
                    this.ytPlayer.setVolume(this.currentVolume);
                    this.ytPlayer.play();
                }
                this.isMusicPlaying = true;
                if(this.musicBtnEl) { setIcon(this.musicBtnEl, "pause"); this.musicBtnEl.addClass("is-playing"); }
                onComplete();
            }, durationSec * 1000);
        } else {
            if (this.ytPlayer) {
                this.ytPlayer.setVolume(this.currentVolume);
                this.ytPlayer.play();
            }
            this.isMusicPlaying = true;
            if(this.musicBtnEl) { setIcon(this.musicBtnEl, "pause"); this.musicBtnEl.addClass("is-playing"); }
            onComplete();
        }
    }

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
            const startBGMAndTimer = () => {
                this.isMusicPlaying = true;
                if(this.musicBtnEl) { setIcon(this.musicBtnEl, "pause"); this.musicBtnEl.addClass("is-playing"); }
                if (this.cycleCount === 0 && this.timeLeft === this.plugin.settings.workDuration * 60) {
                    this.startCycle(TimerState.Focus);
                } else {
                    this.runTimer();
                    this.playSceneMusic(this.currentState);
                    if (this.ytPlayer) {
                        this.ytPlayer.setVolume(this.currentVolume);
                        this.ytPlayer.play();
                    }
                }
                this.currentState = (this.timeLeft === this.plugin.settings.workDuration * 60) ? TimerState.Focus : this.currentState;
                if(this.currentState === TimerState.Idle) this.currentState = TimerState.Focus;
                btn.setText("Stop Focus");
                btn.addClass("is-active");
                setIcon(btn, "x");
                this.plugin.enterZenMode();
            };

            if (this.currentState === TimerState.Idle && this.cycleCount === 0 && this.timeLeft === this.plugin.settings.workDuration * 60) {
                const nextMusic = this.plugin.settings.workMusic[0];
                this.playSequence(this.plugin.settings.soundStart, this.plugin.settings.durationStart, nextMusic, startBGMAndTimer);
            } else {
                startBGMAndTimer();
            }
        }
    }

    resetSystem(btn: HTMLButtonElement) {
        this.stopTimer();
        if (this.transitionTimeoutId) {
            window.clearTimeout(this.transitionTimeoutId);
            this.transitionTimeoutId = null;
        }
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
        if (state === TimerState.Focus) this.timeLeft = this.plugin.settings.workDuration * 60;
        else if (state === TimerState.ShortBreak) this.timeLeft = this.plugin.settings.shortBreakDuration * 60;
        else if (state === TimerState.LongBreak) this.timeLeft = this.plugin.settings.longBreakDuration * 60;
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
            let statusIcon = "⏳";
            if (this.currentState === TimerState.Focus) statusIcon = "🔥";
            else if (this.currentState !== TimerState.Idle) statusIcon = "☕";
            this.plugin.updateStatusBar(`${statusIcon} ${timeStr}`);
            if (this.timeLeft <= 0) this.handlePhaseComplete();
        }, 1000);
    }

    stopTimer() { 
        if (this.timerInterval) { 
            window.clearInterval(this.timerInterval); 
            this.timerInterval = null; 
        } 
    }

    handlePhaseComplete() {
        this.stopTimer();
        const nextPhase = (newState: TimerState, msg?: string) => {
            if (msg) new Notice(msg);
            this.startCycle(newState);
        };

        const getNextMusic = (cycleIdx: number, state: TimerState) => {
            const idx = Math.min(cycleIdx, 3);
            return (state === TimerState.Focus) ? this.plugin.settings.workMusic[idx] : this.plugin.settings.breakMusic[idx];
        };

        if (this.currentState === TimerState.Focus) {
            if (this.cycleCount >= 3) {
                const nextMusic = getNextMusic(this.cycleCount, TimerState.LongBreak);
                this.playSequence(this.plugin.settings.soundFocusToLong, this.plugin.settings.durationFocusToLong, nextMusic, () => {
                    nextPhase(TimerState.LongBreak);
                });
            } else {
                const nextMusic = getNextMusic(this.cycleCount, TimerState.ShortBreak);
                this.playSequence(this.plugin.settings.soundFocusToShort, this.plugin.settings.durationFocusToShort, nextMusic, () => {
                    nextPhase(TimerState.ShortBreak);
                });
            }
        } else if (this.currentState === TimerState.ShortBreak) {
            this.cycleCount++;
            const nextMusic = getNextMusic(this.cycleCount, TimerState.Focus);
            this.playSequence(this.plugin.settings.soundShortToFocus, this.plugin.settings.durationShortToFocus, nextMusic, () => {
                nextPhase(TimerState.Focus, "🔔 Break is over. Back to Focus.");
            });
        } else if (this.currentState === TimerState.LongBreak) {
            this.cycleCount++;
            this.playSequence(this.plugin.settings.soundLongToFinish, this.plugin.settings.durationLongToFinish, null, () => {
                this.plugin.showBreakOverlay();
                this.resetSystem(this.containerEl.querySelector(".zen-main-btn") as HTMLButtonElement);
                new Notice("🎉 All Cycles Complete!");
            });
        }
    }

    playSceneMusic(state: TimerState) {
        let idx = Math.min(this.cycleCount, 3);
        let musicRef = (state === TimerState.Focus) ? this.plugin.settings.workMusic[idx] : this.plugin.settings.breakMusic[idx];
        if (musicRef) this.loadTrackByReference(musicRef);
    }

    updateStatusDisplay() {
        if (!this.statusLabelEl || !this.cycleIndicatorEl) return;
        let label = "Ready";
        if (this.currentState === TimerState.Focus) label = "🔥 FOCUS";
        else if (this.currentState === TimerState.ShortBreak) label = "☕ Break (Short)";
        else if (this.currentState === TimerState.LongBreak) label = "🌴 Break (Long)";
        this.statusLabelEl.setText(label);
        const currentVal = this.currentState === TimerState.Idle ? 0 : this.cycleCount + 1;
        this.cycleIndicatorEl.setText(`Cycle: ${Math.min(currentVal, 4)}/4`);
    }

    toggleMusic() {
        if (!this.ytPlayer) return;
        if (this.isMusicPlaying) {
            this.ytPlayer.pause();
            this.isMusicPlaying = false;
            if(this.musicBtnEl) { setIcon(this.musicBtnEl, "play"); this.musicBtnEl.removeClass("is-playing"); }
        } else {
            this.ytPlayer.play();
            this.isMusicPlaying = true;
            if(this.musicBtnEl) { setIcon(this.musicBtnEl, "pause"); this.musicBtnEl.addClass("is-playing"); }
        }
    }

    parseTimeString(timeStr: string): number {
        const parts = timeStr.split(':').map(Number);
        if (parts.length === 1) return parts[0];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return 0;
    }

	// 🔧 戻り値の型注釈を追加
	extractYouTubeInfo(input: string): { videoId: string | null; listId: string | null } {
		if (!input) return { videoId: null, listId: null };

		let videoId: string | null = null;
		let listId: string | null = null;

		const listMatch = input.match(/[?&]list=([a-zA-Z0-9_-]+)/);
		if (listMatch) listId = listMatch[1];

		if (/^[a-zA-Z0-9_-]{11}$/.test(input)) {
			videoId = input;
		} else {
			const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
			const match = input.match(regExp);
			if (match && match[2].length === 11) videoId = match[2];
		}

		return { videoId, listId };
	}

    createSlider(container: HTMLElement, callback: (val: number) => void) {
        const slider = container.createEl("input", { 
            type: "range", 
            cls: "zen-slider", 
            attr: { min: "0", max: "1", step: "0.05", value: this.currentVolume.toString() } 
        });
        const sliderHandler = (e: Event) => callback(parseFloat((e.target as HTMLInputElement).value));
        this.addEventListener(slider, 'input', sliderHandler);
    }

    formatTime(seconds: number): string {
        if (isNaN(seconds)) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    async onClose() {
        console.log("ZenView: Closing...");

        // 🔥 タイマー停止
        this.stopTimer();

        // 🔥 遷移タイムアウトクリア
        if (this.transitionTimeoutId) {
            window.clearTimeout(this.transitionTimeoutId);
            this.transitionTimeoutId = null;
        }

        // 🔥 イベントリスナー全削除
        this.removeAllEventListeners();

        // 🔥 YouTubeプレイヤー完全破棄
        if (this.ytPlayer) {
            this.ytPlayer.pause();

            // 🔥 1秒待ってから破棄(バッファクリアのため)
            await new Promise(resolve => setTimeout(resolve, 1000));

            this.ytPlayer.destroy();
            this.ytPlayer = null;

            console.log("ZenView: Player destroyed");
        }

        // 🔥 DOM参照を完全クリア
        this.taskCardEl = null;
        this.musicBtnEl = null;
        this.timerDisplayEl = null;
        this.statusLabelEl = null;
        this.cycleIndicatorEl = null;
        this.playlistOrderEl = null;
        this.videoTitleEl = null;

        // 🔥 コンテナも空にする
        const container = this.containerEl.children[1] as HTMLElement;
        if (container) {
            container.empty();
        }

        console.log("ZenView: Closed successfully");
    }
}

// =========================================================================
// TrackEditorModal クラス - 変更なし
// =========================================================================
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

        new Setting(contentEl)
            .setName("Title")
            .addText(text => text.setValue(this.track.title).onChange(value => this.track.title = value));

        new Setting(contentEl)
            .setName("URL")
            .addText(text => text.setValue(this.track.url).onChange(value => this.track.url = value));

        contentEl.createEl("h3", { text: "Checkpoints" });
        const checkpointsContainer = contentEl.createDiv();
        this.renderCheckpoints(checkpointsContainer);

        const footer = contentEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(footer)
            .setButtonText("Cancel")
            .onClick(() => this.close());
        new ButtonComponent(footer)
            .setButtonText("Save")
            .setCta()
            .onClick(() => {
                if(!this.track.title || !this.track.url) { 
                    new Notice("Required fields missing"); 
                    return; 
                }
                this.onSubmit(this.track);
                this.close();
            });
    }

    renderCheckpoints(container: HTMLElement) {
        container.empty();
        if (this.track.checkpoints && this.track.checkpoints.length > 0) {
            this.track.checkpoints.forEach((cp: Checkpoint, index: number) => {
                const row = container.createDiv({ cls: "zen-setting-checkpoint-row" });
                row.style.display = "flex"; 
                row.style.gap = "10px"; 
                row.style.marginBottom = "10px";

                const labelInput = row.createEl("input", { 
                    type: "text", 
                    value: cp.label, 
                    placeholder: "Label" 
                });
                labelInput.onchange = (e: any) => cp.label = e.target.value;

                const timeInput = row.createEl("input", { 
                    type: "text", 
                    value: cp.time, 
                    placeholder: "Time" 
                });
                timeInput.onchange = (e: any) => cp.time = e.target.value;

                const delBtn = row.createEl("button");
                setIcon(delBtn, "trash");
                delBtn.onclick = () => { 
                    this.track.checkpoints?.splice(index, 1); 
                    this.renderCheckpoints(container); 
                };
            });
        }
        new ButtonComponent(container)
            .setButtonText("+ Add Checkpoint")
            .onClick(() => {
                if (!this.track.checkpoints) this.track.checkpoints = [];
                this.track.checkpoints.push({ label: "", time: "" });
                this.renderCheckpoints(container);
            });
    }

    onClose() { 
        this.contentEl.empty(); 
    }
}

// =========================================================================
// ZenZoneSettingTab クラス - 変更なし
// =========================================================================
class ZenZoneSettingTab extends PluginSettingTab {
    plugin: ZenZonePlugin;
    tempSettings!: { work: number, short: number, long: number };

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

        containerEl.createEl('h3', { text: '⚙️ General' });

        new Setting(containerEl)
            .setName('Auto-collapse Sidebars')
            .setDesc('作業開始時にサイドバー(左右)を自動で閉じる')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoCollapseSidebars)
                .onChange(async (value) => { 
                    this.plugin.settings.autoCollapseSidebars = value; 
                    await this.plugin.saveSettings(); 
                }));

        new Setting(containerEl)
            .setName('Hide Header & UI Elements')
            .setDesc('作業開始時に上部のヘッダーやリボン等を非表示にする')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.hideHeader)
                .onChange(async (value) => { 
                    this.plugin.settings.hideHeader = value; 
                    await this.plugin.saveSettings(); 
                }));

        new Setting(containerEl)
            .setName('Show Timer in Status Bar')
            .setDesc('ステータスバーに残り時間を表示する')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showStatusBarTimer)
                .onChange(async (value) => { 
                    this.plugin.settings.showStatusBarTimer = value; 
                    await this.plugin.saveSettings(); 
                }));

        containerEl.createEl('h3', { text: '📝 Daily Note Logging' });

        new Setting(containerEl)
            .setName('Enable Auto-Log')
            .setDesc('タスク作成時にDaily Noteへ追記し、完了時に時間を記録する')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoLogToDaily)
                .onChange(async (value) => { 
                    this.plugin.settings.autoLogToDaily = value; 
                    await this.plugin.saveSettings(); 
                    this.display(); 
                }));

        if (this.plugin.settings.autoLogToDaily) {
            new Setting(containerEl)
                .setName('Daily Note Folder')
                .setDesc('Daily Noteの保存フォルダ (例: DailyNotes)。空欄はルート。')
                .addText(text => text
                    .setPlaceholder('DailyNotes')
                    .setValue(this.plugin.settings.dailyNoteFolder)
                    .onChange(async (value) => { 
                        this.plugin.settings.dailyNoteFolder = value; 
                        await this.plugin.saveSettings(); 
                    }));

            new Setting(containerEl)
                .setName('Date Format')
                .setDesc('ファイル名の日付形式 (例: YYYY-MM-DD)')
                .addText(text => text
                    .setPlaceholder('YYYY-MM-DD')
                    .setValue(this.plugin.settings.dailyNoteFormat)
                    .onChange(async (value) => { 
                        this.plugin.settings.dailyNoteFormat = value; 
                        await this.plugin.saveSettings(); 
                    }));

            new Setting(containerEl)
                .setName('Default Target Header')
                .setDesc('タスクを追加するデフォルトの見出し名')
                .addText(text => text
                    .setPlaceholder('Todo')
                    .setValue(this.plugin.settings.dailyNoteTargetHeader)
                    .onChange(async (value) => { 
                        this.plugin.settings.dailyNoteTargetHeader = value; 
                        await this.plugin.saveSettings(); 
                    }));
        }

        containerEl.createEl('h3', { text: '⏱ Timer Configuration' });

        this.createTimeSetting(containerEl, 
            "作業時間 (Focus)", 
            `基本: ${TIME_CONSTRAINTS.work.default}分 | 範囲: ${TIME_CONSTRAINTS.work.min} - ${TIME_CONSTRAINTS.work.max}分`, 
            TIME_CONSTRAINTS.work, 
            'work');

        this.createTimeSetting(containerEl, 
            "小休憩 (Short Break)", 
            `基本: ${TIME_CONSTRAINTS.shortBreak.default}分 | 範囲: ${TIME_CONSTRAINTS.shortBreak.min} - ${TIME_CONSTRAINTS.shortBreak.max}分`, 
            TIME_CONSTRAINTS.shortBreak, 
            'short');

        this.createTimeSetting(containerEl, 
            "大休憩 (Long Break)", 
            `基本: ${TIME_CONSTRAINTS.longBreak.default}分 | 範囲: ${TIME_CONSTRAINTS.longBreak.min} - ${TIME_CONSTRAINTS.longBreak.max}分`, 
            TIME_CONSTRAINTS.longBreak, 
            'long');

        const btnContainer = containerEl.createDiv({ cls: "zen-setting-apply-container" });
        btnContainer.style.marginTop = "10px"; 
        btnContainer.style.marginBottom = "10px"; 
        btnContainer.style.textAlign = "right";

        new ButtonComponent(btnContainer)
            .setButtonText("設定を保存・反映")
            .setCta()
            .onClick(async () => { this.saveTimeSettings(); });

        containerEl.createEl('h3', { text: '🔊 Sound Effects' });
        containerEl.createDiv({ 
            text: "Vault内の音声ファイルのパス(例: Assets/start.m4a)と、BGMを待機させる時間(秒)を指定してください。", 
            cls: "setting-item-description" 
        });

        this.addSoundSetting(containerEl, "Start Timer", "soundStart", "durationStart");
        this.addSoundSetting(containerEl, "Focus → Short Break", "soundFocusToShort", "durationFocusToShort");
        this.addSoundSetting(containerEl, "Short Break → Focus", "soundShortToFocus", "durationShortToFocus");
        this.addSoundSetting(containerEl, "Focus → Long Break", "soundFocusToLong", "durationFocusToLong");
        this.addSoundSetting(containerEl, "Long Break → Finish", "soundLongToFinish", "durationLongToFinish");

        containerEl.createEl('h3', { text: '🎵 Cycle Music Schedule' });
        containerEl.createDiv({ 
            text: "Configure different music for each of the 4 cycles.", 
            cls: "setting-item-description" 
        });

        for (let i = 0; i < 4; i++) {
            const isLast = i === 3;
            containerEl.createEl('h4', { text: `Cycle ${i + 1}`, cls: "zen-cycle-header" });
            this.addMusicSetting(containerEl, `Focus Music`, "", this.plugin.settings.workMusic[i]);
            this.addMusicSetting(containerEl, `Break Music (${isLast ? 'Long' : 'Short'})`, "", this.plugin.settings.breakMusic[i]);
        }

        containerEl.createEl('h3', { text: 'Playlist Manager' });
        const listContainer = containerEl.createDiv();
        this.renderTrackList(listContainer);

        const addContainer = containerEl.createDiv({ cls: "zen-setting-add-container" });
        addContainer.style.marginTop = "10px";
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

    addSoundSetting(container: HTMLElement, name: string, pathKey: keyof ZenZoneSettings, durKey: keyof ZenZoneSettings) {
        const s = new Setting(container).setName(name);

        s.addText(text => text
            .setPlaceholder("File Path")
            .setValue(String(this.plugin.settings[pathKey]))
            .onChange(async val => { 
                (this.plugin.settings as any)[pathKey] = val; 
                await this.plugin.saveSettings(); 
            }));

        s.addText(text => text
            .setPlaceholder("Sec")
            .setValue(String(this.plugin.settings[durKey]))
            .inputEl.style.width="50px");

        const durInput = s.controlEl.querySelectorAll('input[type="text"]')[1] as HTMLInputElement;
        durInput.type = "number";
        durInput.onchange = async (e: any) => { 
            const val = parseInt(e.target.value) || 0; 
            (this.plugin.settings as any)[durKey] = val; 
            await this.plugin.saveSettings(); 
        };
    }

    async saveTimeSettings() {
        const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);
        const wLimit = TIME_CONSTRAINTS.work, sLimit = TIME_CONSTRAINTS.shortBreak, lLimit = TIME_CONSTRAINTS.longBreak;

        this.plugin.settings.workDuration = clamp(this.tempSettings.work, wLimit.min, wLimit.max);
        this.plugin.settings.shortBreakDuration = clamp(this.tempSettings.short, sLimit.min, sLimit.max);
        this.plugin.settings.longBreakDuration = clamp(this.tempSettings.long, lLimit.min, lLimit.max);

        await this.plugin.saveSettings();
        this.resetTempSettings();
        this.display();
        new Notice("Time settings saved!");
    }

    addMusicSetting(container: HTMLElement, name: string, desc: string, targetRef: MusicReference) {
        const setting = new Setting(container).setName(name).setDesc(desc);

        setting.addDropdown(dropdown => {
            this.plugin.settings.playlistData.forEach((track: PlaylistItem, idx: number) => {
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
                selectedTrack.checkpoints.forEach((cp: Checkpoint, idx: number) => {
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
        this.plugin.settings.playlistData.forEach((track: PlaylistItem, index: number) => {
            new Setting(container)
                .setName(track.title)
                .setDesc(track.url)
                .addButton(btn => btn
                    .setIcon("pencil")
                    .onClick(() => {
                        new TrackEditorModal(this.app, track, async (updatedTrack) => {
                            this.plugin.settings.playlistData[index] = updatedTrack; 
                            await this.plugin.saveSettings(); 
                            this.display();
                        }).open();
                    }))
                .addButton(btn => btn
                    .setIcon("trash")
                    .setClass("zen-danger-btn")
                    .onClick(async () => {
                        this.plugin.settings.playlistData.splice(index, 1); 
                        await this.plugin.saveSettings(); 
                        this.display(); 
                        new Notice("Track deleted.");
                    }));
        });
    }
}
