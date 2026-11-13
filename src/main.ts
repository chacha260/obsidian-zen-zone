import { Menu, Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { AudioEngine } from "./audio/engine";
import {
	DEFAULT_BREAK_REF,
	DEFAULT_MUSIC_REF,
	DEFAULT_SETTINGS,
	HISTORY_DAYS,
	MAX_CYCLES,
	VIEW_TYPE_ZEN
} from "./constants";
import { DailyNoteService } from "./daily-note";
import { t } from "./i18n";
import { formatClock, now, startOfDay } from "./moment";
import { FocusSession } from "./session";
import { DayStats, MusicReference, ZenZoneSettings } from "./types";
import { clamp } from "./utils";
import { ZenView } from "./view/zen-view";
import { ZenZoneSettingTab } from "./settings/settings-tab";

/** Longest task name shown in the status bar before it is cut short. */
const STATUS_TASK_LENGTH = 28;

const ZEN_MODE_CLASSES = ["zen-mode-active", "zen-hide-header", "zen-keep-status-bar"];

export default class ZenZonePlugin extends Plugin {
	settings!: ZenZoneSettings;
	dailyNotes!: DailyNoteService;
	/** Owned here rather than by the view, so music outlives the Zen panel. */
	audio!: AudioEngine;
	/** Owned here rather than by the view, so a session outlives the Zen panel. */
	session!: FocusSession;

	private statusBarItem: HTMLElement | null = null;
	/** One reused element for every transition cue, instead of one per playback. */
	private cueAudio: HTMLAudioElement | null = null;
	/** Sidebars this plugin collapsed for zen mode, to be reopened afterwards. */
	private collapsedSides: Array<"left" | "right"> = [];
	private zenModeActive = false;
	private readonly dataListeners = new Set<() => void>();

	async onload(): Promise<void> {
		await this.loadSettings();
		this.dailyNotes = new DailyNoteService(this.app, () => this.settings);

		this.statusBarItem = this.addStatusBarItem();
		this.statusBarItem.addClass("mod-clickable");
		this.registerDomEvent(this.statusBarItem, "click", (event) => this.showStatusBarMenu(event));
		this.updateStatusBar("");

		this.audio = new AudioEngine(this);
		this.session = new FocusSession(this, this.audio);
		this.register(() => this.session.dispose());
		this.register(() => this.audio.dispose());

		// Zen mode restyles the whole app, so a window opened mid-session has to catch up.
		this.registerEvent(
			this.app.workspace.on("window-open", (workspaceWindow) => {
				if (this.zenModeActive) workspaceWindow.doc.body.addClasses(this.zenModeClasses());
			})
		);

		this.addSettingTab(new ZenZoneSettingTab(this.app, this));
		this.registerView(VIEW_TYPE_ZEN, (leaf) => new ZenView(leaf, this));
		this.addRibbonIcon("zap", t("ribbon.open"), () => void this.activateView());

		// Session and music run without the panel, so they need panel-free controls.
		this.addCommand({ id: "open-panel", name: t("command.open"), callback: () => void this.activateView() });
		this.addCommand({ id: "toggle-focus-timer", name: t("command.toggle"), callback: () => this.session.toggle() });
		this.addCommand({ id: "skip-phase", name: t("command.skip"), callback: () => this.session.skip() });
		this.addCommand({ id: "reset-focus-session", name: t("command.reset"), callback: () => this.session.reset() });
		this.addCommand({ id: "toggle-music", name: t("command.music"), callback: () => this.audio.toggle() });
		this.addCommand({ id: "next-track", name: t("command.next"), callback: () => this.audio.next() });
	}

	onunload(): void {
		this.clearZenMode();
		this.releaseCueAudio();
		this.dataListeners.clear();
	}

	// --- Settings --------------------------------------------------------

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<ZenZoneSettings> | null;
		const merged: ZenZoneSettings = Object.assign({}, DEFAULT_SETTINGS, loaded);

		merged.cycles = clamp(Math.round(Number(merged.cycles)) || DEFAULT_SETTINGS.cycles, 1, MAX_CYCLES);
		merged.volume = clamp(Number(merged.volume) || 0, 0, 1);
		merged.tasks = Array.isArray(merged.tasks) ? merged.tasks : [];
		// Only today's completions are kept; yesterday's are history in the daily note.
		const today = startOfDay();
		merged.doneTasks = Array.isArray(merged.doneTasks) ? merged.doneTasks.filter((done) => done?.task && done.at >= today) : [];
		merged.collapsedSections = Array.isArray(merged.collapsedSections) ? merged.collapsedSections : [];
		merged.playlistData = Array.isArray(merged.playlistData) ? merged.playlistData : [];
		merged.history = merged.history && typeof merged.history === "object" ? { ...merged.history } : {};

		this.settings = merged;
		this.fitMusicSchedules();
		this.pruneHistory();
	}

	/**
	 * Makes both music schedules exactly one entry per cycle. Before per-cycle
	 * schedules these settings held a single reference, which is spread over
	 * every cycle; a longer run repeats the last cycle's choice.
	 */
	fitMusicSchedules(): void {
		const fit = (value: unknown, fallback: MusicReference): MusicReference[] => {
			const list = Array.isArray(value) ? (value as MusicReference[]) : value ? [value as MusicReference] : [];
			return Array.from({ length: this.settings.cycles }, (_, i) => ({
				...(list[i] ?? list[list.length - 1] ?? fallback)
			}));
		};
		this.settings.workMusic = fit(this.settings.workMusic, DEFAULT_MUSIC_REF);
		this.settings.breakMusic = fit(this.settings.breakMusic, DEFAULT_BREAK_REF);
	}

	/**
	 * Keeps the per-cycle schedules pointing at the same tracks after the track
	 * at `removedIndex` was deleted from the playlist.
	 */
	repairMusicSchedules(removedIndex: number): void {
		for (const ref of [...this.settings.workMusic, ...this.settings.breakMusic]) {
			if (ref.trackIndex === removedIndex) {
				ref.trackIndex = 0;
				ref.checkpointIndex = -1;
			} else if (ref.trackIndex > removedIndex) {
				ref.trackIndex--;
			}
		}
	}

	/** Moves a playlist track, keeping the per-cycle schedules on the tracks they pointed at. */
	moveTrack(oldIndex: number, newIndex: number): void {
		const playlist = this.settings.playlistData;
		if (oldIndex === newIndex || !playlist[oldIndex] || newIndex < 0 || newIndex >= playlist.length) return;

		const order = playlist.map((_, index) => index);
		const [moved] = order.splice(oldIndex, 1);
		order.splice(newIndex, 0, moved);

		this.settings.playlistData = order.map((index) => playlist[index]);
		for (const ref of [...this.settings.workMusic, ...this.settings.breakMusic]) {
			const position = order.indexOf(ref.trackIndex);
			if (position >= 0) ref.trackIndex = position;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Lets open views repaint when tasks, history or the playlist change behind them. */
	onDataChange(listener: () => void): () => void {
		this.dataListeners.add(listener);
		return () => this.dataListeners.delete(listener);
	}

	notifyDataChange(): void {
		for (const listener of this.dataListeners) listener();
	}

	// --- Focus history ---------------------------------------------------

	private pruneHistory(): void {
		const keys = Object.keys(this.settings.history).sort();
		for (const key of keys.slice(0, Math.max(0, keys.length - HISTORY_DAYS))) {
			delete this.settings.history[key];
		}
	}

	/** Focus totals for each of the last seven days, oldest first and ending with today. */
	focusStats(): { today: DayStats; week: DayStats; days: Array<DayStats & { label: string }> } {
		const days = Array.from({ length: 7 }, (_, i) => {
			const start = startOfDay(6 - i);
			const stats = this.settings.history[formatClock(start, "YYYY-MM-DD")] ?? { sessions: 0, minutes: 0 };
			return { ...stats, label: formatClock(start, "dd") };
		});
		const week = days.reduce<DayStats>(
			(sum, day) => ({ sessions: sum.sessions + day.sessions, minutes: sum.minutes + day.minutes }),
			{ sessions: 0, minutes: 0 }
		);
		return { today: days[days.length - 1], week, days };
	}

	/** Books a finished focus phase: history, the current task's tally, and the daily note. */
	async recordFocusSession(startedAtMs: number, minutes: number): Promise<void> {
		const day = now().format("YYYY-MM-DD");
		const stats = (this.settings.history[day] ??= { sessions: 0, minutes: 0 });
		stats.sessions++;
		stats.minutes += minutes;
		this.pruneHistory();

		const task = this.settings.tasks[0];
		if (task) task.pomodoros = (task.pomodoros ?? 0) + 1;

		await this.saveSettings();
		this.notifyDataChange();

		if (this.settings.logSessionsToDaily) {
			const span = `${formatClock(startedAtMs, "HH:mm")}–${now().format("HH:mm")}`;
			const label = task?.content ?? t("log.focus");
			await this.dailyNotes.appendLine(`- ${span} 🍅 ${label}`, this.settings.sessionLogHeader || "Focus log");
		}
	}

	// --- View ------------------------------------------------------------

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_ZEN)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_ZEN, active: true });
		}
		if (leaf) await workspace.revealLeaf(leaf);
	}

	// --- Status bar and notifications ------------------------------------

	/** Shows the countdown, followed by the task it counts towards. Empty text hides the item. */
	updateStatusBar(text: string): void {
		if (!this.statusBarItem) return;
		if (!this.settings.showStatusBarTimer || !text) {
			this.statusBarItem.hide();
			return;
		}
		const task = this.settings.tasks[0]?.content ?? "";
		const shown = task.length > STATUS_TASK_LENGTH ? `${task.slice(0, STATUS_TASK_LENGTH - 1)}…` : task;
		this.statusBarItem.setText(shown ? `${text} · ${shown}` : text);
		this.statusBarItem.show();
	}

	/** The session and the music, one click away without opening the panel. */
	private showStatusBarMenu(event: MouseEvent): void {
		const { session, audio } = this;
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t(session.running ? "timer.pause" : session.active ? "timer.resume" : "timer.start"))
				.setIcon(session.running ? "pause" : "play")
				.onClick(() => session.toggle())
		);
		menu.addItem((item) =>
			item
				.setTitle(t("timer.skip"))
				.setIcon("skip-forward")
				.setDisabled(!session.active)
				.onClick(() => session.skip())
		);
		menu.addItem((item) => item.setTitle(t("command.reset")).setIcon("rotate-ccw").onClick(() => session.reset()));
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t("command.music"))
				.setIcon(audio.playing ? "pause" : "music")
				.onClick(() => audio.toggle())
		);
		menu.addItem((item) => item.setTitle(t("command.next")).setIcon("skip-forward").onClick(() => audio.next()));
		menu.addSeparator();
		menu.addItem((item) => item.setTitle(t("command.open")).setIcon("zap").onClick(() => void this.activateView()));
		menu.showAtMouseEvent(event);
	}

	/**
	 * Announces a phase change: always in the app, and through the system when
	 * the app is in the background and would otherwise go unnoticed.
	 */
	announce(message: string): void {
		new Notice(message);
		if (!this.settings.systemNotifications || this.appDocuments().some((doc) => doc.hasFocus())) return;
		try {
			if (typeof Notification !== "undefined" && Notification.permission === "granted") {
				new Notification("Zen Zone", { body: message });
			}
		} catch {
			// Not every platform can raise system notifications; the notice is enough.
		}
	}

	// --- Zen mode --------------------------------------------------------

	enterZenMode(): void {
		if (this.zenModeActive) return;
		this.zenModeActive = true;

		if (this.settings.autoCollapseSidebars) {
			const { leftSplit, rightSplit } = this.app.workspace;
			this.collapsedSides = [];
			if (leftSplit && !leftSplit.collapsed) {
				leftSplit.collapse();
				this.collapsedSides.push("left");
			}
			if (rightSplit && !rightSplit.collapsed) {
				rightSplit.collapse();
				this.collapsedSides.push("right");
			}
		}
		const classes = this.zenModeClasses();
		for (const doc of this.appDocuments()) doc.body.addClasses(classes);
		new Notice(t("notice.focusOn"));
	}

	exitZenMode(): void {
		const wasActive = this.zenModeActive;
		this.clearZenMode();
		if (!wasActive) return;

		// Put back only what zen mode itself closed.
		for (const side of this.collapsedSides) {
			(side === "left" ? this.app.workspace.leftSplit : this.app.workspace.rightSplit)?.expand();
		}
		this.collapsedSides = [];
		new Notice(t("notice.focusOff"));
	}

	/** Undoes the zen-mode DOM changes without announcing it, for teardown. */
	private clearZenMode(): void {
		this.zenModeActive = false;
		for (const doc of this.appDocuments()) doc.body.removeClasses(ZEN_MODE_CLASSES);
		this.updateStatusBar("");
	}

	private zenModeClasses(): string[] {
		const classes = ["zen-mode-active"];
		if (this.settings.hideHeader) classes.push("zen-hide-header");
		// The status bar is part of the chrome, but not when it carries the timer.
		if (this.settings.showStatusBarTimer) classes.push("zen-keep-status-bar");
		return classes;
	}

	/** The document of the main window and of every popout window. */
	private appDocuments(): Document[] {
		const documents = new Set<Document>([this.app.workspace.containerEl.ownerDocument]);
		this.app.workspace.iterateAllLeaves((leaf) => documents.add(leaf.view.containerEl.ownerDocument));
		return [...documents];
	}

	// --- Transition cues -------------------------------------------------

	/** Resolves a vault path to a playable URL, or null when the file is missing. */
	resolveSoundSrc(path: string): string | null {
		if (!path) return null;
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
	}

	/** Plays a cue from the vault through the one shared audio element. */
	playLocalSound(path: string): void {
		const src = this.resolveSoundSrc(path);
		if (!src) return;

		const audio = (this.cueAudio ??= this.createCueAudio());
		audio.pause();
		audio.src = src;
		audio.play().catch((error) => console.error("Zen Zone: failed to play sound", error));
	}

	/** Cuts off a cue that is still playing, for when its transition is cancelled. */
	stopLocalSound(): void {
		if (!this.cueAudio) return;
		this.cueAudio.pause();
		this.dropCueBuffer();
	}

	private createCueAudio(): HTMLAudioElement {
		const audio = new Audio();
		// Drop the decoded buffer as soon as the cue finishes.
		audio.addEventListener("ended", () => this.dropCueBuffer());
		return audio;
	}

	private dropCueBuffer(): void {
		if (!this.cueAudio) return;
		this.cueAudio.removeAttribute("src");
		this.cueAudio.load();
	}

	private releaseCueAudio(): void {
		if (!this.cueAudio) return;
		this.cueAudio.pause();
		this.dropCueBuffer();
		this.cueAudio = null;
	}
}
