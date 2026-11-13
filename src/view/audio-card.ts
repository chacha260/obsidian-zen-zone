import { setIcon } from "obsidian";
import type ZenZonePlugin from "../main";
import type { AudioEngine, AudioListener } from "../audio/engine";
import { DomListenerRegistry } from "../dom";
import { TranslationKey, t } from "../i18n";
import { RepeatMode } from "../types";

const REPEAT_LABEL: Record<RepeatMode, TranslationKey> = {
	[RepeatMode.Off]: "audio.repeatOff",
	[RepeatMode.All]: "audio.repeatAll",
	[RepeatMode.One]: "audio.repeatOne"
};

/**
 * The audio card: track selection, quick-jump checkpoints and the transport
 * controls. It only renders the plugin's {@link AudioEngine}; closing the panel
 * drops this card and leaves the music playing.
 */
export class AudioCard implements AudioListener {
	private readonly listeners = new DomListenerRegistry();
	private readonly checkpointListeners = new DomListenerRegistry();

	private selectEl: HTMLSelectElement | null = null;
	private checkpointsEl: HTMLElement | null = null;
	private playBtnEl: HTMLButtonElement | null = null;
	private shuffleBtnEl: HTMLButtonElement | null = null;
	private repeatBtnEl: HTMLButtonElement | null = null;
	private playlistOrderEl: HTMLElement | null = null;
	private videoTitleEl: HTMLElement | null = null;
	/** Track whose checkpoints are on screen, so they are only rebuilt on a change. */
	private shownTrackIndex = -1;

	constructor(
		private readonly parent: HTMLElement,
		private readonly plugin: ZenZonePlugin
	) {}

	private get engine(): AudioEngine {
		return this.plugin.audio;
	}

	render(): void {
		const card = this.parent.createDiv({ cls: "zen-audio-card" });
		this.renderTrackSelect(card);
		this.checkpointsEl = card.createDiv({ cls: "zen-checkpoints-area" });
		const topControls = card.createDiv({ cls: "zen-audio-top-controls" });
		this.playlistOrderEl = topControls.createSpan({ cls: "zen-playlist-display" });
		this.videoTitleEl = card.createDiv({ cls: "zen-video-title" });
		this.renderTransport(card);

		this.engine.subscribe(this);
		this.onAudioChange();
	}

	private renderTrackSelect(card: HTMLElement): void {
		const wrapper = card.createDiv({ cls: "zen-input-group" });
		wrapper.createDiv({ cls: "zen-label", text: t("audio.track") });

		const selectEl = wrapper.createEl("select", { cls: "zen-select", attr: { "aria-label": t("audio.track") } });
		this.selectEl = selectEl;
		this.fillTrackOptions();

		this.listeners.add(selectEl, "change", () => this.engine.selectTrack(parseInt(selectEl.value, 10)));
	}

	/** Rebuilds the track list, for when the playlist was edited in the settings. */
	fillTrackOptions(): void {
		const selectEl = this.selectEl;
		if (!selectEl) return;
		selectEl.empty();
		this.plugin.settings.playlistData.forEach((track, index) => {
			selectEl.createEl("option", { text: track.title }).value = index.toString();
		});
		selectEl.value = this.engine.selectedIndex.toString();
		this.shownTrackIndex = -1;
		this.onAudioChange();
	}

	private renderTransport(card: HTMLElement): void {
		const row = card.createDiv({ cls: "zen-audio-controls-row" });

		this.playBtnEl = row.createEl("button", { cls: "zen-music-btn", attr: { "aria-label": t("audio.play") } });
		this.listeners.add(this.playBtnEl, "click", () => this.engine.toggle());

		this.addSmallButton(row, "skip-back", t("audio.previous"), () => this.engine.previous());
		this.addSmallButton(row, "skip-forward", t("audio.next"), () => this.engine.next());
		this.shuffleBtnEl = this.addSmallButton(row, "shuffle", t("audio.shuffle"), () => this.engine.toggleShuffle());
		this.repeatBtnEl = this.addSmallButton(row, "repeat", "", () => this.engine.cycleRepeatMode());

		const wrapper = row.createDiv({ cls: "zen-volume-wrapper" });
		setIcon(wrapper.createDiv({ cls: "zen-label" }), "volume-2");
		const slider = wrapper.createEl("input", {
			type: "range",
			cls: "zen-slider",
			attr: { min: "0", max: "1", step: "0.05", value: this.engine.volume.toString(), "aria-label": t("audio.volume") }
		});
		// Follow the drag live, but only write the settings file once it ends.
		this.listeners.add(slider, "input", () => this.engine.setVolume(parseFloat(slider.value), false));
		this.listeners.add(slider, "change", () => this.engine.setVolume(parseFloat(slider.value), true));
	}

	private addSmallButton(row: HTMLElement, icon: string, tooltip: string, onClick: () => void): HTMLButtonElement {
		const btn = row.createEl("button", { cls: "zen-music-btn-small" });
		setIcon(btn, icon);
		if (tooltip) btn.ariaLabel = tooltip;
		this.listeners.add(btn, "click", onClick);
		return btn;
	}

	private renderCheckpoints(): void {
		const container = this.checkpointsEl;
		if (!container) return;

		this.checkpointListeners.clear();
		container.empty();
		const checkpoints = this.engine.selectedTrack?.checkpoints ?? [];
		if (checkpoints.length === 0) return;

		container.createDiv({ cls: "zen-sub-label", text: t("audio.quickJump") });
		const grid = container.createDiv({ cls: "zen-chip-grid" });
		for (const checkpoint of checkpoints) {
			const chip = grid.createEl("button", { cls: "zen-chip", text: checkpoint.label });
			this.checkpointListeners.add(chip, "click", () => this.engine.jumpTo(checkpoint));
		}
	}

	// --- AudioListener ---------------------------------------------------

	onAudioChange(): void {
		const { playing, selectedIndex, shuffle, repeatMode, nowPlaying } = this.engine;

		if (this.selectEl) this.selectEl.value = selectedIndex.toString();
		if (selectedIndex !== this.shownTrackIndex) {
			this.shownTrackIndex = selectedIndex;
			this.renderCheckpoints();
		}

		if (this.playBtnEl) {
			setIcon(this.playBtnEl, playing ? "pause" : "play");
			this.playBtnEl.toggleClass("is-playing", playing);
		}
		this.shuffleBtnEl?.toggleClass("is-active", shuffle);
		if (this.repeatBtnEl) {
			setIcon(this.repeatBtnEl, repeatMode === RepeatMode.One ? "repeat-1" : "repeat");
			this.repeatBtnEl.toggleClass("is-active", repeatMode !== RepeatMode.Off);
			this.repeatBtnEl.ariaLabel = t(REPEAT_LABEL[repeatMode]);
		}

		this.playlistOrderEl?.setText(
			nowPlaying.total > 1 ? t("audio.position", { index: nowPlaying.index + 1, total: nowPlaying.total }) : ""
		);
		if (this.videoTitleEl) {
			this.videoTitleEl.setText(nowPlaying.title);
			this.videoTitleEl.toggleClass("is-visible", Boolean(nowPlaying.title));
		}
	}

	destroy(): void {
		this.engine.unsubscribe(this);
		this.listeners.clear();
		this.checkpointListeners.clear();
		this.selectEl = null;
		this.checkpointsEl = null;
		this.playBtnEl = null;
		this.shuffleBtnEl = null;
		this.repeatBtnEl = null;
		this.playlistOrderEl = null;
		this.videoTitleEl = null;
	}
}
