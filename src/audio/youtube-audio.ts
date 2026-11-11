import { TimeoutRegistry } from "../dom";
import { AudioBackend, RepeatMode, TrackSource, YouTubePlayer, YouTubePlayerEvent } from "../types";
import { YouTubeIframePlayer } from "./youtube-iframe";

/** YouTube IFrame Player API state codes. */
const PlayerState = { ENDED: 0, PLAYING: 1, CUED: 5 } as const;

/** Give the player time to settle before touching it again, in milliseconds. */
const DELAY = {
	seekAfterPause: 100,
	loadAfterStop: 300,
	infoAfterLoad: 500,
	repeatAfterLoad: 800,
	manualTrackChange: 1000,
	destroyPlayer: 500,
	destroyDom: 600
} as const;

/**
 * A YouTube embed used as an audio source. How visible it is on screen is up
 * to the host element it is created in.
 *
 * Playback info is pushed from the embed's own messages rather than polled, and every delayed action is tracked so nothing fires after
 * {@link destroy}.
 */
export class YouTubeAudio implements AudioBackend {
	readonly kind = "youtube" as const;

	private player: YouTubePlayer | null = null;
	private isReady = false;
	private destroyed = false;
	private readonly wrapper: HTMLElement;
	private playQueued = false;
	private volumePercent = 50;
	private readonly timeouts = new TimeoutRegistry();

	private currentVideoId: string | null = null;
	private currentListId: string | null = null;

	private lastPlaylistIndex = -1;
	/** The playlist position "repeat one" holds on to, or -1 when nothing is pinned yet. */
	private pinnedIndex = -1;
	private lastVideoTitle = "";
	private repeatMode: RepeatMode = RepeatMode.Off;
	/** Suppresses the "repeat one" guard while the user is skipping tracks. */
	private manualTrackChange = false;

	/** Reports the playlist size rather than the array, which can hold hundreds of ids. */
	onPlaylistInfo?: (index: number, total: number, title: string) => void;
	onReady?: () => void;

	constructor(container: HTMLElement, videoId: string | null, listId: string | null) {
		container.querySelector(".yt-player-wrapper")?.remove();

		const wrapper = container.createDiv({ cls: "yt-player-wrapper" });
		this.wrapper = wrapper;

		this.currentVideoId = videoId;
		this.currentListId = listId;

		this.createPlayer(wrapper, videoId, listId);
	}

	// --- Setup -----------------------------------------------------------

	private createPlayer(host: HTMLElement, videoId: string | null, listId: string | null): void {
		const playerVars: Record<string, string | number> = {
			controls: 0,
			autoplay: 0,
			origin: window.location.origin,
			rel: 0,
			iv_load_policy: 3,
			playsinline: 1
		};

		if (listId) {
			playerVars.listType = "playlist";
			playerVars.list = listId;
		} else if (videoId) {
			playerVars.loop = 1;
			playerVars.playlist = videoId;
		}

		this.player = new YouTubeIframePlayer(host, {
			height: "100%",
			width: "100%",
			videoId: videoId ?? undefined,
			playerVars,
			events: {
				onReady: () => this.onPlayerReady(),
				onStateChange: (event) => this.onPlayerStateChange(event),
				onInfoChange: () => this.onInfoChange()
			}
		});
	}

	// --- API events ------------------------------------------------------

	private onPlayerReady(): void {
		if (this.destroyed) return;
		this.isReady = true;
		this.player?.setVolume(this.volumePercent);
		// A repeat mode chosen before the player existed has not reached it yet.
		this.applyRepeatMode();
		if (this.playQueued) {
			this.player?.playVideo();
			this.playQueued = false;
		}
		this.updatePlaylistInfo();
		this.onReady?.();
	}

	private onPlayerStateChange(event: YouTubePlayerEvent): void {
		if (this.destroyed) return;

		if (event.data === PlayerState.PLAYING || event.data === PlayerState.CUED) {
			if (event.data === PlayerState.PLAYING && this.rewindToPinnedTrack()) return;
			this.updatePlaylistInfo();
			return;
		}

		if (event.data === PlayerState.ENDED) {
			if (this.repeatMode === RepeatMode.One) {
				this.timeouts.set(() => {
					this.player?.seekTo(0, true);
					this.player?.playVideo();
				}, DELAY.seekAfterPause);
			} else if (this.repeatMode === RepeatMode.Off) {
				this.clearBuffers();
			}
			// RepeatMode.All is handled by the player itself via setLoop(true).
		}
	}

	/**
	 * "Repeat one" has to fight the playlist's own auto-advance: the first
	 * track seen is pinned, and playback is sent back to it whenever the
	 * player moves on by itself. Returns true when it was sent back.
	 */
	private rewindToPinnedTrack(): boolean {
		if (this.repeatMode !== RepeatMode.One || this.manualTrackChange) return false;

		const currentIndex = this.player?.getPlaylistIndex() ?? -1;
		if (currentIndex < 0) return false;
		if (this.pinnedIndex < 0) {
			this.pinnedIndex = currentIndex;
			return false;
		}
		if (currentIndex === this.pinnedIndex) return false;

		this.player?.playVideoAt(this.pinnedIndex);
		return true;
	}

	/** The position can arrive after the state change that announced the new track. */
	private onInfoChange(): void {
		if (this.destroyed) return;
		if (this.rewindToPinnedTrack()) return;
		this.updatePlaylistInfo();
	}

	private updatePlaylistInfo(): void {
		if (!this.onPlaylistInfo || !this.player) return;
		try {
			const total = this.player.getPlaylist()?.length ?? 0;
			const index = this.player.getPlaylistIndex() ?? -1;
			const title = this.player.getVideoData()?.title ?? "";

			// Only notify on an actual change, so the UI is not rewritten on every event.
			if (index === this.lastPlaylistIndex && title === this.lastVideoTitle) return;
			this.lastPlaylistIndex = index;
			this.lastVideoTitle = title;
			this.onPlaylistInfo(index, total, title);
		} catch {
			// Metadata is not available yet; the next state change will retry.
		}
	}

	// --- Repeat ----------------------------------------------------------

	setRepeatMode(mode: RepeatMode): void {
		this.repeatMode = mode;
		// Pin whatever is playing now; -1 lets the next report pin it.
		this.pinnedIndex = mode === RepeatMode.One ? (this.player?.getPlaylistIndex() ?? -1) : -1;
		this.applyRepeatMode();
	}

	private applyRepeatMode(): void {
		if (!this.isReady || typeof this.player?.setLoop !== "function") return;
		// A lone video has no "next": it keeps looping whatever the mode, as ambience should.
		this.player.setLoop(this.repeatMode !== RepeatMode.Off || !this.currentListId);
	}

	// --- Loading ---------------------------------------------------------

	/** Pauses and rewinds so the player stops holding on to the decoded stream. */
	private clearBuffers(): void {
		if (!this.player) return;
		if (typeof this.player.pauseVideo === "function") this.player.pauseVideo();
		this.timeouts.set(() => this.player?.seekTo(0, true), DELAY.seekAfterPause);
	}

	load(source: TrackSource): void {
		if (source.kind === "youtube") this.loadVideoOrPlaylist(source.videoId, source.listId);
	}

	getSource(): TrackSource {
		return { kind: "youtube", videoId: this.currentVideoId, listId: this.currentListId };
	}

	private loadVideoOrPlaylist(videoId: string | null, listId: string | null): void {
		if (!this.isReady || !this.player) return;
		if (videoId === this.currentVideoId && listId === this.currentListId) return;

		if (typeof this.player.stopVideo === "function") this.player.stopVideo();
		this.clearBuffers();

		this.timeouts.set(() => {
			if (!this.player) return;

			this.currentVideoId = videoId;
			this.currentListId = listId;
			this.pinnedIndex = -1;

			if (listId) {
				this.player.loadPlaylist({ listType: "playlist", list: listId, index: 0, startSeconds: 0 });
			} else if (videoId) {
				this.player.loadVideoById({ videoId, startSeconds: 0 });
			}

			this.timeouts.set(() => this.updatePlaylistInfo(), DELAY.infoAfterLoad);
			this.timeouts.set(() => this.applyRepeatMode(), DELAY.repeatAfterLoad);
		}, DELAY.loadAfterStop);
	}

	// --- Transport -------------------------------------------------------

	play(): void {
		if (this.isReady && this.player) this.player.playVideo();
		else this.playQueued = true;
	}

	pause(): void {
		if (this.isReady && this.player) this.player.pauseVideo();
		else this.playQueued = false;
	}

	setVolume(vol0to1: number): void {
		this.volumePercent = vol0to1 * 100;
		if (this.isReady && this.player) this.player.setVolume(this.volumePercent);
	}

	seekTo(seconds: number): void {
		if (this.isReady && this.player) this.player.seekTo(seconds, true);
	}

	setShuffle(shuffle: boolean): void {
		if (this.isReady && typeof this.player?.setShuffle === "function") this.player.setShuffle(shuffle);
	}

	nextVideo(): void {
		this.skip(() => this.player?.nextVideo());
	}

	previousVideo(): void {
		this.skip(() => this.player?.previousVideo());
	}

	private skip(move: () => void): void {
		if (!this.isReady || !this.player) return;
		this.manualTrackChange = true;
		move();
		this.timeouts.set(() => {
			this.manualTrackChange = false;
			// The user chose a new track; that is the one to repeat from now on.
			this.pinnedIndex = this.repeatMode === RepeatMode.One ? (this.player?.getPlaylistIndex() ?? -1) : -1;
			this.clearBuffers();
			this.updatePlaylistInfo();
		}, DELAY.manualTrackChange);
	}

	isPlayerReady(): boolean {
		return this.isReady;
	}

	/** Current playback position in seconds, so a released player can resume where it was. */
	getCurrentTime(): number {
		if (!this.isReady || typeof this.player?.getCurrentTime !== "function") return 0;
		try {
			return this.player.getCurrentTime() || 0;
		} catch {
			return 0;
		}
	}

	// --- Teardown --------------------------------------------------------

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.timeouts.clearAll();
		this.onPlaylistInfo = undefined;
		this.onReady = undefined;

		const player = this.player;
		if (player) {
			try {
				if (typeof player.stopVideo === "function") player.stopVideo();
				if (typeof player.pauseVideo === "function") player.pauseVideo();
			} catch (error) {
				console.warn("Zen Zone: failed to stop the YouTube player", error);
			}

			// The API needs a moment after stopping before destroy() is safe.
			window.setTimeout(() => {
				try {
					player.destroy();
				} catch (error) {
					console.warn("Zen Zone: failed to destroy the YouTube player", error);
				}
			}, DELAY.destroyPlayer);
		}

		window.setTimeout(() => this.wrapper.remove(), DELAY.destroyDom);

		this.player = null;
		this.isReady = false;
		this.currentVideoId = null;
		this.currentListId = null;
		this.lastPlaylistIndex = -1;
		this.lastVideoTitle = "";
		this.repeatMode = RepeatMode.Off;
		this.manualTrackChange = false;
	}
}
