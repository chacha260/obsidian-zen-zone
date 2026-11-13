import { setIcon } from "obsidian";
import { DomListenerRegistry } from "../dom";
import { t } from "../i18n";

export interface TimerCardHandlers {
	onToggle(): void;
	onSkip(): void;
	onReset(): void;
}

const RING_RADIUS = 54;

/** The timer card: phase label, cycle dots, a countdown inside a progress ring, its buttons and the focus totals. */
export class TimerCard {
	private readonly listeners = new DomListenerRegistry();
	private cardEl: HTMLElement | null = null;
	private ringEl: HTMLElement | null = null;
	private displayEl: HTMLElement | null = null;
	private statusLabelEl: HTMLElement | null = null;
	private cycleIndicatorEl: HTMLElement | null = null;
	private toggleBtn: HTMLButtonElement | null = null;
	private skipBtn: HTMLButtonElement | null = null;
	private statsEl: HTMLElement | null = null;

	constructor(
		private readonly parent: HTMLElement,
		private readonly handlers: TimerCardHandlers
	) {}

	render(initialTime: string): void {
		const card = this.parent.createDiv({ cls: "zen-card zen-timer-card" });
		this.cardEl = card;

		const metaRow = card.createDiv({ cls: "zen-timer-meta" });
		this.statusLabelEl = metaRow.createDiv({ cls: "zen-status-label", text: t("phase.ready") });
		this.cycleIndicatorEl = metaRow.createDiv({ cls: "zen-cycle-indicator" });

		const ring = card.createDiv({ cls: "zen-timer-ring" });
		this.ringEl = ring;
		const svg = ring.createSvg("svg", { attr: { viewBox: "0 0 120 120", "aria-hidden": "true" } });
		const circle = { cx: "60", cy: "60", r: RING_RADIUS.toString() };
		svg.createSvg("circle", { cls: "zen-ring-track", attr: circle });
		// pathLength makes the stroke maths independent of the radius.
		svg.createSvg("circle", { cls: "zen-ring-progress", attr: { ...circle, pathLength: "1" } });
		this.displayEl = ring.createDiv({ cls: "zen-timer-display", text: initialTime });

		const controls = card.createDiv({ cls: "zen-controls" });

		this.toggleBtn = controls.createEl("button", { cls: "zen-main-btn" });
		this.setRunning(false, false);
		this.listeners.add(this.toggleBtn, "click", () => this.handlers.onToggle());

		this.skipBtn = controls.createEl("button", { cls: "zen-sub-btn zen-skip-btn", attr: { "aria-label": t("timer.skip") } });
		setIcon(this.skipBtn, "skip-forward");
		this.listeners.add(this.skipBtn, "click", () => this.handlers.onSkip());

		const resetBtn = controls.createEl("button", { cls: "zen-sub-btn zen-reset-btn", attr: { "aria-label": t("timer.reset") } });
		setIcon(resetBtn, "rotate-ccw");
		this.listeners.add(resetBtn, "click", () => this.handlers.onReset());

		this.statsEl = card.createDiv({ cls: "zen-timer-stats" });
	}

	setTime(text: string): void {
		this.displayEl?.setText(text);
	}

	/** `fraction` is how much of the phase is left, from 1 down to 0. */
	setProgress(fraction: number): void {
		this.ringEl?.style.setProperty("--zen-progress", fraction.toFixed(4));
	}

	/**
	 * Shows the phase and one dot per cycle. `currentCycle` is the zero-based
	 * cycle in progress, or -1 before a session has started.
	 */
	setStatus(label: string, currentCycle: number, totalCycles: number, cycleText: string, onBreak: boolean): void {
		this.statusLabelEl?.setText(label);
		this.cardEl?.toggleClass("is-break", onBreak);

		const dots = this.cycleIndicatorEl;
		if (!dots) return;
		dots.empty();
		dots.ariaLabel = cycleText;
		for (let cycle = 0; cycle < totalCycles; cycle++) {
			const dot = dots.createSpan({ cls: "zen-cycle-dot" });
			dot.toggleClass("is-done", cycle < currentCycle);
			dot.toggleClass("is-current", cycle === currentCycle);
		}
	}

	/**
	 * Shows the totals and a bar per day, oldest first and ending with today.
	 * Each bar's height is its share of the busiest day.
	 */
	setStats(summary: string, days: Array<{ label: string; minutes: number; tooltip: string }>): void {
		const stats = this.statsEl;
		if (!stats) return;
		stats.empty();
		stats.createDiv({ text: summary, cls: "zen-timer-summary" });

		const busiest = Math.max(...days.map((day) => day.minutes), 1);
		const chart = stats.createDiv({ cls: "zen-chart" });
		days.forEach((day, index) => {
			const column = chart.createDiv({ cls: "zen-chart-day", attr: { "aria-label": day.tooltip } });
			column.toggleClass("is-today", index === days.length - 1);
			const bar = column.createDiv({ cls: "zen-chart-track" }).createDiv({ cls: "zen-chart-bar" });
			bar.style.setProperty("--zen-bar", (day.minutes / busiest).toFixed(3));
			column.createDiv({ text: day.label, cls: "zen-chart-label" });
		});
	}

	/** `resumable` distinguishes a paused session from a fresh one. */
	setRunning(running: boolean, resumable: boolean): void {
		const btn = this.toggleBtn;
		if (!btn) return;
		btn.empty();
		setIcon(btn.createSpan({ cls: "zen-main-btn-icon" }), running ? "pause" : "timer");
		btn.createSpan({ text: t(running ? "timer.pause" : resumable ? "timer.resume" : "timer.start") });
		btn.toggleClass("is-active", running);
		// There is nothing to skip before a session has started.
		if (this.skipBtn) this.skipBtn.disabled = !resumable;
	}

	destroy(): void {
		this.listeners.clear();
		this.cardEl = null;
		this.ringEl = null;
		this.displayEl = null;
		this.statusLabelEl = null;
		this.cycleIndicatorEl = null;
		this.toggleBtn = null;
		this.skipBtn = null;
		this.statsEl = null;
	}
}
