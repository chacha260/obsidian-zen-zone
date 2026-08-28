import { MusicReference, SoundDurationKey, SoundPathKey, ZenZoneSettings } from "./types";

export const VIEW_TYPE_ZEN = "zen-zone-view";

/** A full pomodoro run is this many focus cycles, the last one ending in a long break. */
export const CYCLE_COUNT = 4;

export type DurationKey = "work" | "shortBreak" | "longBreak";

export const TIME_CONSTRAINTS: Record<DurationKey, { min: number; max: number; default: number }> = {
	work: { min: 15, max: 60, default: 25 },
	shortBreak: { min: 3, max: 15, default: 5 },
	longBreak: { min: 15, max: 45, default: 30 }
};

/** Maps a duration slider to the settings field it writes to. */
export const DURATION_SETTING_KEY: Record<DurationKey, "workDuration" | "shortBreakDuration" | "longBreakDuration"> = {
	work: "workDuration",
	shortBreak: "shortBreakDuration",
	longBreak: "longBreakDuration"
};

/** Sound played on each phase transition, plus how long the BGM waits for it. */
export const SOUND_TRANSITIONS: ReadonlyArray<{
	name: string;
	pathKey: SoundPathKey;
	durationKey: SoundDurationKey;
}> = [
	{ name: "Start timer", pathKey: "soundStart", durationKey: "durationStart" },
	{ name: "Focus → short break", pathKey: "soundFocusToShort", durationKey: "durationFocusToShort" },
	{ name: "Short break → focus", pathKey: "soundShortToFocus", durationKey: "durationShortToFocus" },
	{ name: "Focus → long break", pathKey: "soundFocusToLong", durationKey: "durationFocusToLong" },
	{ name: "Long break → finish", pathKey: "soundLongToFinish", durationKey: "durationLongToFinish" }
];

const DEFAULT_MUSIC_REF: MusicReference = { trackIndex: 0, checkpointIndex: -1 };
const DEFAULT_BREAK_REF: MusicReference = { trackIndex: 1, checkpointIndex: -1 };

/** A fresh per-cycle music schedule; each cycle gets its own object so edits stay independent. */
export function createMusicSchedule(ref: MusicReference = DEFAULT_MUSIC_REF): MusicReference[] {
	return Array.from({ length: CYCLE_COUNT }, () => ({ ...ref }));
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
	workDuration: TIME_CONSTRAINTS.work.default,
	shortBreakDuration: TIME_CONSTRAINTS.shortBreak.default,
	longBreakDuration: TIME_CONSTRAINTS.longBreak.default,
	autoCollapseSidebars: false,
	hideHeader: false,
	autoLogToDaily: false,
	showStatusBarTimer: false,
	tasks: [],
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
