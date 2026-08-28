import { Notice, setIcon } from "obsidian";
import type ZenZonePlugin from "../main";
import { YouTubeAudio } from "../audio/youtube-audio";
import { DomListenerRegistry, TimeoutRegistry } from "../dom";
import type { SessionAudio } from "../session";
import { Checkpoint, MusicReference, PlaylistItem, RepeatMode, YouTubeInfo } from "../types";
import { extractYouTubeInfo, parseTimeString } from "../utils";

/** Wait for a freshly loaded track before seeking into it, in milliseconds. */
const SEEK_AFTER_LOAD_MS = 1500;
/** Wait before starting a track that was just loaded without a checkpoint. */
const PLAY_AFTER_LOAD_MS = 800;
/** Shuffle has to be re-applied once the new playlist is in place. */
const SHUFFLE_AFTER_LOAD_MS = 500;
/** Let the player drain its buffers before it is torn down. */
const DRAIN_BEFORE_DESTROY_MS = 1000;

/** Where playback should pick up after the player was released or replaced. */
interface ResumePoint extends YouTubeInfo {
	positionSec: number;
}

/**
 * The audio card: track selection, quick-jump checkpoints and the transport
 * controls.
 *
 * The YouTube player is by far the heaviest thing this plugin can hold, so it
 * is created on the first actual play rather than on render, and released again
 * after a configurable stretch of silence. Playback position is remembered
 * across a release, so resuming continues where it stopped.
 */
export class AudioCard implements SessionAudio {
	private readonly listeners = new DomListenerRegistry();
	private readonly timeouts = new TimeoutRegistry();

	private player: YouTubeAudio | null = null;
	private playerContainer: HTMLElement | null = null;
	private idleReleaseId: number | null = null;
	/** Set while no player exists, so the next play knows where to start. */
	private resumePoint: ResumePoint | null = null;

	private selectEl: HTMLSelectElement | null = null;
	private checkpointsEl: HTMLElement | null = null;
	private playBtnEl: HTMLButtonElement | null = null;
	private playlistOrderEl: HTMLElement | null = null;
	private videoTitleEl: HTMLElement | null = null;

	private selectedIndex = 0;
	private playing = false;
	private volume = 0.5;
	private shuffle = false;
	private repeatMode: RepeatMode = RepeatMode.Off;

	constructor(
		private readonly parent: HTMLElement,
		private readonly plugin: ZenZonePlugin
	) {}

	get isPlaying(): boolean {
		return this.playing;
	}

	private get playlist(): PlaylistItem[] {
		return this.plugin.settings.playlistData;
	}

	// --- Rendering -------------------------------------------------------

	render(): void {
		const card = this.parent.createDiv({ cls: "zen-card zen-audio-card" });
		// The container is cheap; the player inside it is not, so it stays empty
		// until something actually asks for sound.
		this.playerContainer = card.createDiv({ cls: "zen-player-hidden" });
		this.renderTrackSelect(card);
		this.checkpointsEl = card.createDiv({ cls: "zen-checkpoints-area" });
		this.renderCheckpoints(this.playlist[0]?.checkpoints ?? []);
		this.renderNowPlaying(card);
		this.renderTransport(card);
	}

	private renderTrackSelect(card: HTMLElement): void {
		const wrapper = card.createDiv({ cls: "zen-input-group" });
		wrapper.createDiv({ cls: "zen-label", text: "Manual Select" });

		const selectEl = wrapper.createEl("select", { cls: "zen-select" });
		this.selectEl = selectEl;

		this.playlist.forEach((track, index) => {
			const info = extractYouTubeInfo(track.url);
			if (!info.videoId && !info.listId) return;
			selectEl.createEl("option", { text: track.title }).value = index.toString();
		});
		selectEl.value = this.selectedIndex.toString();

		this.listeners.add(selectEl, "change", () => {
			const index = parseInt(selectEl.value, 10);
			const track = this.playlist[index];
			if (!track) return;

			this.selectedIndex = index;
			this.renderCheckpoints(track.checkpoints ?? []);
			this.playlistOrderEl?.setText("");

			// Switching tracks while silent only re-aims the next play.
			if (!this.player) {
				this.resumePoint = null;
				return;
			}

			const info = extractYouTubeInfo(track.url);
			this.player.loadVideoOrPlaylist(info.videoId, info.listId);
			if (this.shuffle) this.timeouts.set(() => this.player?.setShuffle(true), SHUFFLE_AFTER_LOAD_MS);
		});
	}

	private renderNowPlaying(card: HTMLElement): void {
		const topControls = card.createDiv({ cls: "zen-audio-top-controls" });
		this.playlistOrderEl = topControls.createSpan({ cls: "zen-playlist-display" });
		this.videoTitleEl = card.createDiv({ cls: "zen-video-title" });
	}

	private renderTransport(card: HTMLElement): void {
		const row = card.createDiv({ cls: "zen-audio-controls-row" });

		this.playBtnEl = row.createEl("button", { cls: "zen-music-btn" });
		setIcon(this.playBtnEl, "play");
		this.listeners.add(this.playBtnEl, "click", () => this.toggle());

		this.addSmallButton(row, "skip-back", "Previous (playlist)", () => this.player?.previousVideo());
		this.addSmallButton(row, "skip-forward", "Next (playlist)", () => this.player?.nextVideo());

		const shuffleBtn = this.addSmallButton(row, "shuffle", "Shuffle (playlist)", () => {
			this.shuffle = !this.shuffle;
			shuffleBtn.toggleClass("is-active", this.shuffle);
			this.player?.setShuffle(this.shuffle);
		});
		shuffleBtn.toggleClass("is-active", this.shuffle);

		const repeatBtn = row.createEl("button", { cls: "zen-music-btn-small" });
		this.updateRepeatButton(repeatBtn);
		this.listeners.add(repeatBtn, "click", () => {
			this.repeatMode = this.nextRepeatMode();
			this.updateRepeatButton(repeatBtn);
			this.player?.setRepeatMode(this.repeatMode);
		});

		this.renderVolume(row);
	}

	private addSmallButton(row: HTMLElement, icon: string, tooltip: string, onClick: () => void): HTMLButtonElement {
		const btn = row.createEl("button", { cls: "zen-music-btn-small" });
		setIcon(btn, icon);
		btn.title = tooltip;
		this.listeners.add(btn, "click", onClick);
		return btn;
	}

	private renderVolume(row: HTMLElement): void {
		const wrapper = row.createDiv({ cls: "zen-volume-wrapper" });
		setIcon(wrapper.createDiv({ cls: "zen-label" }), "volume-2");

		const slider = wrapper.createEl("input", {
			type: "range",
			cls: "zen-slider",
			attr: { min: "0", max: "1", step: "0.05", value: this.volume.toString() }
		});
		this.listeners.add(slider, "input", (event) => {
			this.volume = parseFloat((event.target as HTMLInputElement).value);
			this.player?.setVolume(this.volume);
		});
	}

	private renderCheckpoints(checkpoints: Checkpoint[]): void {
		const container = this.checkpointsEl;
		if (!container) return;

		container.empty();
		if (checkpoints.length === 0) return;

		container.createDiv({ cls: "zen-sub-label", text: "Quick Jump" });
		const grid = container.createDiv({ cls: "zen-chip-grid" });
		for (const checkpoint of checkpoints) {
			const chip = grid.createEl("button", { cls: "zen-chip", text: checkpoint.label });
			this.listeners.add(chip, "click", () => {
				const seconds = parseTimeString(checkpoint.time);
				const player = this.ensurePlayer(seconds);
				if (!player) return;
				if (player.isPlayerReady()) player.seekTo(seconds);
				new Notice(`⏩ Jumped to ${checkpoint.label}`);
				if (!this.playing) this.startPlayback(false);
			});
		}
	}

	private updateNowPlaying(index: number, total: number, title: string): void {
		this.playlistOrderEl?.setText(total > 0 ? `Video ${index + 1} / ${total}` : "");
		if (!this.videoTitleEl) return;
		this.videoTitleEl.setText(title);
		this.videoTitleEl.toggleClass("is-visible", Boolean(title));
	}

	private nextRepeatMode(): RepeatMode {
		switch (this.repeatMode) {
			case RepeatMode.Off:
				new Notice("🔁 Repeat: All");
				return RepeatMode.All;
			case RepeatMode.All:
				new Notice("🔂 Repeat: One");
				return RepeatMode.One;
			default:
				new Notice("Repeat: Off");
				return RepeatMode.Off;
		}
	}

	private updateRepeatButton(btn: HTMLElement): void {
		setIcon(btn, this.repeatMode === RepeatMode.One ? "repeat-1" : "repeat");
		btn.toggleClass("is-active", this.repeatMode !== RepeatMode.Off);
		btn.title = `Repeat: ${RepeatMode[this.repeatMode]}`;
	}

	// --- Player lifetime -------------------------------------------------

	/**
	 * Creates the player if it does not exist yet, starting from the remembered
	 * resume point or the selected track. `startAtSec` overrides that position.
	 */
	private ensurePlayer(startAtSec?: number): YouTubeAudio | null {
		this.clearIdleRelease();
		if (this.player) return this.player;
		if (!this.playerContainer) return null;

		const start = this.resumePoint ?? this.selectedTrackStart();
		if (!start) return null;

		const positionSec = startAtSec ?? start.positionSec;
		this.resumePoint = null;

		const player = new YouTubeAudio(this.playerContainer, start.videoId, start.listId);
		player.setVolume(this.volume);
		player.setRepeatMode(this.repeatMode);
		player.onPlaylistInfo = (index, total, title) => this.updateNowPlaying(index, total, title);
		player.onReady = () => {
			if (this.shuffle) player.setShuffle(true);
			if (positionSec > 0) player.seekTo(positionSec);
			if (this.playing) player.play();
		};
		this.player = player;
		return player;
	}

	private selectedTrackStart(): ResumePoint | null {
		const track = this.playlist[this.selectedIndex] ?? this.playlist[0];
		if (!track) return null;
		return { ...extractYouTubeInfo(track.url), positionSec: 0 };
	}

	/** Tears the player down after a stretch of silence, remembering where it was. */
	private scheduleIdleRelease(): void {
		this.clearIdleRelease();
		const minutes = this.plugin.settings.audioIdleReleaseMinutes;
		if (minutes <= 0 || !this.player) return;
		this.idleReleaseId = window.setTimeout(() => this.releasePlayer(), minutes * 60_000);
	}

	private clearIdleRelease(): void {
		if (this.idleReleaseId === null) return;
		window.clearTimeout(this.idleReleaseId);
		this.idleReleaseId = null;
	}

	private releasePlayer(): void {
		this.idleReleaseId = null;
		const player = this.player;
		if (!player || this.playing) return;

		this.resumePoint = { ...player.getCurrentTrackInfo(), positionSec: player.getCurrentTime() };
		this.player = null;
		player.destroy();
		this.updateNowPlaying(-1, 0, "");
	}

	// --- Playback control ------------------------------------------------

	toggle(): void {
		if (this.playing) {
			this.player?.pause();
			this.setPlayingState(false);
			this.scheduleIdleRelease();
			return;
		}
		this.startPlayback(false);
	}

	/** Marks the transport as playing without touching the player itself. */
	markPlaying(): void {
		this.setPlayingState(true);
	}

	/** Resumes at the configured volume, optionally rewinding to the start first. */
	startPlayback(fromStart: boolean): void {
		this.setPlayingState(true);
		const player = this.ensurePlayer(fromStart ? 0 : undefined);
		if (!player?.isPlayerReady()) return;

		if (fromStart) player.seekTo(0);
		player.setVolume(this.volume);
		player.play();
	}

	private setPlayingState(playing: boolean): void {
		this.playing = playing;
		if (playing) this.clearIdleRelease();
		if (!this.playBtnEl) return;
		setIcon(this.playBtnEl, playing ? "pause" : "play");
		this.playBtnEl.toggleClass("is-playing", playing);
	}

	/**
	 * Plays the track a {@link MusicReference} points at, seeking to its
	 * checkpoint. With `autoPlay` false the track is only queued: no player is
	 * created, so a silent session never pays for one.
	 */
	loadTrack(ref: MusicReference, autoPlay = true): void {
		const track = this.playlist[ref.trackIndex];
		if (!track) return;

		this.selectedIndex = ref.trackIndex;
		if (this.selectEl) this.selectEl.value = ref.trackIndex.toString();

		const info = extractYouTubeInfo(track.url);
		const checkpoint = ref.checkpointIndex >= 0 ? track.checkpoints?.[ref.checkpointIndex] : undefined;
		const startAt = checkpoint ? parseTimeString(checkpoint.time) : 0;

		if (!this.player) {
			this.resumePoint = { ...info, positionSec: startAt };
			this.renderCheckpoints(track.checkpoints ?? []);
			if (autoPlay) this.startPlayback(false);
			return;
		}

		const current = this.player.getCurrentTrackInfo();
		if (current.videoId === info.videoId && current.listId === info.listId) {
			if (checkpoint) {
				this.player.seekTo(startAt);
				if (autoPlay) this.player.play();
				new Notice(`⏩ Jumped to ${checkpoint.label}`);
			} else if (autoPlay) {
				this.player.play();
			}
			return;
		}

		this.player.loadVideoOrPlaylist(info.videoId, info.listId);

		if (checkpoint) {
			this.timeouts.set(() => {
				this.player?.seekTo(startAt);
				if (autoPlay) this.player?.play();
				new Notice(`🎵 Loaded: ${track.title} (${checkpoint.label})`);
			}, SEEK_AFTER_LOAD_MS);
		} else {
			if (autoPlay) this.timeouts.set(() => this.player?.play(), PLAY_AFTER_LOAD_MS);
			new Notice(`🎵 Loaded: ${track.title}`);
		}

		this.renderCheckpoints(track.checkpoints ?? []);
	}

	// --- Teardown --------------------------------------------------------

	async destroy(): Promise<void> {
		this.listeners.clear();
		this.timeouts.clearAll();
		this.clearIdleRelease();

		if (this.player) {
			this.player.pause();
			// Let the player finish draining before it is destroyed.
			await new Promise((resolve) => window.setTimeout(resolve, DRAIN_BEFORE_DESTROY_MS));
			this.player.destroy();
			this.player = null;
		}

		this.playerContainer = null;
		this.selectEl = null;
		this.checkpointsEl = null;
		this.playBtnEl = null;
		this.playlistOrderEl = null;
		this.videoTitleEl = null;
	}
}
