import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
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

		// The timer leads: it is what gets glanced at, and it stays put while
		// the sections below it fold away.
		const session = this.plugin.session;
		this.timerCard = new TimerCard(container.createDiv(), {
			onToggle: () => session.toggle(),
			onSkip: () => session.skip(),
			onReset: () => session.reset()
		});
		this.timerCard.render(formatTime(session.remainingSeconds));

		this.taskCard = new TaskCard(this.createSection(container, "tasks", t("section.tasks"), "zen-task-card"), this.plugin);
		this.taskCard.render();

		this.audioCard = new AudioCard(this.createSection(container, "audio", t("section.audio")), this.plugin);
		this.audioCard.render();

		container.createDiv({ text: t("view.footer"), cls: "zen-footer-note" });

		session.attach(this);
		this.stopListening = this.plugin.onDataChange(() => this.onDataChange());
		this.renderStats();
	}

	/** A card with a header that folds its body away; the choice is remembered. */
	private createSection(container: HTMLElement, key: string, title: string, bodyClass = ""): HTMLElement {
		const collapsed = this.plugin.settings.collapsedSections;
		const card = container.createDiv({ cls: "zen-card zen-section" });
		const header = card.createEl("button", { cls: "zen-section-header" });
		setIcon(header.createSpan({ cls: "zen-section-chevron" }), "chevron-down");
		header.createSpan({ text: title });
		const body = card.createDiv({ cls: `zen-section-body ${bodyClass}`.trim() });

		const apply = () => {
			const isCollapsed = collapsed.includes(key);
			card.toggleClass("is-collapsed", isCollapsed);
			header.setAttribute("aria-expanded", String(!isCollapsed));
		};
		apply();

		this.registerDomEvent(header, "click", () => {
			if (collapsed.includes(key)) collapsed.remove(key);
			else collapsed.push(key);
			apply();
			void this.plugin.saveSettings();
		});
		return body;
	}

	/** Tasks, history or the playlist changed somewhere else. */
	private onDataChange(): void {
		this.taskCard?.refresh();
		this.audioCard?.fillTrackOptions();
		this.renderStats();
	}

	private renderStats(): void {
		const { today, week, days } = this.plugin.focusStats();
		this.timerCard?.setStats(
			t("timer.stats", {
				todaySessions: today.sessions,
				todayMinutes: today.minutes,
				weekSessions: week.sessions,
				weekMinutes: week.minutes
			}),
			days.map((day) => ({
				label: day.label,
				minutes: day.minutes,
				tooltip: t("timer.dayStats", { day: day.label, sessions: day.sessions, minutes: day.minutes })
			}))
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
		this.timerCard?.setProgress(this.plugin.session.progress);
	}

	onStateChange(): void {
		const { phase, running, cycleCount, totalCycles, active } = this.plugin.session;

		this.timerCard?.setRunning(running, active);

		const phaseLabel = t(PHASE_LABEL[active ? phase : TimerState.Idle]);
		const label = active && !running ? `⏸ ${phaseLabel}` : phaseLabel;
		const currentCycle = active ? Math.min(cycleCount, totalCycles - 1) : -1;
		const cycleText = t("timer.cycle", { current: currentCycle + 1, total: totalCycles });
		const onBreak = active && phase !== TimerState.Focus;
		this.timerCard?.setStatus(label, currentCycle, totalCycles, cycleText, onBreak);
		this.timerCard?.setProgress(this.plugin.session.progress);
	}
}
