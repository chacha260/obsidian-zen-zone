import { ItemView, WorkspaceLeaf } from "obsidian";
import type ZenZonePlugin from "../main";
import { CYCLE_COUNT, VIEW_TYPE_ZEN } from "../constants";
import type { SessionListener } from "../session";
import { TimerState } from "../types";
import { formatTime } from "../utils";
import { AudioCard } from "./audio-card";
import { TaskCard } from "./task-card";
import { TimerCard } from "./timer-card";

const PHASE_LABEL: Record<TimerState, string> = {
	[TimerState.Idle]: "Ready",
	[TimerState.Focus]: "🔥 FOCUS",
	[TimerState.ShortBreak]: "☕ Break (Short)",
	[TimerState.LongBreak]: "🌴 Break (Long)"
};

/**
 * The Zen Zone side panel. It renders the plugin's session rather than owning
 * it, so closing the panel frees its DOM and its YouTube player while the
 * pomodoro keeps running in the status bar.
 */
export class ZenView extends ItemView implements SessionListener {
	private taskCard: TaskCard | null = null;
	private timerCard: TimerCard | null = null;
	private audioCard: AudioCard | null = null;

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
			onReset: () => session.reset()
		});
		this.timerCard.render(formatTime(session.remainingSeconds));

		this.audioCard = new AudioCard(container.createDiv(), this.plugin);
		this.audioCard.render();

		container.createDiv({ text: "Cycle & Music settings in plugin options.", cls: "zen-footer-note" });

		session.attach(this, this.audioCard);
	}

	async onClose(): Promise<void> {
		this.plugin.session.detach(this);

		this.taskCard?.destroy();
		this.timerCard?.destroy();
		await this.audioCard?.destroy();

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
		const { phase, running, cycleCount, active } = this.plugin.session;

		this.timerCard?.setRunning(running, active);

		const label = !active ? PHASE_LABEL[TimerState.Idle] : running ? PHASE_LABEL[phase] : `⏸ ${PHASE_LABEL[phase]}`;
		const current = active ? Math.min(cycleCount + 1, CYCLE_COUNT) : 0;
		this.timerCard?.setStatus(label, `Cycle: ${current}/${CYCLE_COUNT}`);
	}
}
