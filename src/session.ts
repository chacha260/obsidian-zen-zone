import { Notice } from "obsidian";
import type ZenZonePlugin from "./main";
import { t } from "./i18n";
import { MusicReference, SoundDurationKey, SoundPathKey, TimerState } from "./types";
import { formatTime } from "./utils";

/** What a session needs from the audio engine. */
export interface SessionAudio {
	loadTrack(ref: MusicReference, autoPlay?: boolean): void;
	startPlayback(fromStart: boolean): void;
	pausePlayback(): void;
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
	[TimerState.LongBreak]: "🌴"
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
	/** True while the start cue plays, before the first focus phase begins. */
	private starting = false;
	/** False until the current phase has counted down for the first time. */
	private phaseBegun = false;
	/** When the current phase first started counting, in epoch milliseconds. */
	private phaseStartedAt = 0;
	/** Length the current phase was given when it began, in minutes. */
	private phaseMinutes = 0;

	private tickTimeoutId: number | null = null;
	private transitionTimeoutId: number | null = null;

	private listener: SessionListener | null = null;

	constructor(
		private readonly plugin: ZenZonePlugin,
		private readonly audio: SessionAudio
	) {
		this.pausedRemainingMs = this.phaseDuration(TimerState.Focus);
	}

	// --- State ------------------------------------------------------------

	get phase(): TimerState { return this.phaseValue; }
	/** True while counting down, and while the start cue is leading into the first phase. */
	get running(): boolean { return this.runningValue || this.starting; }
	get cycleCount(): number { return this.cycleValue; }
	get totalCycles(): number { return Math.max(1, this.plugin.settings.cycles); }
	/** True once a session has started and has not been reset. */
	get active(): boolean { return this.phaseValue !== TimerState.Idle; }

	private get remainingMs(): number {
		if (!this.runningValue || this.inTransition) return this.pausedRemainingMs;
		return Math.max(0, this.endsAt - Date.now());
	}

	/** How much of the current phase is left, from 1 (untouched) down to 0 (over). */
	get progress(): number {
		const total = this.phaseDuration(this.active ? this.phaseValue : TimerState.Focus);
		return total > 0 ? Math.min(1, Math.max(0, this.remainingMs / total)) : 0;
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

	attach(listener: SessionListener): void {
		this.listener = listener;
		listener.onStateChange();
		listener.onTick(this.remainingSeconds);
	}

	detach(listener: SessionListener): void {
		if (this.listener !== listener) return;
		this.listener = null;
	}

	// --- Controls ----------------------------------------------------------

	toggle(): void {
		if (this.running) this.pause();
		else this.start();
	}

	/** Re-reads the focus duration while idle, after the settings changed. */
	refreshIdleDuration(): void {
		if (this.active || this.running) return;
		this.pausedRemainingMs = this.phaseDuration(TimerState.Focus);
		this.emitTime();
	}

	start(): void {
		if (this.running) return;

		const begin = () => {
			this.runningValue = true;
			this.audio.markPlaying();

			if (this.phaseValue === TimerState.Idle) {
				this.startCycle(TimerState.Focus);
			} else {
				this.markPhaseBegun();
				this.resumeCountdown();
				this.playSceneMusic(this.phaseValue);
				this.audio.startPlayback(false);
			}

			this.plugin.enterZenMode();
			this.emitState();
		};

		if (this.phaseValue === TimerState.Idle) {
			this.starting = true;
			this.emitState();
			this.playSequence("soundStart", "durationStart", this.plugin.settings.workMusic[0], (cuePlayed) => {
				this.starting = false;
				this.audio.startPlayback(cuePlayed);
				begin();
			});
		} else {
			begin();
		}
	}

	pause(): void {
		if (this.starting) {
			// Still on the start cue: nothing has begun, so just call it off.
			this.starting = false;
			this.clearTransition();
			this.plugin.stopLocalSound();
			this.emitState();
			return;
		}
		if (!this.runningValue) return;
		// Reading this before stopping keeps a mid-transition pause on the next phase.
		this.pausedRemainingMs = this.remainingMs;
		this.stopCountdown();
		this.clearTransition();
		if (this.inTransition) this.plugin.stopLocalSound();
		this.inTransition = false;
		this.runningValue = false;
		this.plugin.exitZenMode();
		this.emitState();
		this.emitTime();
	}

	reset(): void {
		this.starting = false;
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

	/** Ends the current phase early. A skipped focus phase is not counted as done. */
	skip(): void {
		if (!this.active || this.starting || this.inTransition) return;
		if (!this.runningValue) {
			this.runningValue = true;
			this.plugin.enterZenMode();
		}
		this.handlePhaseComplete(true);
	}

	dispose(): void {
		this.stopCountdown();
		this.clearTransition();
		this.listener = null;
	}

	// --- Countdown ---------------------------------------------------------

	private startCycle(phase: TimerState): void {
		this.phaseValue = phase;
		this.pausedRemainingMs = this.phaseDuration(phase);
		this.phaseBegun = false;
		this.markPhaseBegun();
		this.runningValue = true;
		this.playSceneMusic(phase);
		this.resumeCountdown();
		this.emitState();
	}

	/** Stamps the start of a phase the first time it counts down. */
	private markPhaseBegun(): void {
		if (this.phaseBegun) return;
		this.phaseBegun = true;
		this.phaseStartedAt = Date.now();
		this.phaseMinutes = Math.round(this.pausedRemainingMs / 60_000);
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
			new Notice(t("notice.overslept", { minutes: Math.round(overshootMs / 60_000) }));
		}
		this.handlePhaseComplete();
	}

	private stopCountdown(): void {
		if (this.tickTimeoutId === null) return;
		window.clearTimeout(this.tickTimeoutId);
		this.tickTimeoutId = null;
	}

	// --- Phase transitions -------------------------------------------------

	private handlePhaseComplete(skipped = false): void {
		this.stopCountdown();

		if (this.phaseValue === TimerState.Focus) {
			if (!skipped) void this.plugin.recordFocusSession(this.phaseStartedAt, this.phaseMinutes);
			const isLastCycle = this.cycleValue >= this.totalCycles - 1;
			const next = isLastCycle ? TimerState.LongBreak : TimerState.ShortBreak;
			this.transitionTo(
				next,
				isLastCycle ? "soundFocusToLong" : "soundFocusToShort",
				isLastCycle ? "durationFocusToLong" : "durationFocusToShort",
				t(isLastCycle ? "notice.longBreak" : "notice.shortBreak")
			);
			return;
		}

		if (this.phaseValue === TimerState.ShortBreak) {
			this.cycleValue++;
			this.transitionTo(TimerState.Focus, "soundShortToFocus", "durationShortToFocus", t("notice.breakOver"));
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
		this.phaseBegun = false;
		this.inTransition = true;
		this.emitState();
		this.emitTime();

		const nextMusic = finishing ? null : this.musicForCycle(this.cycleValue, next);
		this.playSequence(pathKey, durationKey, nextMusic, (cuePlayed) => {
			this.inTransition = false;

			if (finishing) {
				this.reset();
				this.audio.pausePlayback();
				this.plugin.announce(t("notice.allComplete"));
				return;
			}

			if (notice) this.plugin.announce(notice);

			const { autoStartFocus, autoStartBreaks } = this.plugin.settings;
			if (!(next === TimerState.Focus ? autoStartFocus : autoStartBreaks)) {
				// Wait for the user: the phase is ready but nothing counts down yet.
				this.runningValue = false;
				this.audio.pausePlayback();
				this.plugin.exitZenMode();
				this.emitState();
				this.emitTime();
				return;
			}

			this.audio.startPlayback(cuePlayed);
			this.markPhaseBegun();
			this.playSceneMusic(next);
			this.resumeCountdown();
			this.emitState();
		});
	}

	/**
	 * Plays the transition cue, queues the next track silently, then hands over
	 * to `onComplete` once the cue has had its configured time. `onComplete` is
	 * told whether a cue was waited on, in which case the music starts afresh.
	 */
	private playSequence(
		pathKey: SoundPathKey,
		durationKey: SoundDurationKey,
		nextMusicRef: MusicReference | null | undefined,
		onComplete: (cuePlayed: boolean) => void
	): void {
		const soundPath = this.plugin.settings[pathKey];
		const durationSec = this.plugin.settings[durationKey];

		this.plugin.playLocalSound(soundPath);
		// autoPlay false: a queued track must not spin the player up on its own.
		if (nextMusicRef) this.audio.loadTrack(nextMusicRef, false);

		if (!soundPath || durationSec <= 0) {
			onComplete(false);
			return;
		}

		new Notice(t("notice.cueWait", { seconds: durationSec }));
		this.clearTransition();
		this.transitionTimeoutId = window.setTimeout(() => {
			this.transitionTimeoutId = null;
			onComplete(true);
		}, durationSec * 1000);
	}

	private clearTransition(): void {
		if (this.transitionTimeoutId === null) return;
		window.clearTimeout(this.transitionTimeoutId);
		this.transitionTimeoutId = null;
	}

	// --- Music -------------------------------------------------------------

	private musicForCycle(cycle: number, phase: TimerState): MusicReference | undefined {
		const index = Math.min(cycle, this.totalCycles - 1);
		const schedule = phase === TimerState.Focus ? this.plugin.settings.workMusic : this.plugin.settings.breakMusic;
		return schedule[index];
	}

	private playSceneMusic(phase: TimerState): void {
		const ref = this.musicForCycle(this.cycleValue, phase);
		if (ref) this.audio.loadTrack(ref);
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
