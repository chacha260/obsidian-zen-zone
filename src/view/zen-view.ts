import { ItemView, WorkspaceLeaf } from "obsidian";
import type ZenZonePlugin from "../main";
import { VIEW_TYPE_ZEN } from "../constants";
import { TranslationKey, t } from "../i18n";
import type { SessionListener } from "../session";
import { TimerState } from "../types";
import { formatTime } from "../utils";
import { AudioCard } from "./audio-card";
import { TaskCard } from "./task-card";
import { TimerCard } from "./timer-card";

const PHASE_LABEL: Record<TimerState, TranslationKey> = {
	[TimerState.Idle]: "phase.ready",
	[TimerState.Focus]: "phase.focus",
	[TimerState.ShortBreak]: "phase.shortBreak",
	[TimerState.LongBreak]: "phase.longBreak"
};

/**
 * The Zen Zone side panel. It renders the plugin's session and audio engine
 * rather than owning them, so closing the panel frees its DOM while the
 * pomodoro and the music carry on.
 */
export class ZenView extends ItemView implements SessionListener {
	private taskCard: TaskCard | null = null;
	private timerCard: TimerCard | null = null;
	private audioCard: AudioCard | null = null;
	private stopListening: (() => void) | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: ZenZonePlugin) {
		super(leaf);
	}

	getViewType(): string { return VIEW_TYPE_ZEN; }
	getDisplayText(): string { return "Zen Zone"; }
	getIcon(): string { return "zap"; }

	// --- Lifecycle -------------------------------------------------------

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("zen-view-container");

		container.createDiv({ cls: "zen-header" }).createEl("h2", { text: "Zen Zone" });

		this.taskCard = new TaskCard(container.createDiv({ cls: "zen-card zen-task-card" }), this.plugin);
		this.taskCard.render();

		const session = this.plugin.session;
		this.timerCard = new TimerCard(container.createDiv(), {
			onToggle: () => session.toggle(),
			onSkip: () => session.skip(),
			onReset: () => session.reset()
		});
		this.timerCard.render(formatTime(session.remainingSeconds));

		this.audioCard = new AudioCard(container.createDiv(), this.plugin);
		this.audioCard.render();

		container.createDiv({ text: t("view.footer"), cls: "zen-footer-note" });

		session.attach(this);
		this.stopListening = this.plugin.onDataChange(() => this.onDataChange());
		this.renderStats();
	}

	/** Tasks, history or the playlist changed somewhere else. */
	private onDataChange(): void {
		this.taskCard?.refresh();
		this.audioCard?.fillTrackOptions();
		this.renderStats();
	}

	private renderStats(): void {
		const { today, week } = this.plugin.focusStats();
		this.timerCard?.setStats(
			t("timer.stats", {
				todaySessions: today.sessions,
				todayMinutes: today.minutes,
				weekSessions: week.sessions,
				weekMinutes: week.minutes
			})
		);
	}

	async onClose(): Promise<void> {
		this.plugin.session.detach(this);
		this.stopListening?.();
		this.stopListening = null;

		this.taskCard?.destroy();
		this.timerCard?.destroy();
		this.audioCard?.destroy();

		this.taskCard = null;
		this.timerCard = null;
		this.audioCard = null;

		(this.containerEl.children[1] as HTMLElement | undefined)?.empty();
	}

	// --- SessionListener -------------------------------------------------

	onTick(remainingSeconds: number): void {
		this.timerCard?.setTime(formatTime(remainingSeconds));
	}

	onStateChange(): void {
		const { phase, running, cycleCount, totalCycles, active } = this.plugin.session;

		this.timerCard?.setRunning(running, active);

		const phaseLabel = t(PHASE_LABEL[active ? phase : TimerState.Idle]);
		const label = active && !running ? `⏸ ${phaseLabel}` : phaseLabel;
		const current = active ? Math.min(cycleCount + 1, totalCycles) : 0;
		this.timerCard?.setStatus(label, t("timer.cycle", { current, total: totalCycles }));
	}
}
