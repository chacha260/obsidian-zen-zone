import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type ZenZonePlugin from "../main";
import { CYCLE_COUNT, VIEW_TYPE_ZEN } from "../constants";
import { MusicReference, SoundDurationKey, SoundPathKey, TimerState } from "../types";
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

const PHASE_ICON: Record<TimerState, string> = {
	[TimerState.Idle]: "⏳",
	[TimerState.Focus]: "🔥",
	[TimerState.ShortBreak]: "☕",
	[TimerState.LongBreak]: "☕"
};

/** The Zen Zone side panel: the task list, the pomodoro timer and the ambience player. */
export class ZenView extends ItemView {
	private taskCard: TaskCard | null = null;
	private timerCard: TimerCard | null = null;
	private audioCard: AudioCard | null = null;

	private timerInterval: number | null = null;
	private transitionTimeoutId: number | null = null;
	private timeLeft: number;
	/** The phase the session is in; `Idle` only before the first start and after a reset. */
	private phase: TimerState = TimerState.Idle;
	/** Whether the countdown is ticking. A paused session keeps its {@link phase}. */
	private running = false;
	private cycleCount = 0;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: ZenZonePlugin) {
		super(leaf);
		this.timeLeft = this.focusSeconds;
	}

	getViewType(): string { return VIEW_TYPE_ZEN; }
	getDisplayText(): string { return "Zen Zone"; }
	getIcon(): string { return "zap"; }

	private get focusSeconds(): number {
		return this.plugin.settings.workDuration * 60;
	}

	// --- Lifecycle -------------------------------------------------------

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("zen-view-container");

		container.createDiv({ cls: "zen-header" }).createEl("h2", { text: "Zen Zone" });

		this.taskCard = new TaskCard(container.createDiv({ cls: "zen-card zen-task-card" }), this.plugin);
		this.taskCard.render();

		this.timerCard = new TimerCard(container.createDiv(), {
			onToggle: () => this.toggleTimer(),
			onReset: () => this.resetSystem()
		});
		this.timerCard.render(formatTime(this.timeLeft));

		this.audioCard = new AudioCard(container.createDiv(), this.plugin);
		this.audioCard.render();

		this.updateStatusDisplay();
		container.createDiv({ text: "Cycle & Music settings in plugin options.", cls: "zen-footer-note" });
	}

	async onClose(): Promise<void> {
		this.stopTimer();
		this.clearTransition();

		this.taskCard?.destroy();
		this.timerCard?.destroy();
		await this.audioCard?.destroy();

		this.taskCard = null;
		this.timerCard = null;
		this.audioCard = null;

		(this.containerEl.children[1] as HTMLElement | undefined)?.empty();
	}

	// --- Timer control ---------------------------------------------------

	private toggleTimer(): void {
		if (this.running) this.pauseSession();
		else this.startSession();
	}

	private pauseSession(): void {
		this.stopTimer();
		this.running = false;
		this.timerCard?.setRunning(false, true);
		this.plugin.exitZenMode();
		this.plugin.updateStatusBar("");
		this.updateStatusDisplay();
	}

	private startSession(): void {
		const begin = () => {
			this.running = true;
			this.audioCard?.markPlaying();

			if (this.phase === TimerState.Idle) {
				this.startCycle(TimerState.Focus);
			} else {
				this.runTimer();
				this.playSceneMusic(this.phase);
				this.audioCard?.startPlayback(false);
			}

			this.timerCard?.setRunning(true, false);
			this.plugin.enterZenMode();
			this.updateStatusDisplay();
		};

		if (this.phase === TimerState.Idle) {
			this.playSequence("soundStart", "durationStart", this.plugin.settings.workMusic[0], begin);
		} else {
			begin();
		}
	}

	private resetSystem(): void {
		this.stopTimer();
		this.clearTransition();
		this.running = false;
		this.phase = TimerState.Idle;
		this.cycleCount = 0;
		this.timeLeft = this.focusSeconds;
		this.timerCard?.setTime(formatTime(this.timeLeft));
		this.timerCard?.setRunning(false, false);
		this.plugin.exitZenMode();
		this.plugin.updateStatusBar("");
		this.updateStatusDisplay();
	}

	private startCycle(phase: TimerState): void {
		this.phase = phase;
		this.timeLeft = this.phaseDuration(phase);
		this.playSceneMusic(phase);
		this.updateStatusDisplay();
		this.runTimer();
	}

	private phaseDuration(phase: TimerState): number {
		const { workDuration, shortBreakDuration, longBreakDuration } = this.plugin.settings;
		if (phase === TimerState.ShortBreak) return shortBreakDuration * 60;
		if (phase === TimerState.LongBreak) return longBreakDuration * 60;
		return workDuration * 60;
	}

	private runTimer(): void {
		this.stopTimer();
		this.timerInterval = window.setInterval(() => {
			this.timeLeft--;
			const timeStr = formatTime(this.timeLeft);
			this.timerCard?.setTime(timeStr);
			this.plugin.updateStatusBar(`${PHASE_ICON[this.phase]} ${timeStr}`);
			if (this.timeLeft <= 0) this.handlePhaseComplete();
		}, 1000);
	}

	private stopTimer(): void {
		if (this.timerInterval === null) return;
		window.clearInterval(this.timerInterval);
		this.timerInterval = null;
	}

	private handlePhaseComplete(): void {
		this.stopTimer();

		if (this.phase === TimerState.Focus) {
			const isLastCycle = this.cycleCount >= CYCLE_COUNT - 1;
			const nextPhase = isLastCycle ? TimerState.LongBreak : TimerState.ShortBreak;
			this.playSequence(
				isLastCycle ? "soundFocusToLong" : "soundFocusToShort",
				isLastCycle ? "durationFocusToLong" : "durationFocusToShort",
				this.musicForCycle(this.cycleCount, nextPhase),
				() => this.startCycle(nextPhase)
			);
			return;
		}

		if (this.phase === TimerState.ShortBreak) {
			this.cycleCount++;
			this.playSequence(
				"soundShortToFocus",
				"durationShortToFocus",
				this.musicForCycle(this.cycleCount, TimerState.Focus),
				() => {
					new Notice("🔔 Break is over. Back to Focus.");
					this.startCycle(TimerState.Focus);
				}
			);
			return;
		}

		if (this.phase === TimerState.LongBreak) {
			this.cycleCount++;
			this.playSequence("soundLongToFinish", "durationLongToFinish", null, () => {
				this.plugin.showBreakOverlay();
				this.resetSystem();
				new Notice("🎉 All Cycles Complete!");
			});
		}
	}

	// --- Music -----------------------------------------------------------

	private musicForCycle(cycle: number, phase: TimerState): MusicReference | undefined {
		const index = Math.min(cycle, CYCLE_COUNT - 1);
		const schedule = phase === TimerState.Focus ? this.plugin.settings.workMusic : this.plugin.settings.breakMusic;
		return schedule[index];
	}

	private playSceneMusic(phase: TimerState): void {
		const ref = this.musicForCycle(this.cycleCount, phase);
		if (ref) this.audioCard?.loadTrack(ref);
	}

	/**
	 * Plays the transition sound, queues the next track silently, then hands over
	 * to `onComplete` once the sound has had its configured time to play.
	 */
	private playSequence(
		pathKey: SoundPathKey,
		durationKey: SoundDurationKey,
		nextMusicRef: MusicReference | null | undefined,
		onComplete: () => void
	): void {
		const soundPath = this.plugin.settings[pathKey];
		const durationSec = this.plugin.settings[durationKey];

		this.plugin.playLocalSound(soundPath);
		if (nextMusicRef) this.audioCard?.loadTrack(nextMusicRef, false);

		if (!soundPath || durationSec <= 0) {
			this.audioCard?.startPlayback(false);
			onComplete();
			return;
		}

		new Notice(`Waiting ${durationSec}s...`);
		this.clearTransition();
		this.transitionTimeoutId = window.setTimeout(() => {
			this.transitionTimeoutId = null;
			this.audioCard?.startPlayback(true);
			onComplete();
		}, durationSec * 1000);
	}

	private clearTransition(): void {
		if (this.transitionTimeoutId === null) return;
		window.clearTimeout(this.transitionTimeoutId);
		this.transitionTimeoutId = null;
	}

	// --- Status ----------------------------------------------------------

	private updateStatusDisplay(): void {
		const label = this.phase === TimerState.Idle
			? PHASE_LABEL[TimerState.Idle]
			: this.running ? PHASE_LABEL[this.phase] : `⏸ ${PHASE_LABEL[this.phase]}`;
		const current = this.phase === TimerState.Idle ? 0 : Math.min(this.cycleCount + 1, CYCLE_COUNT);
		this.timerCard?.setStatus(label, `Cycle: ${current}/${CYCLE_COUNT}`);
	}
}
