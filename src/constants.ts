import type { TranslationKey } from "./i18n";
import { MusicReference, RepeatMode, SoundDurationKey, SoundPathKey, ZenZoneSettings } from "./types";

export const VIEW_TYPE_ZEN = "zen-zone-view";

/** Default number of focus cycles in a run; the last one ends in a long break. */
export const DEFAULT_CYCLES = 4;
export const MAX_CYCLES = 12;

/** Days of focus history kept in the settings file. */
export const HISTORY_DAYS = 90;

export const AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "ogg", "oga", "flac", "webm", "opus", "aac"];

export type DurationKey = "work" | "shortBreak" | "longBreak";

export const TIME_CONSTRAINTS: Record<DurationKey, { min: number; max: number; default: number }> = {
	work: { min: 1, max: 180, default: 25 },
	shortBreak: { min: 1, max: 60, default: 5 },
	longBreak: { min: 1, max: 120, default: 30 }
};

/** Maps a duration slider to the settings field it writes to. */
export const DURATION_SETTING_KEY: Record<DurationKey, "workDuration" | "shortBreakDuration" | "longBreakDuration"> = {
	work: "workDuration",
	shortBreak: "shortBreakDuration",
	longBreak: "longBreakDuration"
};

/** Sound played on each phase transition, plus how long the BGM waits for it. */
export const SOUND_TRANSITIONS: ReadonlyArray<{
	nameKey: TranslationKey;
	pathKey: SoundPathKey;
	durationKey: SoundDurationKey;
}> = [
	{ nameKey: "settings.sound.start", pathKey: "soundStart", durationKey: "durationStart" },
	{ nameKey: "settings.sound.focusToShort", pathKey: "soundFocusToShort", durationKey: "durationFocusToShort" },
	{ nameKey: "settings.sound.shortToFocus", pathKey: "soundShortToFocus", durationKey: "durationShortToFocus" },
	{ nameKey: "settings.sound.focusToLong", pathKey: "soundFocusToLong", durationKey: "durationFocusToLong" },
	{ nameKey: "settings.sound.longToFinish", pathKey: "soundLongToFinish", durationKey: "durationLongToFinish" }
];

const DEFAULT_MUSIC_REF: MusicReference = { trackIndex: 0, checkpointIndex: -1 };
const DEFAULT_BREAK_REF: MusicReference = { trackIndex: 1, checkpointIndex: -1 };

/** A fresh per-cycle music schedule; each cycle gets its own object so edits stay independent. */
export function createMusicSchedule(ref: MusicReference = DEFAULT_MUSIC_REF, cycles = DEFAULT_CYCLES): MusicReference[] {
	return Array.from({ length: cycles }, () => ({ ...ref }));
}

export const DEFAULT_SETTINGS: ZenZoneSettings = {
	playlistData: [
		{ title: "☕ Lofi Girl - Study", url: "https://www.youtube.com/watch?v=jfKfPfyJRdk", checkpoints: [] },
		{
			title: "🎷 Jazz - Relax",
			url: "https://www.youtube.com/watch?v=Dx5qFachd3A",
			checkpoints: [{ label: "🌅 Morning", time: "0:00" }, { label: "🌃 Night", time: "10:30" }]
		},
		{ title: "🌧 Rain Sounds", url: "https://www.youtube.com/watch?v=mPZkdNFkNps", checkpoints: [] }
	],
	cycles: DEFAULT_CYCLES,
	workDuration: TIME_CONSTRAINTS.work.default,
	shortBreakDuration: TIME_CONSTRAINTS.shortBreak.default,
	longBreakDuration: TIME_CONSTRAINTS.longBreak.default,
	autoStartBreaks: true,
	autoStartFocus: true,
	systemNotifications: true,
	autoCollapseSidebars: false,
	hideHeader: false,
	autoLogToDaily: false,
	showStatusBarTimer: false,
	audioIdleReleaseMinutes: 5,
	showVideo: true,
	volume: 0.5,
	shuffle: false,
	repeatMode: RepeatMode.Off,
	tasks: [],
	doneTasks: [],
	collapsedSections: [],
	history: {},
	logSessionsToDaily: false,
	sessionLogHeader: "Focus log",
	workMusic: createMusicSchedule(DEFAULT_MUSIC_REF),
	breakMusic: createMusicSchedule(DEFAULT_BREAK_REF),
	dailyNoteFormat: "YYYY-MM-DD",
	dailyNoteFolder: "",
	dailyNoteTargetHeader: "Todo",
	soundStart: "", durationStart: 5,
	soundFocusToShort: "", durationFocusToShort: 5,
	soundShortToFocus: "", durationShortToFocus: 5,
	soundFocusToLong: "", durationFocusToLong: 5,
	soundLongToFinish: "", durationLongToFinish: 5
};

export { DEFAULT_MUSIC_REF, DEFAULT_BREAK_REF };
