import { App, ButtonComponent, Modal, Notice, Setting, setIcon } from "obsidian";
import { t } from "../i18n";
import { PlaylistItem } from "../types";
import { VaultPathSuggest } from "./vault-path-suggest";

/** Add/edit dialog for a single playlist track and its checkpoints. */
export class TrackEditorModal extends Modal {
	private readonly track: PlaylistItem;

	constructor(
		app: App,
		track: PlaylistItem | null,
		/** Whether a source resolves to something the plugin can play. */
		private readonly isPlayable: (source: string) => boolean,
		private readonly onSubmit: (track: PlaylistItem) => void
	) {
		super(app);
		// Edit a copy so cancelling leaves the stored track untouched.
		this.track = track
			? { ...track, checkpoints: track.checkpoints?.map((cp) => ({ ...cp })) ?? [] }
			: { title: "", url: "", checkpoints: [] };
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(t(this.track.title ? "modal.edit" : "modal.new"));

		new Setting(contentEl)
			.setName(t("modal.title"))
			.addText((text) => text.setValue(this.track.title).onChange((value) => (this.track.title = value)));

		new Setting(contentEl)
			.setName(t("modal.source"))
			.setDesc(t("modal.sourceDesc"))
			.addText((text) => {
				new VaultPathSuggest(this.app, text.inputEl, true);
				text.setValue(this.track.url).onChange((value) => (this.track.url = value));
			});

		new Setting(contentEl).setName(t("modal.checkpoints")).setHeading();
		this.renderCheckpoints(contentEl.createDiv());

		const footer = contentEl.createDiv({ cls: "modal-button-container" });
		new ButtonComponent(footer).setButtonText(t("modal.cancel")).onClick(() => this.close());
		new ButtonComponent(footer)
			.setButtonText(t("modal.save"))
			.setCta()
			.onClick(() => {
				this.track.title = this.track.title.trim();
				this.track.url = this.track.url.trim();
				if (!this.track.title || !this.track.url) {
					new Notice(t("modal.required"));
					return;
				}
				if (!this.isPlayable(this.track.url)) {
					new Notice(t("modal.invalidSource"));
					return;
				}
				// Half-filled checkpoint rows would only show up as dead buttons.
				this.track.checkpoints = this.track.checkpoints?.filter((cp) => cp.label.trim() && cp.time.trim());
				this.onSubmit(this.track);
				this.close();
			});
	}

	private renderCheckpoints(container: HTMLElement): void {
		container.empty();

		this.track.checkpoints?.forEach((checkpoint, index) => {
			const row = container.createDiv({ cls: "zen-setting-checkpoint-row" });

			const labelInput = row.createEl("input", { type: "text", placeholder: t("modal.label") });
			labelInput.value = checkpoint.label;
			labelInput.addEventListener("change", () => (checkpoint.label = labelInput.value));

			const timeInput = row.createEl("input", { type: "text", placeholder: t("modal.time") });
			timeInput.value = checkpoint.time;
			timeInput.addEventListener("change", () => (checkpoint.time = timeInput.value));

			const deleteBtn = row.createEl("button", { attr: { "aria-label": t("task.delete") } });
			setIcon(deleteBtn, "trash");
			deleteBtn.addEventListener("click", () => {
				this.track.checkpoints?.splice(index, 1);
				this.renderCheckpoints(container);
			});
		});

		new ButtonComponent(container).setButtonText(t("modal.addCheckpoint")).onClick(() => {
			this.track.checkpoints ??= [];
			this.track.checkpoints.push({ label: "", time: "" });
			this.renderCheckpoints(container);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
