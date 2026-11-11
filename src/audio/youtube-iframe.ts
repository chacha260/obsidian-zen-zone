import { YouTubePlayer, YouTubePlayerOptions } from "../types";

const EMBED_ORIGIN = "https://www.youtube.com";

/** How often to offer the handshake until the embed answers, in milliseconds. */
const HANDSHAKE_INTERVAL_MS = 250;
/** Give up offering the handshake after this many attempts (about 15 seconds). */
const HANDSHAKE_MAX_ATTEMPTS = 60;

/** What the embed reports about itself through `infoDelivery` messages. */
interface PlayerInfo {
	playerState?: number;
	currentTime?: number;
	playlist?: string[] | null;
	playlistIndex?: number;
	videoData?: { title?: string } | null;
}

interface EmbedMessage {
	event?: string;
	id?: string;
	info?: unknown;
}

let nextPlayerId = 0;

/**
 * Drives a plain YouTube embed over `postMessage`.
 *
 * This speaks the same wire protocol as YouTube's IFrame Player API script,
 * without loading that script: the plugin never executes remote code in the
 * app's own context, and everything YouTube runs stays inside the sandbox of
 * its cross-origin iframe.
 */
export class YouTubeIframePlayer implements YouTubePlayer {
	private readonly id: string;
	private readonly iframe: HTMLIFrameElement;
	private readonly events: YouTubePlayerOptions["events"];
	private readonly onMessage = (event: MessageEvent) => this.handleMessage(event);

	private info: PlayerInfo = {};
	private ready = false;
	private destroyed = false;
	private connected = false;
	private handshakeTimer: number | null = null;
	private handshakeAttempts = 0;

	constructor(host: HTMLElement, options: YouTubePlayerOptions) {
		this.id = `zen-zone-yt-${Date.now()}-${nextPlayerId++}`;
		this.events = options.events;

		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(options.playerVars)) params.set(key, String(value));
		params.set("enablejsapi", "1");

		this.iframe = host.createEl("iframe", {
			attr: {
				id: this.id,
				width: options.width,
				height: options.height,
				allow: "autoplay; encrypted-media",
				referrerpolicy: "strict-origin-when-cross-origin",
				src: `${EMBED_ORIGIN}/embed/${encodeURIComponent(options.videoId ?? "")}?${params.toString()}`
			}
		});

		window.addEventListener("message", this.onMessage);
		this.iframe.addEventListener("load", () => this.startHandshake());
	}

	// --- Wire protocol ---------------------------------------------------

	private post(message: Record<string, unknown>): void {
		this.iframe.contentWindow?.postMessage(
			JSON.stringify({ ...message, id: this.id, channel: "widget" }),
			EMBED_ORIGIN
		);
	}

	private command(func: string, ...args: unknown[]): void {
		if (this.destroyed) return;
		this.post({ event: "command", func, args });
	}

	/** The embed stays silent until it is told someone is listening. */
	private startHandshake(): void {
		if (this.destroyed || this.connected) return;
		this.stopHandshake();
		this.handshakeAttempts = 0;

		const offer = () => {
			if (this.connected || this.handshakeAttempts++ >= HANDSHAKE_MAX_ATTEMPTS) {
				this.stopHandshake();
				return;
			}
			this.post({ event: "listening" });
		};
		offer();
		this.handshakeTimer = window.setInterval(offer, HANDSHAKE_INTERVAL_MS);
	}

	private stopHandshake(): void {
		if (this.handshakeTimer === null) return;
		window.clearInterval(this.handshakeTimer);
		this.handshakeTimer = null;
	}

	private handleMessage(event: MessageEvent): void {
		if (this.destroyed) return;
		if (event.origin !== EMBED_ORIGIN || event.source !== this.iframe.contentWindow) return;

		const message = this.parse(event.data);
		if (!message || (message.id !== undefined && message.id !== this.id)) return;

		if (!this.connected) {
			this.connected = true;
			this.stopHandshake();
			this.command("addEventListener", "onStateChange");
		}

		switch (message.event) {
			case "initialDelivery":
			case "infoDelivery":
				this.mergeInfo(message.info);
				break;
			case "onStateChange":
				if (typeof message.info === "number") this.setState(message.info);
				break;
			case "onReady":
				break;
			default:
				return;
		}

		// Whichever arrives first proves the player is up; `onReady` is not
		// guaranteed to be the first message.
		if (!this.ready) {
			this.ready = true;
			this.events.onReady();
		}
	}

	private parse(data: unknown): EmbedMessage | null {
		if (typeof data !== "string") return null;
		try {
			const parsed: unknown = JSON.parse(data);
			return parsed && typeof parsed === "object" ? parsed : null;
		} catch {
			return null;
		}
	}

	private mergeInfo(info: unknown): void {
		if (!info || typeof info !== "object") return;
		const update = info as PlayerInfo;
		const previousState = this.info.playerState;
		const describesTrack = "playlist" in update || "playlistIndex" in update || "videoData" in update;

		Object.assign(this.info, update);

		if (typeof update.playerState === "number" && update.playerState !== previousState) {
			this.events.onStateChange({ data: update.playerState });
		}
		if (describesTrack) this.events.onInfoChange?.();
	}

	private setState(state: number): void {
		if (this.info.playerState === state) return;
		this.info.playerState = state;
		this.events.onStateChange({ data: state });
	}

	// --- YouTubePlayer ---------------------------------------------------

	playVideo(): void { this.command("playVideo"); }
	pauseVideo(): void { this.command("pauseVideo"); }
	stopVideo(): void { this.command("stopVideo"); }
	seekTo(seconds: number, allowSeekAhead: boolean): void { this.command("seekTo", seconds, allowSeekAhead); }
	setVolume(volume: number): void { this.command("setVolume", volume); }
	setShuffle(shuffle: boolean): void { this.command("setShuffle", shuffle); }
	setLoop(loop: boolean): void { this.command("setLoop", loop); }
	nextVideo(): void { this.command("nextVideo"); }
	previousVideo(): void { this.command("previousVideo"); }
	playVideoAt(index: number): void { this.command("playVideoAt", index); }

	loadPlaylist(options: { listType: string; list: string; index: number; startSeconds: number }): void {
		this.command("loadPlaylist", options);
	}

	loadVideoById(options: { videoId: string; startSeconds: number }): void {
		this.command("loadVideoById", options);
	}

	getPlaylist(): string[] | null { return this.info.playlist ?? null; }
	getPlaylistIndex(): number { return this.info.playlistIndex ?? -1; }
	getCurrentTime(): number { return this.info.currentTime ?? 0; }
	getVideoData(): { title?: string } | null { return this.info.videoData ?? null; }

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.stopHandshake();
		window.removeEventListener("message", this.onMessage);
		this.iframe.remove();
	}
}
