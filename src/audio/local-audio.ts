import { AudioBackend, LocalFile, RepeatMode, TrackSource } from "../types";

type LocalSource = Extract<TrackSource, { kind: "local" }>;

/**
 * Plays audio files from the vault: a single file, or every audio file in a
 * folder as a playlist. Works offline and never touches the network.
 */
export class LocalAudio implements AudioBackend {
	readonly kind = "local" as const;

	private audio: HTMLAudioElement | null = new Audio();
	private source: LocalSource;
	/** Play order as indexes into `source.files`; reshuffled when shuffle is on. */
	private order: number[] = [];
	private position = 0;
	private shuffle = false;
	private repeatMode: RepeatMode = RepeatMode.Off;
	private wantsToPlay = false;

	onPlaylistInfo?: (index: number, total: number, title: string) => void;
	onReady?: () => void;

	constructor(source: LocalSource) {
		this.source = source;
		this.audio?.addEventListener("ended", () => this.onEnded());
		this.resetOrder();
		this.cue(0);
		// Callers attach their hooks right after construction.
		window.setTimeout(() => {
			if (!this.audio) return;
			this.onReady?.();
			this.reportInfo();
		}, 0);
	}

	private get files(): LocalFile[] {
		return this.source.files;
	}

	private get current(): LocalFile | undefined {
		return this.files[this.order[this.position]];
	}

	private resetOrder(): void {
		const keep = this.order[this.position];
		this.order = this.files.map((_, index) => index);
		if (this.shuffle) {
			for (let i = this.order.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[this.order[i], this.order[j]] = [this.order[j], this.order[i]];
			}
		}
		// Keep the playing file where it is, so toggling shuffle does not skip.
		const at = keep === undefined ? -1 : this.order.indexOf(keep);
		this.position = at >= 0 ? at : 0;
	}

	/** Points the element at a file without starting it. */
	private cue(position: number): void {
		this.position = position;
		const file = this.current;
		if (!this.audio || !file) return;
		this.audio.src = file.url;
		this.audio.loop = this.repeatMode === RepeatMode.One || (this.files.length === 1 && this.repeatMode === RepeatMode.All);
		this.reportInfo();
	}

	private reportInfo(): void {
		const file = this.current;
		if (!file) return;
		this.onPlaylistInfo?.(this.order[this.position], this.files.length, file.title);
	}

	private onEnded(): void {
		const last = this.position >= this.order.length - 1;
		if (last && this.repeatMode === RepeatMode.Off) {
			this.wantsToPlay = false;
			this.cue(0);
			return;
		}
		this.cue(last ? 0 : this.position + 1);
		this.play();
	}

	private step(delta: number): void {
		if (this.files.length === 0) return;
		const next = (this.position + delta + this.order.length) % this.order.length;
		this.cue(next);
		if (this.wantsToPlay) this.play();
	}

	// --- AudioBackend ----------------------------------------------------

	load(source: TrackSource): void {
		if (source.kind !== "local") return;
		this.audio?.pause();
		this.source = source;
		this.order = [];
		this.resetOrder();
		this.cue(0);
	}

	getSource(): TrackSource {
		return this.source;
	}

	play(): void {
		this.wantsToPlay = true;
		this.audio?.play().catch((error) => console.error("Zen Zone: failed to play the audio file", error));
	}

	pause(): void {
		this.wantsToPlay = false;
		this.audio?.pause();
	}

	setVolume(volume: number): void {
		if (this.audio) this.audio.volume = Math.min(Math.max(volume, 0), 1);
	}

	seekTo(seconds: number): void {
		if (this.audio) this.audio.currentTime = seconds;
	}

	setShuffle(shuffle: boolean): void {
		if (this.shuffle === shuffle) return;
		this.shuffle = shuffle;
		this.resetOrder();
	}

	setRepeatMode(mode: RepeatMode): void {
		this.repeatMode = mode;
		if (this.audio) this.audio.loop = mode === RepeatMode.One || (this.files.length === 1 && mode === RepeatMode.All);
	}

	nextVideo(): void { this.step(1); }
	previousVideo(): void { this.step(-1); }
	isPlayerReady(): boolean { return this.audio !== null; }
	getCurrentTime(): number { return this.audio?.currentTime ?? 0; }

	destroy(): void {
		if (!this.audio) return;
		this.audio.pause();
		this.audio.removeAttribute("src");
		this.audio.load();
		this.audio = null;
		this.onPlaylistInfo = undefined;
		this.onReady = undefined;
	}
}
