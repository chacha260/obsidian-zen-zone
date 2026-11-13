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
	/** A YouTube video or playlist URL, or the vault path of an audio file or folder. */
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
	/** Focus phases finished while this task was the current one. */
	pomodoros?: number;
	/** Focus phases the task is expected to take. */
	estimate?: number;
}

/** A task that was ticked off, kept so the day's work stays visible and can be reopened. */
export interface DoneTask {
	task: ZenTask;
	/** When it was completed, in epoch milliseconds. */
	at: number;
}

/** What one day of focus added up to. */
export interface DayStats {
	sessions: number;
	minutes: number;
}

export type DailyTaskAction = "add" | "complete" | "delete" | "reopen";

export enum TimerState { Idle, Focus, ShortBreak, LongBreak }
export enum RepeatMode { Off, All, One }

/** Either a single video, a playlist, or both, extracted from a YouTube URL. */
export interface YouTubeInfo {
	videoId: string | null;
	listId: string | null;
}

export interface LocalFile {
	/** A URL the app can play, resolved from the vault path. */
	url: string;
	title: string;
}

/** Where a track's sound comes from. */
export type TrackSource =
	| ({ kind: "youtube" } & YouTubeInfo)
	| { kind: "local"; path: string; files: LocalFile[] };

/** A player for one kind of {@link TrackSource}. */
export interface AudioBackend {
	readonly kind: TrackSource["kind"];
	/** Reports the position in the playlist, its size and the current title. */
	onPlaylistInfo?: (index: number, total: number, title: string) => void;
	onReady?: () => void;
	load(source: TrackSource): void;
	getSource(): TrackSource;
	play(): void;
	pause(): void;
	/** `volume` runs from 0 to 1. */
	setVolume(volume: number): void;
	seekTo(seconds: number): void;
	setShuffle(shuffle: boolean): void;
	setRepeatMode(mode: RepeatMode): void;
	nextVideo(): void;
	previousVideo(): void;
	isPlayerReady(): boolean;
	getCurrentTime(): number;
	destroy(): void;
}

export interface ZenZoneSettings {
	playlistData: PlaylistItem[];
	/** Focus phases in one run; the last one ends in the long break. */
	cycles: number;
	workDuration: number;
	shortBreakDuration: number;
	longBreakDuration: number;
	autoStartBreaks: boolean;
	autoStartFocus: boolean;
	/** Raise a system notification on phase changes while the app is in the background. */
	systemNotifications: boolean;
	autoCollapseSidebars: boolean;
	hideHeader: boolean;
	autoLogToDaily: boolean;
	showStatusBarTimer: boolean;
	/** Minutes of silence before the YouTube player is torn down. 0 disables it. */
	audioIdleReleaseMinutes: number;
	/** Show the YouTube video in a small floating player instead of keeping it out of sight. */
	showVideo: boolean;
	/** 0 to 1. */
	volume: number;
	shuffle: boolean;
	repeatMode: RepeatMode;
	tasks: ZenTask[];
	/** Tasks completed today, newest last. Older days are dropped on load. */
	doneTasks: DoneTask[];
	/** Panel sections the user has folded away. */
	collapsedSections: string[];
	/** Focus totals per day, keyed by `YYYY-MM-DD`. */
	history: Record<string, DayStats>;
	logSessionsToDaily: boolean;
	sessionLogHeader: string;
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

// --- YouTube player -----------------------------------------------------

/** The subset of the YouTube player commands that this plugin uses. */
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
	getCurrentTime(): number;
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
		/** Fired when the playlist, the playlist position or the video metadata changes. */
		onInfoChange?: () => void;
	};
}
