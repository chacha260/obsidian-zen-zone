import { setIcon } from "obsidian";
import { DomListenerRegistry } from "../dom";

export interface TimerCardHandlers {
	onToggle(): void;
	onReset(): void;
}

/** The timer card: phase label, cycle counter, countdown and its two buttons. */
export class TimerCard {
	private readonly listeners = new DomListenerRegistry();
	private displayEl: HTMLElement | null = null;
	private statusLabelEl: HTMLElement | null = null;
	private cycleIndicatorEl: HTMLElement | null = null;
	private toggleBtn: HTMLButtonElement | null = null;

	constructor(
		private readonly parent: HTMLElement,
		private readonly handlers: TimerCardHandlers
	) {}

	render(initialTime: string): void {
		const card = this.parent.createDiv({ cls: "zen-card zen-timer-card" });

		const metaRow = card.createDiv({ cls: "zen-timer-meta" });
		this.statusLabelEl = metaRow.createDiv({ cls: "zen-status-label", text: "Ready" });
		this.cycleIndicatorEl = metaRow.createDiv({ cls: "zen-cycle-indicator" });

		this.displayEl = card.createDiv({ cls: "zen-timer-display", text: initialTime });

		const controls = card.createDiv({ cls: "zen-controls" });

		this.toggleBtn = controls.createEl("button", { cls: "zen-main-btn" });
		this.setRunning(false, false);
		this.listeners.add(this.toggleBtn, "click", () => this.handlers.onToggle());

		const resetBtn = controls.createEl("button", { cls: "zen-sub-btn zen-reset-btn", text: "Reset" });
		this.listeners.add(resetBtn, "click", () => this.handlers.onReset());
	}

	setTime(text: string): void {
		this.displayEl?.setText(text);
	}

	setStatus(label: string, cycleText: string): void {
		this.statusLabelEl?.setText(label);
		this.cycleIndicatorEl?.setText(cycleText);
	}

	/** `resumable` distinguishes a paused session from a fresh one. */
	setRunning(running: boolean, resumable: boolean): void {
		const btn = this.toggleBtn;
		if (!btn) return;
		btn.setText(running ? "Stop Focus" : resumable ? "Resume Focus" : "Start Focus");
		setIcon(btn, running ? "x" : "timer");
		btn.toggleClass("is-active", running);
	}

	destroy(): void {
		this.listeners.clear();
		this.displayEl = null;
		this.statusLabelEl = null;
		this.cycleIndicatorEl = null;
		this.toggleBtn = null;
	}
}
