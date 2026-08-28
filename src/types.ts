// =========================================================================
// Shared types
// =========================================================================

/** A named position inside a track, e.g. `{ label: "🌃 Night", time: "10:30" }`. */
export interface Checkpoint {
	label: string;
	time: string;
}

export interface PlaylistItem {
	title: string;
	url: string;
	checkpoints?: Checkpoint[];
}

/** Points at a track in `settings.playlistData`, optionally at one of its checkpoints. */
export interface MusicReference {
	trackIndex: number;
	/** `-1` means "start of the track". */
	checkpointIndex: number;
}

export interface ZenTask {
	id: string;
	content: string;
	header?: string;
	/** Daily note the task was filed into, so it can be completed there later. */
	filePath?: string;
}

export type DailyTaskAction = "add" | "complete" | "delete";

export enum TimerState { Idle, Focus, ShortBreak, LongBreak }
export enum RepeatMode { Off, All, One }

/** Either a single video, a playlist, or both, extracted from a YouTube URL. */
export interface YouTubeInfo {
	videoId: string | null;
	listId: string | null;
}

export interface ZenZoneSettings {
	playlistData: PlaylistItem[];
	workDuration: number;
	shortBreakDuration: number;
	longBreakDuration: number;
	autoCollapseSidebars: boolean;
	hideHeader: boolean;
	autoLogToDaily: boolean;
	showStatusBarTimer: boolean;
	tasks: ZenTask[];
	workMusic: MusicReference[];
	breakMusic: MusicReference[];
	dailyNoteFormat: string;
	dailyNoteFolder: string;
	dailyNoteTargetHeader: string;
	soundStart: string;
	durationStart: number;
	soundFocusToShort: string;
	durationFocusToShort: number;
	soundShortToFocus: string;
	durationShortToFocus: number;
	soundFocusToLong: string;
	durationFocusToLong: number;
	soundLongToFinish: string;
	durationLongToFinish: number;
}

/** Settings keys holding a vault path to a transition sound. */
export type SoundPathKey = {
	[K in keyof ZenZoneSettings]: K extends `sound${string}` ? K : never;
}[keyof ZenZoneSettings];

/** Settings keys holding how long to wait on a transition sound, in seconds. */
export type SoundDurationKey = {
	[K in keyof ZenZoneSettings]: K extends `duration${string}` ? K : never;
}[keyof ZenZoneSettings];

// --- Ambient globals -----------------------------------------------------

/** The subset of moment.js that Obsidian exposes and this plugin uses. */
export interface MomentLike {
	format(pattern?: string): string;
}

/** The subset of the YouTube IFrame Player API that this plugin uses. */
export interface YouTubePlayer {
	playVideo(): void;
	pauseVideo(): void;
	stopVideo(): void;
	seekTo(seconds: number, allowSeekAhead: boolean): void;
	setVolume(volume: number): void;
	setShuffle(shuffle: boolean): void;
	setLoop(loop: boolean): void;
	nextVideo(): void;
	previousVideo(): void;
	playVideoAt(index: number): void;
	getPlaylist(): string[] | null;
	getPlaylistIndex(): number;
	getVideoData(): { title?: string } | null;
	loadPlaylist(options: { listType: string; list: string; index: number; startSeconds: number }): void;
	loadVideoById(options: { videoId: string; startSeconds: number }): void;
	destroy(): void;
}

export interface YouTubePlayerEvent {
	data: number;
}

export interface YouTubePlayerOptions {
	height: string;
	width: string;
	videoId?: string;
	playerVars: Record<string, string | number>;
	events: {
		onReady: () => void;
		onStateChange: (event: YouTubePlayerEvent) => void;
	};
}

declare global {
	interface Window {
		YT?: {
			Player: new (elementId: string, options: YouTubePlayerOptions) => YouTubePlayer;
		};
		onYouTubeIframeAPIReady?: () => void;
		moment: () => MomentLike;
	}
}
