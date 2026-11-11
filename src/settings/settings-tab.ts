import {
	App,
	DropdownComponent,
	Notice,
	PluginSettingTab,
	Setting,
	SettingDefinition,
	SettingDefinitionItem,
	TFile
} from "obsidian";
import type ZenZonePlugin from "../main";
import {
	AUDIO_EXTENSIONS,
	DURATION_SETTING_KEY,
	DurationKey,
	MAX_CYCLES,
	SOUND_TRANSITIONS,
	TIME_CONSTRAINTS
} from "../constants";
import { TranslationKey, t } from "../i18n";
import { MusicReference, PlaylistItem, ZenZoneSettings } from "../types";
import { clamp } from "../utils";
import { TrackEditorModal } from "./track-editor-modal";

const DURATION_LABEL: Record<DurationKey, TranslationKey> = {
	work: "settings.timer.work",
	shortBreak: "settings.timer.shortBreak",
	longBreak: "settings.timer.longBreak"
};

/** Upper bound of the idle-release slider, in minutes. */
const MAX_IDLE_RELEASE_MINUTES = 30;

type BooleanKey = { [K in keyof ZenZoneSettings]: ZenZoneSettings[K] extends boolean ? K : never }[keyof ZenZoneSettings];

const DURATION_KEYS = Object.keys(TIME_CONSTRAINTS) as DurationKey[];

/**
 * The settings tab, described declaratively so every setting shows up in
 * Obsidian's settings search. Plain values are `control` definitions; the
 * per-cycle music rows, whose two dropdowns depend on each other, are rendered
 * by hand.
 */
export class ZenZoneSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: ZenZonePlugin) {
		super(app, plugin);
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
		this.plugin.notifyDataChange();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const settings = this.plugin.settings;
		const logsToDaily = () => settings.autoLogToDaily || settings.logSessionsToDaily;

		const toggle = (name: TranslationKey, desc: TranslationKey, key: BooleanKey): SettingDefinition => ({
			name: t(name),
			desc: t(desc),
			control: { type: "toggle", key }
		});

		return [
			toggle("settings.collapse.name", "settings.collapse.desc", "autoCollapseSidebars"),
			toggle("settings.hideHeader.name", "settings.hideHeader.desc", "hideHeader"),
			toggle("settings.statusBar.name", "settings.statusBar.desc", "showStatusBarTimer"),
			toggle("settings.notify.name", "settings.notify.desc", "systemNotifications"),
			{
				type: "group",
				heading: t("settings.timer.heading"),
				items: [
					{
						name: t("settings.cycles.name"),
						desc: t("settings.cycles.desc"),
						control: { type: "slider", key: "cycles", min: 1, max: MAX_CYCLES, step: 1 }
					},
					...DURATION_KEYS.map((key): SettingDefinition => {
						const limits = TIME_CONSTRAINTS[key];
						return {
							name: t(DURATION_LABEL[key]),
							desc: t("settings.timer.range", limits),
							control: {
								type: "number",
								key: DURATION_SETTING_KEY[key],
								min: limits.min,
								max: limits.max,
								step: 1,
								defaultValue: limits.default
							}
						};
					}),
					toggle("settings.autoBreaks.name", "settings.autoBreaks.desc", "autoStartBreaks"),
					toggle("settings.autoFocus.name", "settings.autoFocus.desc", "autoStartFocus")
				]
			},
			{
				type: "group",
				heading: t("settings.daily.heading"),
				items: [
					toggle("settings.daily.enable.name", "settings.daily.enable.desc", "autoLogToDaily"),
					toggle("settings.logSessions.name", "settings.logSessions.desc", "logSessionsToDaily"),
					{
						name: t("settings.daily.folder.name"),
						desc: t("settings.daily.folder.desc"),
						visible: logsToDaily,
						control: { type: "folder", key: "dailyNoteFolder", placeholder: "DailyNotes" }
					},
					{
						name: t("settings.daily.format.name"),
						desc: t("settings.daily.format.desc"),
						visible: logsToDaily,
						control: { type: "text", key: "dailyNoteFormat", placeholder: "YYYY-MM-DD" }
					},
					{
						name: t("settings.daily.header.name"),
						desc: t("settings.daily.header.desc"),
						visible: () => settings.autoLogToDaily,
						control: { type: "text", key: "dailyNoteTargetHeader", placeholder: "Todo" }
					},
					{
						name: t("settings.logHeader.name"),
						desc: t("settings.logHeader.desc"),
						visible: () => settings.logSessionsToDaily,
						control: { type: "text", key: "sessionLogHeader", placeholder: "Focus log" }
					}
				]
			},
			{
				type: "group",
				heading: t("settings.sound.heading"),
				items: SOUND_TRANSITIONS.flatMap(({ nameKey, pathKey, durationKey }): SettingDefinition[] => [
					{
						name: t(nameKey),
						desc: t("settings.sound.fileDesc"),
						control: {
							type: "file",
							key: pathKey,
							placeholder: t("settings.sound.pathPlaceholder"),
							filter: (file: TFile) => AUDIO_EXTENSIONS.includes(file.extension.toLowerCase())
						}
					},
					{
						name: t("settings.sound.wait", { name: t(nameKey) }),
						desc: t("settings.sound.waitDesc"),
						control: { type: "number", key: durationKey, min: 0, step: 1, defaultValue: 0 }
					}
				])
			},
			{
				type: "group",
				heading: t("settings.audio.heading"),
				items: [
					toggle("settings.video.name", "settings.video.desc", "showVideo"),
					{
						name: t("settings.idleRelease.name"),
						desc: t("settings.idleRelease.desc"),
						control: {
							type: "slider",
							key: "audioIdleReleaseMinutes",
							min: 0,
							max: MAX_IDLE_RELEASE_MINUTES,
							step: 1
						}
					}
				]
			},
			{
				type: "group",
				heading: t("settings.music.heading"),
				items: this.cycleMusicRows().map(
					({ name, ref }): SettingDefinition => ({
						name,
						render: (setting) => this.configureMusicSetting(setting, name, ref)
					})
				)
			},
			{
				type: "list",
				heading: t("settings.playlist.heading"),
				emptyState: t("settings.playlist.desc"),
				items: settings.playlistData.map(
					(track, index): SettingDefinition => ({
						name: track.title,
						desc: track.url,
						action: () => this.editTrack(index)
					})
				),
				onDelete: (index) => void this.deleteTrack(index),
				onReorder: (oldIndex, newIndex) => void this.moveTrack(oldIndex, newIndex),
				addItem: { name: t("settings.playlist.add"), action: () => this.editTrack(null) }
			}
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof ZenZoneSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		const durationKey = DURATION_KEYS.find((candidate) => DURATION_SETTING_KEY[candidate] === key);

		if (durationKey) {
			const limits = TIME_CONSTRAINTS[durationKey];
			settings[key] = clamp(Math.round(Number(value)) || limits.default, limits.min, limits.max);
		} else if (key === "cycles") {
			settings[key] = clamp(Math.round(Number(value)) || 1, 1, MAX_CYCLES);
		} else if (typeof value === "number") {
			settings[key] = Math.max(0, Math.round(value) || 0);
		} else if (typeof value === "string") {
			settings[key] = value.trim();
		} else {
			settings[key] = value;
		}

		if (key === "cycles") this.plugin.fitMusicSchedules();
		await this.save();

		if (durationKey) this.plugin.session.refreshIdleDuration();
		if (key === "showVideo") this.plugin.audio.refreshVideoVisibility();
		// One music row per cycle: the structure itself changes with the count.
		if (key === "cycles") this.update();
		else this.refreshDomState();
	}

	// --- Per-cycle music -------------------------------------------------

	/** One focus row and one break row per cycle, in order. */
	private cycleMusicRows(): Array<{ name: string; ref: MusicReference }> {
		const { cycles, workMusic, breakMusic } = this.plugin.settings;
		const rows: Array<{ name: string; ref: MusicReference }> = [];
		for (let cycle = 0; cycle < cycles; cycle++) {
			const cycleName = t("settings.music.cycle", { number: cycle + 1 });
			const breakName = t(cycle === cycles - 1 ? "settings.music.longBreak" : "settings.music.shortBreak");
			rows.push({ name: `${cycleName}: ${t("settings.music.focus")}`, ref: workMusic[cycle] });
			rows.push({ name: `${cycleName}: ${breakName}`, ref: breakMusic[cycle] });
		}
		return rows;
	}

	private configureMusicSetting(setting: Setting, name: string, targetRef: MusicReference): void {
		setting.setName(name);
		let checkpointDropdown: DropdownComponent | null = null;

		setting.addDropdown((dropdown) => {
			this.plugin.settings.playlistData.forEach((track, index) => {
				dropdown.addOption(index.toString(), track.title);
			});
			dropdown.setValue(targetRef.trackIndex.toString()).onChange((value) => {
				targetRef.trackIndex = parseInt(value, 10);
				targetRef.checkpointIndex = -1;
				// Only the checkpoint list depends on this; redrawing the whole
				// tab here would rebuild every option in every cycle.
				if (checkpointDropdown) this.fillCheckpointOptions(checkpointDropdown, targetRef);
				void this.save();
			});
		});

		setting.addDropdown((dropdown) => {
			checkpointDropdown = dropdown;
			this.fillCheckpointOptions(dropdown, targetRef);
			dropdown.onChange((value) => {
				targetRef.checkpointIndex = parseInt(value, 10);
				void this.save();
			});
		});
	}

	private fillCheckpointOptions(dropdown: DropdownComponent, ref: MusicReference): void {
		dropdown.selectEl.empty();
		dropdown.addOption("-1", t("settings.music.fromStart"));
		const track = this.plugin.settings.playlistData[ref.trackIndex];
		track?.checkpoints?.forEach((cp, index) => {
			dropdown.addOption(index.toString(), `${cp.label} (${cp.time})`);
		});
		dropdown.setValue(ref.checkpointIndex.toString());
	}

	// --- Playlist --------------------------------------------------------

	/** Opens the editor for the track at `index`, or for a new track when `index` is null. */
	private editTrack(index: number | null): void {
		const playlist = this.plugin.settings.playlistData;
		const isPlayable = (source: string) => this.plugin.audio.resolveSource({ title: "", url: source }) !== null;

		new TrackEditorModal(this.app, index === null ? null : playlist[index], isPlayable, async (track: PlaylistItem) => {
			if (index === null) playlist.push(track);
			else playlist[index] = track;
			await this.save();
			this.update();
		}).open();
	}

	private async deleteTrack(index: number): Promise<void> {
		this.plugin.settings.playlistData.splice(index, 1);
		this.plugin.repairMusicSchedules(index);
		await this.save();
		this.update();
		new Notice(t("settings.playlist.deleted"));
	}

	private async moveTrack(oldIndex: number, newIndex: number): Promise<void> {
		this.plugin.moveTrack(oldIndex, newIndex);
		await this.save();
		this.update();
	}
}
