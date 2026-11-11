import { Notice, TFile, TFolder, normalizePath } from "obsidian";
import type ZenZonePlugin from "../main";
import { AUDIO_EXTENSIONS } from "../constants";
import { TimeoutRegistry } from "../dom";
import { t } from "../i18n";
import type { SessionAudio } from "../session";
import { AudioBackend, Checkpoint, MusicReference, PlaylistItem, RepeatMode, TrackSource } from "../types";
import { extractYouTubeInfo, parseTimeString } from "../utils";
import { LocalAudio } from "./local-audio";
import { YouTubeAudio } from "./youtube-audio";

/** Wait for a freshly loaded YouTube track before seeking into it, in milliseconds. */
const SEEK_AFTER_LOAD_MS = 1500;
/** Wait before starting a YouTube track that was just loaded without a checkpoint. */
const PLAY_AFTER_LOAD_MS = 800;
/** Shuffle has to be re-applied once a new YouTube playlist is in place. */
const SHUFFLE_AFTER_LOAD_MS = 500;

/** Where playback should pick up once a player exists again. */
interface ResumePoint {
	source: TrackSource;
	positionSec: number;
}

export interface NowPlaying {
	index: number;
	total: number;
	title: string;
}

export interface AudioListener {
	onAudioChange(): void;
}

function sourceKey(source: TrackSource): string {
	return source.kind === "youtube" ? `yt:${source.videoId ?? ""}:${source.listId ?? ""}` : `local:${source.path}`;
}

/**
 * Everything that makes sound, owned by the plugin rather than the panel so
 * music keeps playing when the panel is closed.
 *
 * A player is by far the heaviest thing this plugin can hold, so one is created
 * on the first actual play, and released again after a configurable stretch of
 * silence. The position is remembered across a release.
 */
export class AudioEngine implements SessionAudio {
	private readonly timeouts = new TimeoutRegistry();
	private readonly listeners = new Set<AudioListener>();

	private host: HTMLElement | null = null;
	private backend: AudioBackend | null = null;
	private idleReleaseId: number | null = null;
	/** Set while no player exists, so the next play knows where to start. */
	private resumePoint: ResumePoint | null = null;

	private selectedIndexValue = 0;
	private playingValue = false;
	private nowPlayingValue: NowPlaying = { index: -1, total: 0, title: "" };

	constructor(private readonly plugin: ZenZonePlugin) {}

	// --- State -----------------------------------------------------------

	get playing(): boolean { return this.playingValue; }
	get selectedIndex(): number { return this.selectedIndexValue; }
	get nowPlaying(): NowPlaying { return this.nowPlayingValue; }
	get volume(): number { return this.plugin.settings.volume; }
	get shuffle(): boolean { return this.plugin.settings.shuffle; }
	get repeatMode(): RepeatMode { return this.plugin.settings.repeatMode; }

	private get playlist(): PlaylistItem[] {
		return this.plugin.settings.playlistData;
	}

	get selectedTrack(): PlaylistItem | undefined {
		return this.playlist[this.selectedIndexValue] ?? this.playlist[0];
	}

	subscribe(listener: AudioListener): void {
		this.listeners.add(listener);
	}

	unsubscribe(listener: AudioListener): void {
		this.listeners.delete(listener);
	}

	private emit(): void {
		for (const listener of this.listeners) listener.onAudioChange();
	}

	// --- Sources ---------------------------------------------------------

	/** Works out what a track plays: YouTube, or audio from the vault. */
	resolveSource(track: PlaylistItem): TrackSource | null {
		const info = extractYouTubeInfo(track.url);
		if (info.videoId || info.listId) return { kind: "youtube", ...info };

		const path = normalizePath(track.url);
		const entry = this.plugin.app.vault.getAbstractFileByPath(path);
		const playable = (file: TFile) => AUDIO_EXTENSIONS.includes(file.extension.toLowerCase());
		const toLocal = (file: TFile) => ({ url: this.plugin.app.vault.getResourcePath(file), title: file.basename });

		if (entry instanceof TFile && playable(entry)) {
			return { kind: "local", path, files: [toLocal(entry)] };
		}
		if (entry instanceof TFolder) {
			const files = entry.children
				.filter((child): child is TFile => child instanceof TFile && playable(child))
				.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
				.map(toLocal);
			if (files.length > 0) return { kind: "local", path, files };
		}
		return null;
	}

	// --- Player lifetime -------------------------------------------------

	/**
	 * Creates the player if it does not exist yet, starting from the remembered
	 * resume point or the selected track. `startAtSec` overrides that position.
	 */
	private ensureBackend(startAtSec?: number): AudioBackend | null {
		this.clearIdleRelease();
		if (this.backend) return this.backend;

		const start = this.resumePoint ?? this.selectedTrackStart();
		if (!start) return null;

		const positionSec = startAtSec ?? start.positionSec;
		this.resumePoint = null;

		const backend = this.createBackend(start.source);
		backend.setVolume(this.volume);
		backend.setRepeatMode(this.repeatMode);
		backend.onPlaylistInfo = (index, total, title) => {
			this.nowPlayingValue = { index, total, title };
			this.emit();
		};
		backend.onReady = () => {
			if (this.shuffle) backend.setShuffle(true);
			if (positionSec > 0) backend.seekTo(positionSec);
			if (this.playingValue) backend.play();
		};
		this.backend = backend;
		this.refreshVideoVisibility();
		return backend;
	}

	private createBackend(source: TrackSource): AudioBackend {
		if (source.kind === "local") return new LocalAudio(source);
		// The player must outlive any popout window, so it always lives in the main one.
		const mainDocument = this.plugin.app.workspace.containerEl.ownerDocument;
		this.host ??= mainDocument.body.createDiv({ cls: "zen-audio-host" });
		return new YouTubeAudio(this.host, source.videoId, source.listId);
	}

	private selectedTrackStart(): ResumePoint | null {
		const track = this.selectedTrack;
		const source = track ? this.resolveSource(track) : null;
		if (!source) {
			if (track) new Notice(t("audio.unplayable", { title: track.title }));
			return null;
		}
		return { source, positionSec: 0 };
	}

	private destroyBackend(): void {
		this.timeouts.clearAll();
		this.backend?.destroy();
		this.backend = null;
		this.nowPlayingValue = { index: -1, total: 0, title: "" };
		this.refreshVideoVisibility();
	}

	/** Shows the floating video only while a YouTube player exists and the user wants to see it. */
	refreshVideoVisibility(): void {
		const visible = this.backend?.kind === "youtube" && this.plugin.settings.showVideo;
		this.host?.toggleClass("is-video-visible", visible);
	}

	/** Tears the player down after a stretch of silence, remembering where it was. */
	private scheduleIdleRelease(): void {
		this.clearIdleRelease();
		const minutes = this.plugin.settings.audioIdleReleaseMinutes;
		if (minutes <= 0 || !this.backend) return;
		this.idleReleaseId = window.setTimeout(() => this.releaseBackend(), minutes * 60_000);
	}

	private clearIdleRelease(): void {
		if (this.idleReleaseId === null) return;
		window.clearTimeout(this.idleReleaseId);
		this.idleReleaseId = null;
	}

	private releaseBackend(): void {
		this.idleReleaseId = null;
		const backend = this.backend;
		if (!backend || this.playingValue) return;

		this.resumePoint = { source: backend.getSource(), positionSec: backend.getCurrentTime() };
		this.destroyBackend();
		this.emit();
	}

	// --- Transport -------------------------------------------------------

	toggle(): void {
		if (this.playingValue) this.pausePlayback();
		else this.startPlayback(false);
	}

	pausePlayback(): void {
		this.backend?.pause();
		this.setPlaying(false);
		this.scheduleIdleRelease();
	}

	/** Marks the transport as playing without touching the player itself. */
	markPlaying(): void {
		this.setPlaying(true);
	}

	/** Resumes at the configured volume, optionally rewinding to the start first. */
	startPlayback(fromStart: boolean): void {
		const backend = this.ensureBackend(fromStart ? 0 : undefined);
		if (!backend) {
			this.setPlaying(false);
			return;
		}
		this.setPlaying(true);
		if (!backend.isPlayerReady()) return;

		if (fromStart) backend.seekTo(0);
		backend.setVolume(this.volume);
		backend.play();
	}

	private setPlaying(playing: boolean): void {
		if (playing) this.clearIdleRelease();
		if (this.playingValue === playing) return;
		this.playingValue = playing;
		this.emit();
	}

	next(): void { this.backend?.nextVideo(); }
	previous(): void { this.backend?.previousVideo(); }

	setVolume(volume: number, persist: boolean): void {
		this.plugin.settings.volume = volume;
		this.backend?.setVolume(volume);
		if (persist) void this.plugin.saveSettings();
	}

	toggleShuffle(): void {
		this.plugin.settings.shuffle = !this.shuffle;
		this.backend?.setShuffle(this.shuffle);
		void this.plugin.saveSettings();
		this.emit();
	}

	cycleRepeatMode(): void {
		const next = { [RepeatMode.Off]: RepeatMode.All, [RepeatMode.All]: RepeatMode.One, [RepeatMode.One]: RepeatMode.Off };
		this.plugin.settings.repeatMode = next[this.repeatMode];
		this.backend?.setRepeatMode(this.repeatMode);
		void this.plugin.saveSettings();
		this.emit();
	}

	// --- Track selection -------------------------------------------------

	/** The user picked a track by hand. */
	selectTrack(index: number): void {
		const track = this.playlist[index];
		if (!track) return;
		this.selectedIndexValue = index;
		this.switchTo(track, 0, this.playingValue, false);
		this.emit();
	}

	/** Jumps to a checkpoint of the selected track and makes sure it is playing. */
	jumpTo(checkpoint: Checkpoint): void {
		const seconds = parseTimeString(checkpoint.time);
		const backend = this.ensureBackend(seconds);
		if (!backend) return;
		if (backend.isPlayerReady()) backend.seekTo(seconds);
		new Notice(t("audio.jumped", { label: checkpoint.label }));
		if (!this.playingValue) this.startPlayback(false);
	}

	/**
	 * Plays the track a {@link MusicReference} points at, from its checkpoint.
	 * With `autoPlay` false the track is only queued: no player is created, so
	 * a silent session never pays for one.
	 */
	loadTrack(ref: MusicReference, autoPlay = true): void {
		const track = this.playlist[ref.trackIndex];
		if (!track) return;

		this.selectedIndexValue = ref.trackIndex;
		const checkpoint = ref.checkpointIndex >= 0 ? track.checkpoints?.[ref.checkpointIndex] : undefined;
		this.switchTo(track, checkpoint ? parseTimeString(checkpoint.time) : 0, autoPlay, Boolean(checkpoint));
		this.emit();
	}

	private switchTo(track: PlaylistItem, startAt: number, autoPlay: boolean, seek: boolean): void {
		const source = this.resolveSource(track);
		if (!source) {
			new Notice(t("audio.unplayable", { title: track.title }));
			return;
		}

		// No player, or one of the wrong kind: aim the next play and let it build one.
		if (!this.backend || this.backend.kind !== source.kind) {
			if (this.backend) this.destroyBackend();
			this.resumePoint = { source, positionSec: startAt };
			if (autoPlay) this.startPlayback(false);
			return;
		}

		const backend = this.backend;
		if (sourceKey(backend.getSource()) === sourceKey(source)) {
			if (seek) backend.seekTo(startAt);
			if (autoPlay) this.playNow(backend);
			return;
		}

		backend.load(source);

		// A local file is ready at once; YouTube needs a moment to swap streams.
		const settle = (delay: number, action: () => void) => {
			if (backend.kind === "youtube") this.timeouts.set(action, delay);
			else action();
		};
		if (this.shuffle) settle(SHUFFLE_AFTER_LOAD_MS, () => backend.setShuffle(true));
		if (startAt > 0) {
			settle(SEEK_AFTER_LOAD_MS, () => {
				backend.seekTo(startAt);
				if (autoPlay) this.playNow(backend);
			});
		} else if (autoPlay) {
			settle(PLAY_AFTER_LOAD_MS, () => this.playNow(backend));
		}
	}

	private playNow(backend: AudioBackend): void {
		if (this.backend !== backend) return;
		this.setPlaying(true);
		backend.play();
	}

	// --- Teardown --------------------------------------------------------

	dispose(): void {
		this.clearIdleRelease();
		this.timeouts.clearAll();
		this.listeners.clear();
		this.backend?.destroy();
		this.backend = null;
		this.host?.remove();
		this.host = null;
	}
}
