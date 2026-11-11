import { App, ButtonComponent, DropdownComponent, Notice, PluginSettingTab, Setting } from "obsidian";
import type ZenZonePlugin from "../main";
import {
	CYCLE_COUNT,
	DURATION_SETTING_KEY,
	DurationKey,
	SOUND_TRANSITIONS,
	TIME_CONSTRAINTS
} from "../constants";
import { TranslationKey, t } from "../i18n";
import { MusicReference, SoundPathKey } from "../types";
import { clamp } from "../utils";
import { TrackEditorModal } from "./track-editor-modal";

const DURATION_LABEL: Record<DurationKey, TranslationKey> = {
	work: "settings.timer.work",
	shortBreak: "settings.timer.shortBreak",
	longBreak: "settings.timer.longBreak"
};

/** Upper bound of the idle-release slider, in minutes. */
const MAX_IDLE_RELEASE_MINUTES = 30;

export class ZenZoneSettingTab extends PluginSettingTab {
	/** Durations are staged here so the sliders only apply on "save". */
	private draftDurations!: Record<DurationKey, number>;

	constructor(app: App, private readonly plugin: ZenZonePlugin) {
		super(app, plugin);
		this.resetDraftDurations();
	}

	private resetDraftDurations(): void {
		this.draftDurations = {
			work: this.plugin.settings.workDuration,
			shortBreak: this.plugin.settings.shortBreakDuration,
			longBreak: this.plugin.settings.longBreakDuration
		};
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.addGeneralSection(containerEl);
		this.addDailyNoteSection(containerEl);
		this.addTimerSection(containerEl);
		this.addSoundSection(containerEl);
		this.addCycleMusicSection(containerEl);
		this.addPlaylistSection(containerEl);
	}

	// --- General ---------------------------------------------------------

	private addGeneralSection(containerEl: HTMLElement): void {
		this.addToggle(containerEl, t("settings.collapse.name"), t("settings.collapse.desc"), "autoCollapseSidebars");
		this.addToggle(containerEl, t("settings.hideHeader.name"), t("settings.hideHeader.desc"), "hideHeader");
		this.addToggle(containerEl, t("settings.statusBar.name"), t("settings.statusBar.desc"), "showStatusBarTimer");

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
						await this.plugin.saveSettings();
					})
			);
	}

	private addToggle(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		key: "autoCollapseSidebars" | "hideHeader" | "showStatusBarTimer" | "autoLogToDaily",
		redraw = false
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
					this.plugin.settings[key] = value;
					await this.plugin.saveSettings();
					if (redraw) this.display();
				})
			);
	}

	// --- Daily note ------------------------------------------------------

	private addDailyNoteSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.daily.heading")).setHeading();

		this.addToggle(
			containerEl,
			t("settings.daily.enable.name"),
			t("settings.daily.enable.desc"),
			"autoLogToDaily",
			true
		);

		if (!this.plugin.settings.autoLogToDaily) return;

		this.addTextSetting(containerEl, t("settings.daily.folder.name"), t("settings.daily.folder.desc"), "DailyNotes", "dailyNoteFolder");
		this.addTextSetting(containerEl, t("settings.daily.format.name"), t("settings.daily.format.desc"), "YYYY-MM-DD", "dailyNoteFormat");
		this.addTextSetting(containerEl, t("settings.daily.header.name"), t("settings.daily.header.desc"), "Todo", "dailyNoteTargetHeader");
	}

	private addTextSetting(
		containerEl: HTMLElement,
		name: string,
		desc: string,
		placeholder: string,
		key: "dailyNoteFolder" | "dailyNoteFormat" | "dailyNoteTargetHeader"
	): void {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) =>
				text
					.setPlaceholder(placeholder)
					.setValue(this.plugin.settings[key])
					.onChange(async (value) => {
						this.plugin.settings[key] = value.trim();
						await this.plugin.saveSettings();
					})
			);
	}

	// --- Timer -----------------------------------------------------------

	private addTimerSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.timer.heading")).setHeading();

		for (const key of Object.keys(TIME_CONSTRAINTS) as DurationKey[]) {
			this.addDurationSetting(containerEl, key);
		}

		const footer = containerEl.createDiv({ cls: "zen-setting-apply-container" });
		new ButtonComponent(footer)
			.setButtonText(t("settings.timer.apply"))
			.setCta()
			.onClick(() => void this.saveDurations());
	}

	private addDurationSetting(containerEl: HTMLElement, key: DurationKey): void {
		const limits = TIME_CONSTRAINTS[key];
		const setting = new Setting(containerEl)
			.setName(t(DURATION_LABEL[key]))
			.setDesc(t("settings.timer.range", limits));

		let numberInput: HTMLInputElement | null = null;
		let sliderInput: HTMLInputElement | null = null;

		setting.addSlider((slider) => {
			sliderInput = slider.sliderEl;
			slider
				.setLimits(limits.min, limits.max, 1)
				.setValue(this.draftDurations[key])
				.setDynamicTooltip()
				.onChange((value) => {
					this.draftDurations[key] = value;
					if (numberInput) numberInput.value = value.toString();
				});
		});

		setting.addText((text) => {
			numberInput = text.inputEl;
			text.inputEl.type = "number";
			text.inputEl.addClass("zen-duration-input");
			text.setValue(this.draftDurations[key].toString()).onChange((value) => {
				const parsed = parseInt(value, 10);
				if (isNaN(parsed)) return;
				this.draftDurations[key] = parsed;
				if (sliderInput) sliderInput.value = parsed.toString();
			});
		});
	}

	private async saveDurations(): Promise<void> {
		for (const key of Object.keys(TIME_CONSTRAINTS) as DurationKey[]) {
			const limits = TIME_CONSTRAINTS[key];
			this.plugin.settings[DURATION_SETTING_KEY[key]] = clamp(this.draftDurations[key], limits.min, limits.max);
		}
		await this.plugin.saveSettings();
		this.resetDraftDurations();
		this.plugin.session.refreshIdleDuration();
		this.display();
		new Notice(t("settings.timer.saved"));
	}

	// --- Transition sounds -----------------------------------------------

	private addSoundSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.sound.heading")).setHeading();
		containerEl.createDiv({
			cls: "setting-item-description",
			text: t("settings.sound.desc")
		});

		for (const { nameKey, pathKey, durationKey } of SOUND_TRANSITIONS) {
			new Setting(containerEl)
				.setName(t(nameKey))
				.addText((text) => {
					const markValidity = () => this.markPathValidity(text.inputEl, this.plugin.settings[pathKey]);
					text.setPlaceholder(t("settings.sound.pathPlaceholder"))
						.setValue(this.plugin.settings[pathKey])
						.onChange(async (value) => {
							this.plugin.settings[pathKey] = value.trim();
							await this.plugin.saveSettings();
							markValidity();
						});
					markValidity();
				})
				.addText((text) => {
					text.inputEl.type = "number";
					text.inputEl.addClass("zen-duration-input");
					text.setPlaceholder(t("settings.sound.secondsPlaceholder"))
						.setValue(this.plugin.settings[durationKey].toString())
						.onChange(async (value) => {
							this.plugin.settings[durationKey] = Math.max(0, parseInt(value, 10) || 0);
							await this.plugin.saveSettings();
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

	// --- Per-cycle music -------------------------------------------------

	private addCycleMusicSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t("settings.music.heading")).setHeading();
		containerEl.createDiv({
			cls: "setting-item-description",
			text: t("settings.music.desc", { count: CYCLE_COUNT })
		});

		for (let cycle = 0; cycle < CYCLE_COUNT; cycle++) {
			const isLast = cycle === CYCLE_COUNT - 1;
			const cycleName = t("settings.music.cycle", { number: cycle + 1 });
			const breakName = t(isLast ? "settings.music.longBreak" : "settings.music.shortBreak");
			this.addMusicSetting(containerEl, `${cycleName}: ${t("settings.music.focus")}`, this.plugin.settings.workMusic[cycle]);
			this.addMusicSetting(containerEl, `${cycleName}: ${breakName}`, this.plugin.settings.breakMusic[cycle]);
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
				await this.plugin.saveSettings();
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
				await this.plugin.saveSettings();
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
					btn.setIcon("pencil").setTooltip(t("settings.playlist.edit")).onClick(() => {
						new TrackEditorModal(this.app, track, async (updated) => {
							this.plugin.settings.playlistData[index] = updated;
							await this.plugin.saveSettings();
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
							await this.plugin.saveSettings();
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
				new TrackEditorModal(this.app, null, async (track) => {
					this.plugin.settings.playlistData.push(track);
					await this.plugin.saveSettings();
					this.display();
				}).open();
			});
	}
}
