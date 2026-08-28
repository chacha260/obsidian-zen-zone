import { App, ButtonComponent, Modal, Notice, Setting, setIcon } from "obsidian";
import { PlaylistItem } from "../types";

/** Add/edit dialog for a single playlist track and its checkpoints. */
export class TrackEditorModal extends Modal {
	private readonly track: PlaylistItem;

	constructor(
		app: App,
		track: PlaylistItem | null,
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
		contentEl.createEl("h2", { text: this.track.title ? "Edit track" : "New track" });

		new Setting(contentEl)
			.setName("Title")
			.addText((text) => text.setValue(this.track.title).onChange((value) => (this.track.title = value)));

		new Setting(contentEl)
			.setName("URL")
			.addText((text) => text.setValue(this.track.url).onChange((value) => (this.track.url = value)));

		contentEl.createEl("h3", { text: "Checkpoints" });
		this.renderCheckpoints(contentEl.createDiv());

		const footer = contentEl.createDiv({ cls: "modal-button-container" });
		new ButtonComponent(footer).setButtonText("Cancel").onClick(() => this.close());
		new ButtonComponent(footer)
			.setButtonText("Save")
			.setCta()
			.onClick(() => {
				if (!this.track.title || !this.track.url) {
					new Notice("Title and URL are required.");
					return;
				}
				this.onSubmit(this.track);
				this.close();
			});
	}

	private renderCheckpoints(container: HTMLElement): void {
		container.empty();

		this.track.checkpoints?.forEach((checkpoint, index) => {
			const row = container.createDiv({ cls: "zen-setting-checkpoint-row" });

			const labelInput = row.createEl("input", { type: "text", placeholder: "Label" });
			labelInput.value = checkpoint.label;
			labelInput.addEventListener("change", () => (checkpoint.label = labelInput.value));

			const timeInput = row.createEl("input", { type: "text", placeholder: "Time" });
			timeInput.value = checkpoint.time;
			timeInput.addEventListener("change", () => (checkpoint.time = timeInput.value));

			const deleteBtn = row.createEl("button");
			setIcon(deleteBtn, "trash");
			deleteBtn.addEventListener("click", () => {
				this.track.checkpoints?.splice(index, 1);
				this.renderCheckpoints(container);
			});
		});

		new ButtonComponent(container).setButtonText("+ Add checkpoint").onClick(() => {
			this.track.checkpoints ??= [];
			this.track.checkpoints.push({ label: "", time: "" });
			this.renderCheckpoints(container);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
