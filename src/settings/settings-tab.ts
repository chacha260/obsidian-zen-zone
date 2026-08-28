import { App, ButtonComponent, Notice, PluginSettingTab, Setting } from "obsidian";
import type ZenZonePlugin from "../main";
import {
	CYCLE_COUNT,
	DURATION_SETTING_KEY,
	DurationKey,
	SOUND_TRANSITIONS,
	TIME_CONSTRAINTS
} from "../constants";
import { MusicReference } from "../types";
import { clamp } from "../utils";
import { TrackEditorModal } from "./track-editor-modal";

const DURATION_LABEL: Record<DurationKey, string> = {
	work: "作業時間 (Focus)",
	shortBreak: "小休憩 (Short Break)",
	longBreak: "大休憩 (Long Break)"
};

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
		new Setting(containerEl).setName("⚙️ General").setHeading();

		this.addToggle(containerEl, "Auto-collapse sidebars", "作業開始時にサイドバー(左右)を自動で閉じる", "autoCollapseSidebars");
		this.addToggle(containerEl, "Hide header & UI elements", "作業開始時に上部のヘッダーやリボン等を非表示にする", "hideHeader");
		this.addToggle(containerEl, "Show timer in status bar", "ステータスバーに残り時間を表示する", "showStatusBarTimer");
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
		new Setting(containerEl).setName("📝 Daily note logging").setHeading();

		this.addToggle(
			containerEl,
			"Enable auto-log",
			"タスク作成時にDaily Noteへ追記し、完了時に時間を記録する",
			"autoLogToDaily",
			true
		);

		if (!this.plugin.settings.autoLogToDaily) return;

		this.addTextSetting(containerEl, "Daily note folder", "Daily Noteの保存フォルダ (例: DailyNotes)。空欄はルート。", "DailyNotes", "dailyNoteFolder");
		this.addTextSetting(containerEl, "Date format", "ファイル名の日付形式 (例: YYYY-MM-DD)", "YYYY-MM-DD", "dailyNoteFormat");
		this.addTextSetting(containerEl, "Default target header", "タスクを追加するデフォルトの見出し名", "Todo", "dailyNoteTargetHeader");
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
						this.plugin.settings[key] = value;
						await this.plugin.saveSettings();
					})
			);
	}

	// --- Timer -----------------------------------------------------------

	private addTimerSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("⏱ Timer configuration").setHeading();

		for (const key of Object.keys(TIME_CONSTRAINTS) as DurationKey[]) {
			this.addDurationSetting(containerEl, key);
		}

		const footer = containerEl.createDiv({ cls: "zen-setting-apply-container" });
		new ButtonComponent(footer)
			.setButtonText("設定を保存・反映")
			.setCta()
			.onClick(() => void this.saveDurations());
	}

	private addDurationSetting(containerEl: HTMLElement, key: DurationKey): void {
		const limits = TIME_CONSTRAINTS[key];
		const setting = new Setting(containerEl)
			.setName(DURATION_LABEL[key])
			.setDesc(`基本: ${limits.default}分 | 範囲: ${limits.min} - ${limits.max}分`);

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
		this.display();
		new Notice("Time settings saved!");
	}

	// --- Transition sounds -----------------------------------------------

	private addSoundSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("🔊 Sound effects").setHeading();
		containerEl.createDiv({
			cls: "setting-item-description",
			text: "Vault内の音声ファイルのパス(例: Assets/start.m4a)と、BGMを待機させる時間(秒)を指定してください。"
		});

		for (const { name, pathKey, durationKey } of SOUND_TRANSITIONS) {
			new Setting(containerEl)
				.setName(name)
				.addText((text) =>
					text
						.setPlaceholder("File path")
						.setValue(this.plugin.settings[pathKey])
						.onChange(async (value) => {
							this.plugin.settings[pathKey] = value;
							await this.plugin.saveSettings();
						})
				)
				.addText((text) => {
					text.inputEl.type = "number";
					text.inputEl.addClass("zen-duration-input");
					text.setPlaceholder("Sec")
						.setValue(this.plugin.settings[durationKey].toString())
						.onChange(async (value) => {
							this.plugin.settings[durationKey] = parseInt(value, 10) || 0;
							await this.plugin.saveSettings();
						});
				});
		}
	}

	// --- Per-cycle music -------------------------------------------------

	private addCycleMusicSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("🎵 Cycle music schedule").setHeading();
		containerEl.createDiv({
			cls: "setting-item-description",
			text: `Configure different music for each of the ${CYCLE_COUNT} cycles.`
		});

		for (let cycle = 0; cycle < CYCLE_COUNT; cycle++) {
			const isLast = cycle === CYCLE_COUNT - 1;
			new Setting(containerEl).setName(`Cycle ${cycle + 1}`).setHeading();
			this.addMusicSetting(containerEl, "Focus music", this.plugin.settings.workMusic[cycle]);
			this.addMusicSetting(containerEl, `Break music (${isLast ? "long" : "short"})`, this.plugin.settings.breakMusic[cycle]);
		}
	}

	private addMusicSetting(containerEl: HTMLElement, name: string, targetRef: MusicReference): void {
		const setting = new Setting(containerEl).setName(name);

		setting.addDropdown((dropdown) => {
			this.plugin.settings.playlistData.forEach((track, index) => dropdown.addOption(index.toString(), track.title));
			dropdown.setValue(targetRef.trackIndex.toString()).onChange(async (value) => {
				targetRef.trackIndex = parseInt(value, 10);
				targetRef.checkpointIndex = -1;
				await this.plugin.saveSettings();
				// The checkpoint dropdown below depends on the selected track.
				this.display();
			});
		});

		setting.addDropdown((dropdown) => {
			dropdown.addOption("-1", "Start");
			const track = this.plugin.settings.playlistData[targetRef.trackIndex];
			track?.checkpoints?.forEach((cp, index) => dropdown.addOption(index.toString(), `${cp.label} (${cp.time})`));
			dropdown.setValue(targetRef.checkpointIndex.toString()).onChange(async (value) => {
				targetRef.checkpointIndex = parseInt(value, 10);
				await this.plugin.saveSettings();
			});
		});
	}

	// --- Playlist --------------------------------------------------------

	private addPlaylistSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Playlist manager").setHeading();

		this.plugin.settings.playlistData.forEach((track, index) => {
			new Setting(containerEl)
				.setName(track.title)
				.setDesc(track.url)
				.addButton((btn) =>
					btn.setIcon("pencil").onClick(() => {
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
						.setClass("zen-danger-btn")
						.onClick(async () => {
							this.plugin.settings.playlistData.splice(index, 1);
							await this.plugin.saveSettings();
							this.display();
							new Notice("Track deleted.");
						})
				);
		});

		const footer = containerEl.createDiv({ cls: "zen-setting-add-container" });
		new ButtonComponent(footer)
			.setButtonText("Add new track")
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

