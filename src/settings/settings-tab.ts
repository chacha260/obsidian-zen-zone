import {
	App,
	ButtonComponent,
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
import { MusicReference, PlaylistItem, SoundDurationKey, SoundPathKey, ZenZoneSettings } from "../types";
import { clamp } from "../utils";
import { TrackEditorModal } from "./track-editor-modal";
import { VaultPathSuggest } from "./vault-path-suggest";

const DURATION_LABEL: Record<DurationKey, TranslationKey> = {
	work: "settings.timer.work",
	shortBreak: "settings.timer.shortBreak",
	longBreak: "settings.timer.longBreak"
};

/** Upper bound of the idle-release slider, in minutes. */
const MAX_IDLE_RELEASE_MINUTES = 30;

type BooleanKey = { [K in keyof ZenZoneSettings]: ZenZoneSettings[K] extends boolean ? K : never }[keyof ZenZoneSettings];
type TextKey = "dailyNoteFolder" | "dailyNoteFormat" | "dailyNoteTargetHeader" | "sessionLogHeader";

const DURATION_KEYS = Object.keys(TIME_CONSTRAINTS) as DurationKey[];

/**
 * The settings tab, in two renditions of the same settings.
 *
 * Obsidian 1.13.0 and later render it from {@link getSettingDefinitions},
 * which also makes every setting show up in the settings search. Older
 * versions fall back to {@link display}. Rows too involved for a plain control
 * (sound cues, per-cycle music) are built by the same `configure…` method in
 * both, so the two cannot drift apart.
 */
export class ZenZoneSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: ZenZonePlugin) {
		super(app, plugin);
	}

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
		this.plugin.notifyDataChange();
	}

	// --- Declarative rendition (Obsidian 1.13.0+) ------------------------

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

	// --- Imperative rendition (before Obsidian 1.13.0) -------------------

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.addBehaviourSection(containerEl);
		this.addTimerSection(containerEl);
		this.addDailyNoteSection(containerEl);
		this.addSoundSection(containerEl);
		this.addAudioSection(containerEl);
		this.addCycleMusicSection(containerEl);
		this.addPlaylistSection(containerEl);
	}

	/** Redraws whichever rendition is on screen after the playlist changed. */
	private redraw(): void {
		// `update` only exists where the declarative rendition is in use.
		if (typeof this.update === "function") this.update();
		else this.display();
	}

	// --- Building blocks -------------------------------------------------

	private addToggle(
		containerEl: HTMLElement,
		name: TranslationKey,
		desc: TranslationKey,
		key: BooleanKey,
		after?: () => void
	): void {
		new Setting(containerEl)
			.setName(t(name))
			.setDesc(t(desc))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
					this.plugin.settings[key] = value;
					await this.save();
					after?.();
				})
			);
	}

	private addTextSetting(
		containerEl: HTMLElement,
		name: TranslationKey,
		desc: TranslationKey,
		placeholder: string,
		key: TextKey
	): void {
		new Setting(containerEl)
			.setName(t(name))
			.setDesc(t(desc))
			.addText((text) =>
				text
					.setPlaceholder(placeholder)
					.setValue(this.plugin.settings[key])
					.onChange(async (value) => {
						this.plugin.settings[key] = value.trim();
						await this.save();
					})
			);
	}

	// --- Behaviour -------------------------------------------------------

	private addBehaviourSection(containerEl: HTMLElement): void {
		this.addToggle(containerEl, "settings.collapse.name", "settings.collapse.desc", "autoCollapseSidebars");
		this.addToggle(containerEl, "settings.hideHeader.name", "settings.hideHeader.desc", "hideHeader");
		this.addToggle(containerEl, "settings.statusBar.name", "settings.statusBar.desc", "showStatusBarTimer");
		this.addToggle(containerEl, "settings.notify.name", "settings.notify.desc", "systemNotifications");
	}

	// --- Timer -----------------------------------------------------------

	private addTimerSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.timer.heading")).setHeading();

		new Setting(containerEl)
			.setName(t("settings.cycles.name"))
			.setDesc(t("settings.cycles.desc"))
			.addSlider((slider) =>
				slider
					.setLimits(1, MAX_CYCLES, 1)
					.setValue(this.plugin.settings.cycles)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.cycles = value;
						this.plugin.fitMusicSchedules();
						await this.save();
						// The music schedule below has one block per cycle.
						this.display();
					})
			);

		for (const key of Object.keys(TIME_CONSTRAINTS) as DurationKey[]) {
			this.addDurationSetting(containerEl, key);
		}

		this.addToggle(containerEl, "settings.autoBreaks.name", "settings.autoBreaks.desc", "autoStartBreaks");
		this.addToggle(containerEl, "settings.autoFocus.name", "settings.autoFocus.desc", "autoStartFocus");
	}

	private addDurationSetting(containerEl: HTMLElement, key: DurationKey): void {
		const limits = TIME_CONSTRAINTS[key];
		const settingKey = DURATION_SETTING_KEY[key];

		new Setting(containerEl)
			.setName(t(DURATION_LABEL[key]))
			.setDesc(t("settings.timer.range", limits))
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = limits.min.toString();
				text.inputEl.max = limits.max.toString();
				text.inputEl.addClass("zen-duration-input");
				text.setValue(this.plugin.settings[settingKey].toString()).onChange(async (value) => {
					const parsed = parseInt(value, 10);
					if (isNaN(parsed)) return;
					this.plugin.settings[settingKey] = clamp(parsed, limits.min, limits.max);
					await this.save();
					this.plugin.session.refreshIdleDuration();
				});
				// Show what was actually stored once the field is left.
				text.inputEl.addEventListener("blur", () => text.setValue(this.plugin.settings[settingKey].toString()));
			});
	}

	// --- Daily note ------------------------------------------------------

	private addDailyNoteSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.daily.heading")).setHeading();

		const redraw = () => this.display();
		this.addToggle(containerEl, "settings.daily.enable.name", "settings.daily.enable.desc", "autoLogToDaily", redraw);
		this.addToggle(containerEl, "settings.logSessions.name", "settings.logSessions.desc", "logSessionsToDaily", redraw);

		const { autoLogToDaily, logSessionsToDaily } = this.plugin.settings;
		if (!autoLogToDaily && !logSessionsToDaily) return;

		this.addTextSetting(containerEl, "settings.daily.folder.name", "settings.daily.folder.desc", "DailyNotes", "dailyNoteFolder");
		this.addTextSetting(containerEl, "settings.daily.format.name", "settings.daily.format.desc", "YYYY-MM-DD", "dailyNoteFormat");
		if (autoLogToDaily) {
			this.addTextSetting(containerEl, "settings.daily.header.name", "settings.daily.header.desc", "Todo", "dailyNoteTargetHeader");
		}
		if (logSessionsToDaily) {
			this.addTextSetting(containerEl, "settings.logHeader.name", "settings.logHeader.desc", "Focus log", "sessionLogHeader");
		}
	}

	// --- Transition sounds -----------------------------------------------

	private addSoundSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.sound.heading")).setDesc(t("settings.sound.desc")).setHeading();

		for (const { nameKey, pathKey, durationKey } of SOUND_TRANSITIONS) {
			this.configureSoundSetting(new Setting(containerEl), t(nameKey), pathKey, durationKey);
		}
	}

	private configureSoundSetting(setting: Setting, name: string, pathKey: SoundPathKey, durationKey: SoundDurationKey): void {
		setting
			.setName(name)
			.addText((text) => {
				const markValidity = () => this.markPathValidity(text.inputEl, this.plugin.settings[pathKey]);
				new VaultPathSuggest(this.app, text.inputEl, false);
				text.setPlaceholder(t("settings.sound.pathPlaceholder"))
					.setValue(this.plugin.settings[pathKey])
					.onChange(async (value) => {
						this.plugin.settings[pathKey] = value.trim();
						await this.save();
						markValidity();
					});
				markValidity();
			})
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "0";
				text.inputEl.addClass("zen-duration-input");
				text.setPlaceholder(t("settings.sound.secondsPlaceholder"))
					.setValue(this.plugin.settings[durationKey].toString())
					.onChange(async (value) => {
						this.plugin.settings[durationKey] = Math.max(0, parseInt(value, 10) || 0);
						await this.save();
					});
			})
			.addExtraButton((btn) =>
				btn
					.setIcon("play")
					.setTooltip(t("settings.sound.preview"))
					.onClick(() => this.previewSound(pathKey))
			);
	}

	/** Flags a path that is set but does not resolve to a file in the vault. */
	private markPathValidity(inputEl: HTMLInputElement, path: string): void {
		inputEl.toggleClass("zen-path-missing", Boolean(path) && this.plugin.resolveSoundSrc(path) === null);
	}

	private previewSound(pathKey: SoundPathKey): void {
		const path = this.plugin.settings[pathKey];
		if (!path) {
			new Notice(t("settings.sound.needPath"));
			return;
		}
		if (!this.plugin.resolveSoundSrc(path)) {
			new Notice(t("settings.sound.missing", { path }));
			return;
		}
		this.plugin.playLocalSound(path);
	}

	// --- Audio -----------------------------------------------------------

	private addAudioSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.audio.heading")).setHeading();

		this.addToggle(containerEl, "settings.video.name", "settings.video.desc", "showVideo", () =>
			this.plugin.audio.refreshVideoVisibility()
		);

		new Setting(containerEl)
			.setName(t("settings.idleRelease.name"))
			.setDesc(t("settings.idleRelease.desc"))
			.addSlider((slider) =>
				slider
					.setLimits(0, MAX_IDLE_RELEASE_MINUTES, 1)
					.setValue(clamp(this.plugin.settings.audioIdleReleaseMinutes, 0, MAX_IDLE_RELEASE_MINUTES))
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.audioIdleReleaseMinutes = value;
						await this.save();
					})
			);
	}

	// --- Per-cycle music -------------------------------------------------

	private addCycleMusicSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.music.heading")).setDesc(t("settings.music.desc")).setHeading();

		for (const { name, ref } of this.cycleMusicRows()) {
			this.configureMusicSetting(new Setting(containerEl), name, ref);
		}
	}

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
			this.plugin.settings.playlistData.forEach((track, index) => dropdown.addOption(index.toString(), track.title));
			dropdown.setValue(targetRef.trackIndex.toString()).onChange(async (value) => {
				targetRef.trackIndex = parseInt(value, 10);
				targetRef.checkpointIndex = -1;
				await this.save();
				// Only the checkpoint list depends on this; redrawing the whole
				// tab here would rebuild every option in every cycle.
				if (checkpointDropdown) this.fillCheckpointOptions(checkpointDropdown, targetRef);
			});
		});

		setting.addDropdown((dropdown) => {
			checkpointDropdown = dropdown;
			this.fillCheckpointOptions(dropdown, targetRef);
			dropdown.onChange(async (value) => {
				targetRef.checkpointIndex = parseInt(value, 10);
				await this.save();
			});
		});
	}

	private fillCheckpointOptions(dropdown: DropdownComponent, ref: MusicReference): void {
		dropdown.selectEl.empty();
		dropdown.addOption("-1", t("settings.music.fromStart"));
		const track = this.plugin.settings.playlistData[ref.trackIndex];
		track?.checkpoints?.forEach((cp, index) => dropdown.addOption(index.toString(), `${cp.label} (${cp.time})`));
		dropdown.setValue(ref.checkpointIndex.toString());
	}

	// --- Playlist --------------------------------------------------------

	private addPlaylistSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.playlist.heading")).setDesc(t("settings.playlist.desc")).setHeading();

		this.plugin.settings.playlistData.forEach((track, index) => {
			new Setting(containerEl)
				.setName(track.title)
				.setDesc(track.url)
				.addButton((btn) =>
					btn.setIcon("pencil").setTooltip(t("settings.playlist.edit")).onClick(() => this.editTrack(index))
				)
				.addButton((btn) =>
					btn
						.setIcon("trash")
						.setTooltip(t("settings.playlist.delete"))
						.setClass("zen-danger-btn")
						.onClick(() => void this.deleteTrack(index))
				);
		});

		const footer = containerEl.createDiv({ cls: "zen-setting-add-container" });
		new ButtonComponent(footer)
			.setButtonText(t("settings.playlist.add"))
			.setCta()
			.onClick(() => this.editTrack(null));
	}

	/** Opens the editor for the track at `index`, or for a new track when `index` is null. */
	private editTrack(index: number | null): void {
		const playlist = this.plugin.settings.playlistData;
		const isPlayable = (source: string) => this.plugin.audio.resolveSource({ title: "", url: source }) !== null;

		new TrackEditorModal(this.app, index === null ? null : playlist[index], isPlayable, async (track: PlaylistItem) => {
			if (index === null) playlist.push(track);
			else playlist[index] = track;
			await this.save();
			this.redraw();
		}).open();
	}

	private async deleteTrack(index: number): Promise<void> {
		this.plugin.settings.playlistData.splice(index, 1);
		this.plugin.repairMusicSchedules(index);
		await this.save();
		this.redraw();
		new Notice(t("settings.playlist.deleted"));
	}

	private async moveTrack(oldIndex: number, newIndex: number): Promise<void> {
		this.plugin.moveTrack(oldIndex, newIndex);
		await this.save();
		this.redraw();
	}
}
