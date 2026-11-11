import { App, ButtonComponent, DropdownComponent, Notice, PluginSettingTab, Setting } from "obsidian";
import type ZenZonePlugin from "../main";
import { DURATION_SETTING_KEY, DurationKey, MAX_CYCLES, SOUND_TRANSITIONS, TIME_CONSTRAINTS } from "../constants";
import { TranslationKey, t } from "../i18n";
import { MusicReference, SoundPathKey, ZenZoneSettings } from "../types";
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

export class ZenZoneSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: ZenZonePlugin) {
		super(app, plugin);
	}

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

	private async save(): Promise<void> {
		await this.plugin.saveSettings();
		this.plugin.notifyDataChange();
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
			new Setting(containerEl)
				.setName(t(nameKey))
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

		const { cycles, workMusic, breakMusic } = this.plugin.settings;
		for (let cycle = 0; cycle < cycles; cycle++) {
			const cycleName = t("settings.music.cycle", { number: cycle + 1 });
			const breakName = t(cycle === cycles - 1 ? "settings.music.longBreak" : "settings.music.shortBreak");
			this.addMusicSetting(containerEl, `${cycleName}: ${t("settings.music.focus")}`, workMusic[cycle]);
			this.addMusicSetting(containerEl, `${cycleName}: ${breakName}`, breakMusic[cycle]);
		}
	}

	private addMusicSetting(containerEl: HTMLElement, name: string, targetRef: MusicReference): void {
		const setting = new Setting(containerEl).setName(name);
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

		const isPlayable = (source: string) => this.plugin.audio.resolveSource({ title: "", url: source }) !== null;

		this.plugin.settings.playlistData.forEach((track, index) => {
			new Setting(containerEl)
				.setName(track.title)
				.setDesc(track.url)
				.addButton((btn) =>
					btn.setIcon("pencil").setTooltip(t("settings.playlist.edit")).onClick(() => {
						new TrackEditorModal(this.app, track, isPlayable, async (updated) => {
							this.plugin.settings.playlistData[index] = updated;
							await this.save();
							this.display();
						}).open();
					})
				)
				.addButton((btn) =>
					btn
						.setIcon("trash")
						.setTooltip(t("settings.playlist.delete"))
						.setClass("zen-danger-btn")
						.onClick(async () => {
							this.plugin.settings.playlistData.splice(index, 1);
							this.plugin.repairMusicSchedules(index);
							await this.save();
							this.display();
							new Notice(t("settings.playlist.deleted"));
						})
				);
		});

		const footer = containerEl.createDiv({ cls: "zen-setting-add-container" });
		new ButtonComponent(footer)
			.setButtonText(t("settings.playlist.add"))
			.setCta()
			.onClick(() => {
				new TrackEditorModal(this.app, null, isPlayable, async (track) => {
					this.plugin.settings.playlistData.push(track);
					await this.save();
					this.display();
				}).open();
			});
	}
}
