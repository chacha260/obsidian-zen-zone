import { TimeoutRegistry } from "../dom";
import { RepeatMode, YouTubePlayer, YouTubePlayerEvent } from "../types";

const IFRAME_API_SRC = "https://www.youtube.com/iframe_api";

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
 * A hidden YouTube player used as a background audio source.
 *
 * Playback info is pushed from the API's `onStateChange` events rather than
 * polled, and every delayed action is tracked so nothing fires after
 * {@link destroy}.
 */
export class YouTubeAudio {
	private player: YouTubePlayer | null = null;
	private isReady = false;
	private destroyed = false;
	private readonly containerId: string;
	private playQueued = false;
	private volumePercent = 50;
	private readonly timeouts = new TimeoutRegistry();

	private currentVideoId: string | null = null;
	private currentListId: string | null = null;

	private lastPlaylistIndex = -1;
	private lastVideoTitle = "";
	private repeatMode: RepeatMode = RepeatMode.Off;
	/** Suppresses the "repeat one" guard while the user is skipping tracks. */
	private manualTrackChange = false;

	onPlaylistInfo?: (index: number, list: string[], title: string) => void;

	constructor(container: HTMLElement, videoId: string | null, listId: string | null) {
		container.querySelector(".yt-player-wrapper")?.remove();

		const wrapper = container.createDiv({ cls: "yt-player-wrapper" });
		this.containerId = `yt-player-${Date.now()}`;
		wrapper.id = this.containerId;

		this.currentVideoId = videoId;
		this.currentListId = listId;

		this.initAPI(videoId, listId);
	}

	// --- Setup -----------------------------------------------------------

	private initAPI(videoId: string | null, listId: string | null): void {
		if (!window.YT) this.injectApiScript();

		const initPlayer = () => {
			if (this.destroyed || !window.YT) return;

			const playerVars: Record<string, string | number> = {
				controls: 0,
				autoplay: 0,
				enablejsapi: 1,
				origin: window.location.origin,
				modestbranding: 1,
				rel: 0,
				showinfo: 0,
				iv_load_policy: 3
			};

			if (listId) {
				playerVars.listType = "playlist";
				playerVars.list = listId;
			} else if (videoId) {
				playerVars.loop = 1;
				playerVars.playlist = videoId;
			}

			this.player = new window.YT.Player(this.containerId, {
				height: "0",
				width: "0",
				videoId: videoId ?? undefined,
				playerVars,
				events: {
					onReady: () => this.onPlayerReady(),
					onStateChange: (event) => this.onPlayerStateChange(event)
				}
			});
		};

		if (window.YT?.Player) {
			initPlayer();
		} else {
			const previous = window.onYouTubeIframeAPIReady;
			window.onYouTubeIframeAPIReady = () => {
				previous?.();
				initPlayer();
			};
		}
	}

	private injectApiScript(): void {
		const script = document.createElement("script");
		script.src = IFRAME_API_SRC;
		const firstScript = document.getElementsByTagName("script")[0];
		if (firstScript?.parentNode) {
			firstScript.parentNode.insertBefore(script, firstScript);
		} else {
			document.head.appendChild(script);
		}
	}

	// --- API events ------------------------------------------------------

	private onPlayerReady(): void {
		if (this.destroyed) return;
		this.isReady = true;
		this.player?.setVolume(this.volumePercent);
		if (this.playQueued) {
			this.player?.playVideo();
			this.playQueued = false;
		}
		this.updatePlaylistInfo();
	}

	private onPlayerStateChange(event: YouTubePlayerEvent): void {
		if (this.destroyed) return;

		if (event.data === PlayerState.PLAYING || event.data === PlayerState.CUED) {
			// "Repeat one" has to fight the playlist's own auto-advance.
			if (event.data === PlayerState.PLAYING && this.repeatMode === RepeatMode.One && !this.manualTrackChange) {
				if (this.rewindToPinnedTrack()) return;
			}
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

	/** Returns true when playback was sent back to the track pinned by "repeat one". */
	private rewindToPinnedTrack(): boolean {
		try {
			const currentIndex = this.player?.getPlaylistIndex() ?? -1;
			if (this.lastPlaylistIndex >= 0 && currentIndex !== this.lastPlaylistIndex) {
				this.player?.playVideoAt(this.lastPlaylistIndex);
				return true;
			}
		} catch {
			// The player rejects playlist calls until it has loaded one.
		}
		return false;
	}

	private updatePlaylistInfo(): void {
		if (!this.onPlaylistInfo || !this.player) return;
		try {
			const list = this.player.getPlaylist() ?? [];
			const index = this.player.getPlaylistIndex() ?? -1;
			const title = this.player.getVideoData()?.title ?? "";

			// Only notify on an actual change, so the UI is not rewritten on every event.
			if (index === this.lastPlaylistIndex && title === this.lastVideoTitle) return;
			this.lastPlaylistIndex = index;
			this.lastVideoTitle = title;
			this.onPlaylistInfo(index, list, title);
		} catch {
			// Metadata is not available yet; the next state change will retry.
		}
	}

	// --- Repeat ----------------------------------------------------------

	setRepeatMode(mode: RepeatMode): void {
		this.repeatMode = mode;
		this.applyRepeatMode();
	}

	getRepeatMode(): RepeatMode {
		return this.repeatMode;
	}

	private applyRepeatMode(): void {
		if (!this.isReady || typeof this.player?.setLoop !== "function") return;
		this.player.setLoop(this.repeatMode !== RepeatMode.Off);
	}

	// --- Loading ---------------------------------------------------------

	/** Pauses and rewinds so the player stops holding on to the decoded stream. */
	private clearBuffers(): void {
		if (!this.player) return;
		if (typeof this.player.pauseVideo === "function") this.player.pauseVideo();
		this.timeouts.set(() => this.player?.seekTo(0, true), DELAY.seekAfterPause);
	}

	loadVideoOrPlaylist(videoId: string | null, listId: string | null): void {
		if (!this.isReady || !this.player) return;
		if (videoId === this.currentVideoId && listId === this.currentListId) return;

		if (typeof this.player.stopVideo === "function") this.player.stopVideo();
		this.clearBuffers();

		this.timeouts.set(() => {
			if (!this.player) return;

			this.currentVideoId = videoId;
			this.currentListId = listId;

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
			this.clearBuffers();
			this.updatePlaylistInfo();
		}, DELAY.manualTrackChange);
	}

	isPlayerReady(): boolean {
		return this.isReady;
	}

	getCurrentTrackInfo(): { videoId: string | null; listId: string | null } {
		return { videoId: this.currentVideoId, listId: this.currentListId };
	}

	// --- Teardown --------------------------------------------------------

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.timeouts.clearAll();
		this.onPlaylistInfo = undefined;

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

		window.setTimeout(() => document.getElementById(this.containerId)?.remove(), DELAY.destroyDom);

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
