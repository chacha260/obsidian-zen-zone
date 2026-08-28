import { Notice, setIcon } from "obsidian";
import type ZenZonePlugin from "../main";
import { YouTubeAudio } from "../audio/youtube-audio";
import { DomListenerRegistry, TimeoutRegistry } from "../dom";
import { Checkpoint, MusicReference, PlaylistItem, RepeatMode } from "../types";
import { extractYouTubeInfo, parseTimeString } from "../utils";

/** Wait for a freshly loaded track before seeking into it, in milliseconds. */
const SEEK_AFTER_LOAD_MS = 1500;
/** Wait before starting a track that was just loaded without a checkpoint. */
const PLAY_AFTER_LOAD_MS = 800;
/** Shuffle has to be re-applied once the new playlist is in place. */
const SHUFFLE_AFTER_LOAD_MS = 500;
/** Let the player drain its buffers before it is torn down. */
const DRAIN_BEFORE_DESTROY_MS = 1000;

/**
 * The audio card: track selection, quick-jump checkpoints and the transport
 * controls, backed by a single hidden {@link YouTubeAudio} player.
 */
export class AudioCard {
	private readonly listeners = new DomListenerRegistry();
	private readonly timeouts = new TimeoutRegistry();

	private player: YouTubeAudio | null = null;
	private selectEl: HTMLSelectElement | null = null;
	private checkpointsEl: HTMLElement | null = null;
	private playBtnEl: HTMLButtonElement | null = null;
	private playlistOrderEl: HTMLElement | null = null;
	private videoTitleEl: HTMLElement | null = null;

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
		this.createPlayer(card.createDiv({ cls: "zen-player-hidden" }));
		this.renderTrackSelect(card);
		this.checkpointsEl = card.createDiv({ cls: "zen-checkpoints-area" });
		this.renderCheckpoints(this.playlist[0]?.checkpoints ?? []);
		this.renderNowPlaying(card);
		this.renderTransport(card);
	}

	private createPlayer(container: HTMLElement): void {
		if (this.player) return;
		const firstTrack = this.playlist[0];
		if (!firstTrack) return;

		const info = extractYouTubeInfo(firstTrack.url);
		this.player = new YouTubeAudio(container, info.videoId, info.listId);
		this.player.setVolume(this.volume);
		this.player.onPlaylistInfo = (index, list, title) => this.updateNowPlaying(index, list, title);
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

		this.listeners.add(selectEl, "change", () => {
			const track = this.playlist[parseInt(selectEl.value, 10)];
			if (!track) return;

			const info = extractYouTubeInfo(track.url);
			if (this.player?.isPlayerReady()) {
				this.player.loadVideoOrPlaylist(info.videoId, info.listId);
				if (this.shuffle) this.timeouts.set(() => this.player?.setShuffle(true), SHUFFLE_AFTER_LOAD_MS);
			}

			this.renderCheckpoints(track.checkpoints ?? []);
			this.playlistOrderEl?.setText("");
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
				if (!this.player) return;
				this.player.seekTo(parseTimeString(checkpoint.time));
				new Notice(`⏩ Jumped to ${checkpoint.label}`);
				if (!this.playing) this.toggle();
			});
		}
	}

	// --- Now-playing readout ---------------------------------------------

	private updateNowPlaying(index: number, list: string[], title: string): void {
		this.playlistOrderEl?.setText(list.length > 0 ? `Video ${index + 1} / ${list.length}` : "");
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

	// --- Playback control ------------------------------------------------

	toggle(): void {
		if (!this.player) return;
		if (this.playing) {
			this.player.pause();
			this.setPlayingState(false);
		} else {
			this.player.play();
			this.setPlayingState(true);
		}
	}

	/** Marks the transport as playing without touching the player itself. */
	markPlaying(): void {
		this.setPlayingState(true);
	}

	/** Resumes at the configured volume, optionally rewinding to the start first. */
	startPlayback(fromStart: boolean): void {
		if (this.player) {
			if (fromStart) this.player.seekTo(0);
			this.player.setVolume(this.volume);
			this.player.play();
		}
		this.setPlayingState(true);
	}

	private setPlayingState(playing: boolean): void {
		this.playing = playing;
		if (!this.playBtnEl) return;
		setIcon(this.playBtnEl, playing ? "pause" : "play");
		this.playBtnEl.toggleClass("is-playing", playing);
	}

	/**
	 * Plays the track a {@link MusicReference} points at, seeking to its
	 * checkpoint. Loading is skipped when the track is already the current one.
	 */
	loadTrack(ref: MusicReference, autoPlay = true): void {
		const track = this.playlist[ref.trackIndex];
		if (!track || !this.player?.isPlayerReady()) return;

		if (this.selectEl) this.selectEl.value = ref.trackIndex.toString();

		const info = extractYouTubeInfo(track.url);
		const checkpoint = ref.checkpointIndex >= 0 ? track.checkpoints?.[ref.checkpointIndex] : undefined;
		const current = this.player.getCurrentTrackInfo();

		if (current.videoId === info.videoId && current.listId === info.listId) {
			if (checkpoint) {
				this.player.seekTo(parseTimeString(checkpoint.time));
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
				this.player?.seekTo(parseTimeString(checkpoint.time));
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

		if (this.player) {
			this.player.pause();
			// Let the player finish draining before it is destroyed.
			await new Promise((resolve) => window.setTimeout(resolve, DRAIN_BEFORE_DESTROY_MS));
			this.player.destroy();
			this.player = null;
		}

		this.selectEl = null;
		this.checkpointsEl = null;
		this.playBtnEl = null;
		this.playlistOrderEl = null;
		this.videoTitleEl = null;
	}
}
