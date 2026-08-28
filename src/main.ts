import { Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { CYCLE_COUNT, DEFAULT_BREAK_REF, DEFAULT_MUSIC_REF, DEFAULT_SETTINGS, VIEW_TYPE_ZEN, createMusicSchedule } from "./constants";
import { DailyNoteService } from "./daily-note";
import { FocusSession } from "./session";
import { MusicReference, ZenZoneSettings } from "./types";
import { ZenView } from "./view/zen-view";
import { ZenZoneSettingTab } from "./settings/settings-tab";

export default class ZenZonePlugin extends Plugin {
	settings!: ZenZoneSettings;
	dailyNotes!: DailyNoteService;
	/** Owned here rather than by the view, so a session outlives the Zen panel. */
	session!: FocusSession;

	private statusBarItem: HTMLElement | null = null;
	private overlayEl: HTMLElement | null = null;
	/** One reused element for every transition cue, instead of one per playback. */
	private cueAudio: HTMLAudioElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.dailyNotes = new DailyNoteService(this.app, () => this.settings);

		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar("");

		this.session = new FocusSession(this);
		this.register(() => this.session.dispose());

		this.addSettingTab(new ZenZoneSettingTab(this.app, this));
		this.registerView(VIEW_TYPE_ZEN, (leaf) => new ZenView(leaf, this));
		this.addRibbonIcon("zap", "Open Zen Zone", () => void this.activateView());

		// The session runs without the panel, so it needs panel-free controls.
		this.addCommand({
			id: "toggle-focus-timer",
			name: "Start or pause the focus timer",
			callback: () => this.session.toggle()
		});
		this.addCommand({
			id: "reset-focus-session",
			name: "Reset the focus session",
			callback: () => this.session.reset()
		});
	}

	onunload(): void {
		this.clearZenMode();
		this.removeBreakOverlay();
		this.releaseCueAudio();
	}

	// --- Settings --------------------------------------------------------

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<ZenZoneSettings> | null;
		const merged: ZenZoneSettings = Object.assign({}, DEFAULT_SETTINGS, loaded);

		// Before per-cycle schedules, these settings held a single MusicReference.
		merged.workMusic = this.normalizeSchedule(loaded?.workMusic, DEFAULT_MUSIC_REF);
		merged.breakMusic = this.normalizeSchedule(loaded?.breakMusic, DEFAULT_BREAK_REF);

		this.settings = merged;
	}

	private normalizeSchedule(value: unknown, fallback: MusicReference): MusicReference[] {
		if (!Array.isArray(value)) {
			return createMusicSchedule((value as MusicReference | undefined) ?? fallback);
		}
		return Array.from({ length: CYCLE_COUNT }, (_, i) => ({ ...(value[i] ?? fallback) }));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	// --- View ------------------------------------------------------------

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_ZEN)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_ZEN, active: true });
		}
		if (leaf) workspace.revealLeaf(leaf);
	}

	// --- Status bar ------------------------------------------------------

	updateStatusBar(text: string): void {
		if (!this.statusBarItem) return;
		if (this.settings.showStatusBarTimer && text) {
			this.statusBarItem.setText(text);
			this.statusBarItem.show();
		} else {
			this.statusBarItem.hide();
		}
	}

	// --- Zen mode --------------------------------------------------------

	enterZenMode(): void {
		document.body.addClass("zen-mode-active");
		if (this.settings.autoCollapseSidebars) {
			this.app.workspace.leftSplit?.collapse();
			this.app.workspace.rightSplit?.collapse();
		}
		if (this.settings.hideHeader) document.body.addClass("zen-hide-header");
		new Notice("🧘 Focus Mode On");
	}

	exitZenMode(): void {
		const wasActive = document.body.hasClass("zen-mode-active");
		this.clearZenMode();
		if (wasActive) new Notice("Focus Mode Off");
	}

	/** Undoes the zen-mode DOM changes without announcing it, for teardown. */
	private clearZenMode(): void {
		document.body.removeClasses(["zen-mode-active", "zen-hide-header"]);
		this.updateStatusBar("");
	}

	showBreakOverlay(): void {
		this.removeBreakOverlay();
		this.overlayEl = document.body.createDiv({ cls: "zen-break-overlay" });
		const content = this.overlayEl.createDiv({ cls: "zen-break-content" });
		content.createEl("h1", { text: "🎉 Session Complete" });
		content.createDiv({ text: `Great work! You've completed ${CYCLE_COUNT} cycles.` });
		content.createEl("button", { text: "Finish" }).addEventListener("click", () => this.removeBreakOverlay());
	}

	private removeBreakOverlay(): void {
		this.overlayEl?.remove();
		this.overlayEl = null;
	}

	// --- Transition cues -------------------------------------------------

	/** Resolves a vault path to a playable URL, or null when the file is missing. */
	resolveSoundSrc(path: string): string | null {
		if (!path) return null;
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		return file instanceof TFile ? this.app.vault.adapter.getResourcePath(file.path) : null;
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
