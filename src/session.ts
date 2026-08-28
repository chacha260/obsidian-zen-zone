import { Notice } from "obsidian";
import type ZenZonePlugin from "./main";
import { CYCLE_COUNT } from "./constants";
import { MusicReference, SoundDurationKey, SoundPathKey, TimerState } from "./types";
import { formatTime } from "./utils";

/** What a session needs from the audio card. Absent while the Zen panel is closed. */
export interface SessionAudio {
	loadTrack(ref: MusicReference, autoPlay?: boolean): void;
	startPlayback(fromStart: boolean): void;
	markPlaying(): void;
}

/** The open Zen panel, if any, listening for something to repaint. */
export interface SessionListener {
	onTick(remainingSeconds: number): void;
	onStateChange(): void;
}

const PHASE_ICON: Record<TimerState, string> = {
	[TimerState.Idle]: "⏳",
	[TimerState.Focus]: "🔥",
	[TimerState.ShortBreak]: "☕",
	[TimerState.LongBreak]: "☕"
};

/** Overshoot beyond this means the machine was asleep, which is worth saying out loud. */
const SLEEP_OVERSHOOT_MS = 60_000;

/**
 * The pomodoro state machine, owned by the plugin rather than the view, so a
 * session survives closing the Zen panel — and so closing the panel actually
 * frees the panel's DOM and its YouTube player.
 *
 * Time is tracked as an absolute deadline instead of a decrementing counter, so
 * the countdown neither drifts nor silently stalls while the machine sleeps.
 */
export class FocusSession {
	private phaseValue: TimerState = TimerState.Idle;
	private runningValue = false;
	private cycleValue = 0;

	/** Deadline of the running phase, in epoch milliseconds. */
	private endsAt = 0;
	/** Remaining time while paused, or while waiting out a transition sound. */
	private pausedRemainingMs: number;
	/** True between a phase ending and the next one starting. */
	private inTransition = false;

	private tickTimeoutId: number | null = null;
	private transitionTimeoutId: number | null = null;

	private audio: SessionAudio | null = null;
	private listener: SessionListener | null = null;

	constructor(private readonly plugin: ZenZonePlugin) {
		this.pausedRemainingMs = this.phaseDuration(TimerState.Focus);
	}

	// --- State ------------------------------------------------------------

	get phase(): TimerState { return this.phaseValue; }
	get running(): boolean { return this.runningValue; }
	get cycleCount(): number { return this.cycleValue; }
	/** True once a session has started and has not been reset. */
	get active(): boolean { return this.phaseValue !== TimerState.Idle; }

	private get remainingMs(): number {
		if (!this.runningValue || this.inTransition) return this.pausedRemainingMs;
		return Math.max(0, this.endsAt - Date.now());
	}

	get remainingSeconds(): number {
		return Math.ceil(this.remainingMs / 1000);
	}

	private phaseDuration(phase: TimerState): number {
		const { workDuration, shortBreakDuration, longBreakDuration } = this.plugin.settings;
		if (phase === TimerState.ShortBreak) return shortBreakDuration * 60_000;
		if (phase === TimerState.LongBreak) return longBreakDuration * 60_000;
		return workDuration * 60_000;
	}

	// --- View attachment ---------------------------------------------------

	attach(listener: SessionListener, audio: SessionAudio): void {
		this.listener = listener;
		this.audio = audio;
		listener.onStateChange();
		listener.onTick(this.remainingSeconds);
	}

	detach(listener: SessionListener): void {
		if (this.listener !== listener) return;
		this.listener = null;
		this.audio = null;
	}

	// --- Controls ----------------------------------------------------------

	toggle(): void {
		if (this.runningValue) this.pause();
		else this.start();
	}

	start(): void {
		if (this.runningValue) return;

		const begin = () => {
			this.runningValue = true;
			this.audio?.markPlaying();

			if (this.phaseValue === TimerState.Idle) {
				this.startCycle(TimerState.Focus);
			} else {
				this.resumeCountdown();
				this.playSceneMusic(this.phaseValue);
				this.audio?.startPlayback(false);
			}

			this.plugin.enterZenMode();
			this.emitState();
		};

		if (this.phaseValue === TimerState.Idle) {
			this.playSequence("soundStart", "durationStart", this.plugin.settings.workMusic[0], begin);
		} else {
			begin();
		}
	}

	pause(): void {
		if (!this.runningValue) return;
		// Reading this before stopping keeps a mid-transition pause on the next phase.
		this.pausedRemainingMs = this.remainingMs;
		this.stopCountdown();
		this.clearTransition();
		this.inTransition = false;
		this.runningValue = false;
		this.plugin.exitZenMode();
		this.emitState();
		this.emitTime();
	}

	reset(): void {
		this.stopCountdown();
		this.clearTransition();
		this.inTransition = false;
		this.runningValue = false;
		this.phaseValue = TimerState.Idle;
		this.cycleValue = 0;
		this.pausedRemainingMs = this.phaseDuration(TimerState.Focus);
		this.plugin.exitZenMode();
		this.emitState();
		this.emitTime();
	}

	dispose(): void {
		this.stopCountdown();
		this.clearTransition();
		this.listener = null;
		this.audio = null;
	}

	// --- Countdown ---------------------------------------------------------

	private startCycle(phase: TimerState): void {
		this.phaseValue = phase;
		this.pausedRemainingMs = this.phaseDuration(phase);
		this.runningValue = true;
		this.playSceneMusic(phase);
		this.resumeCountdown();
		this.emitState();
	}

	private resumeCountdown(): void {
		this.stopCountdown();
		this.endsAt = Date.now() + this.pausedRemainingMs;
		this.emitTime();
		this.scheduleTick();
	}

	/** Wakes exactly once per displayed second, aligned to the deadline. */
	private scheduleTick(): void {
		const remaining = this.remainingMs;
		const delay = remaining <= 0 ? 0 : remaining - (Math.ceil(remaining / 1000) - 1) * 1000;
		this.tickTimeoutId = window.setTimeout(() => this.onTick(), delay);
	}

	private onTick(): void {
		this.tickTimeoutId = null;
		if (!this.runningValue) return;

		this.emitTime();
		if (this.remainingMs > 0) {
			this.scheduleTick();
			return;
		}

		const overshootMs = Date.now() - this.endsAt;
		if (overshootMs > SLEEP_OVERSHOOT_MS) {
			new Notice(`⏰ このフェーズは約${Math.round(overshootMs / 60_000)}分前に終了していました。`);
		}
		this.handlePhaseComplete();
	}

	private stopCountdown(): void {
		if (this.tickTimeoutId === null) return;
		window.clearTimeout(this.tickTimeoutId);
		this.tickTimeoutId = null;
	}

	// --- Phase transitions -------------------------------------------------

	private handlePhaseComplete(): void {
		this.stopCountdown();

		if (this.phaseValue === TimerState.Focus) {
			const isLastCycle = this.cycleValue >= CYCLE_COUNT - 1;
			const next = isLastCycle ? TimerState.LongBreak : TimerState.ShortBreak;
			this.transitionTo(
				next,
				isLastCycle ? "soundFocusToLong" : "soundFocusToShort",
				isLastCycle ? "durationFocusToLong" : "durationFocusToShort"
			);
			return;
		}

		if (this.phaseValue === TimerState.ShortBreak) {
			this.cycleValue++;
			this.transitionTo(TimerState.Focus, "soundShortToFocus", "durationShortToFocus", "🔔 Break is over. Back to Focus.");
			return;
		}

		if (this.phaseValue === TimerState.LongBreak) {
			this.cycleValue++;
			this.transitionTo(TimerState.Idle, "soundLongToFinish", "durationLongToFinish");
		}
	}

	/**
	 * Moves to `next` immediately for display purposes, but only starts its
	 * countdown once the transition sound has had its configured time.
	 * `TimerState.Idle` means the whole run is finishing.
	 */
	private transitionTo(next: TimerState, pathKey: SoundPathKey, durationKey: SoundDurationKey, notice?: string): void {
		const finishing = next === TimerState.Idle;

		this.phaseValue = next;
		this.pausedRemainingMs = this.phaseDuration(finishing ? TimerState.Focus : next);
		this.inTransition = true;
		this.emitState();
		this.emitTime();

		const nextMusic = finishing ? null : this.musicForCycle(this.cycleValue, next);
		this.playSequence(pathKey, durationKey, nextMusic, () => {
			this.inTransition = false;

			if (finishing) {
				this.plugin.showBreakOverlay();
				this.reset();
				new Notice("🎉 All Cycles Complete!");
				return;
			}

			if (notice) new Notice(notice);
			this.playSceneMusic(next);
			this.resumeCountdown();
			this.emitState();
		});
	}

	/**
	 * Plays the transition cue, queues the next track silently, then hands over
	 * to `onComplete` once the cue has had its configured time.
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
		// autoPlay false: a queued track must not spin the player up on its own.
		if (nextMusicRef) this.audio?.loadTrack(nextMusicRef, false);

		if (!soundPath || durationSec <= 0) {
			this.audio?.startPlayback(false);
			onComplete();
			return;
		}

		new Notice(`Waiting ${durationSec}s...`);
		this.clearTransition();
		this.transitionTimeoutId = window.setTimeout(() => {
			this.transitionTimeoutId = null;
			this.audio?.startPlayback(true);
			onComplete();
		}, durationSec * 1000);
	}

	private clearTransition(): void {
		if (this.transitionTimeoutId === null) return;
		window.clearTimeout(this.transitionTimeoutId);
		this.transitionTimeoutId = null;
	}

	// --- Music -------------------------------------------------------------

	private musicForCycle(cycle: number, phase: TimerState): MusicReference | undefined {
		const index = Math.min(cycle, CYCLE_COUNT - 1);
		const schedule = phase === TimerState.Focus ? this.plugin.settings.workMusic : this.plugin.settings.breakMusic;
		return schedule[index];
	}

	private playSceneMusic(phase: TimerState): void {
		const ref = this.musicForCycle(this.cycleValue, phase);
		if (ref) this.audio?.loadTrack(ref);
	}

	// --- Notification ------------------------------------------------------

	private emitState(): void {
		this.listener?.onStateChange();
	}

	private emitTime(): void {
		const seconds = this.remainingSeconds;
		this.listener?.onTick(seconds);
		this.plugin.updateStatusBar(this.runningValue ? `${PHASE_ICON[this.phaseValue]} ${formatTime(seconds)}` : "");
	}
}
