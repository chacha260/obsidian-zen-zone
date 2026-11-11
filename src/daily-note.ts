import { App, Notice, TFile, normalizePath } from "obsidian";
import { t } from "./i18n";
import { now } from "./moment";
import { addTaskLine, completeTaskLine, deleteTaskLine } from "./task-lines";
import { DailyTaskAction, ZenZoneSettings } from "./types";

interface DailyNotesInternalPlugin {
	enabled: boolean;
	instance?: { options?: { template?: string } };
}

interface AppWithInternalPlugins extends App {
	internalPlugins?: { plugins: Record<string, DailyNotesInternalPlugin | undefined> };
}

/**
 * Mirrors the plugin's task list into the vault's daily note: adding a task
 * appends a checkbox under the target header, completing it stamps the time,
 * and deleting it removes the line.
 */
export class DailyNoteService {
	constructor(
		private readonly app: App,
		private readonly getSettings: () => ZenZoneSettings
	) {}

	private get settings(): ZenZoneSettings {
		return this.getSettings();
	}

	/** Path of today's daily note, honouring the configured folder and date format. */
	todayPath(): string {
		const fileName = now().format(this.settings.dailyNoteFormat || "YYYY-MM-DD");
		const folder = this.settings.dailyNoteFolder ? normalizePath(this.settings.dailyNoteFolder) : "";
		return folder ? `${folder}/${fileName}.md` : `${fileName}.md`;
	}

	async manageTask(
		taskContent: string,
		customHeader: string | undefined,
		action: DailyTaskAction,
		specificFilePath?: string
	): Promise<void> {
		if (!this.settings.autoLogToDaily) return;

		const filePath = specificFilePath ?? this.todayPath();
		const targetHeader = customHeader || this.settings.dailyNoteTargetHeader || "Todo";

		let file = this.app.vault.getAbstractFileByPath(normalizePath(filePath));
		if (!file) {
			if (action !== "add") {
				console.warn(`Zen Zone: daily note not found: ${filePath}`);
				return;
			}
			file = await this.createDailyNote(filePath, taskContent, targetHeader);
			// Without a template the note is created with the task already in it.
			if (!file) return;
		}
		if (!(file instanceof TFile)) return;
		const note = file;

		// process() does the read-modify-write in one atomic pass, so a note the
		// user is editing at the same time cannot lose the update. Notices are
		// collected rather than fired inside the mutator, which must stay pure.
		let notices: string[] = [];
		try {
			await this.app.vault.process(note, (content) => {
				// The mutator may run more than once; only the last pass counts.
				notices = [];
				return this.applyAction(action, content, taskContent, targetHeader, note.basename, notices);
			});
		} catch (error) {
			console.error("Zen Zone: failed to update the daily note", error);
			new Notice(t("daily.updateFailed"));
			return;
		}
		for (const notice of notices) new Notice(notice);
	}

	// --- Note creation ---------------------------------------------------

	/**
	 * Creates the daily note. Returns the new file when it was seeded from a
	 * template and still needs the task appended, or `null` when the note was
	 * generated with the task already included.
	 */
	private async createDailyNote(filePath: string, taskContent: string, targetHeader: string): Promise<TFile | null> {
		try {
			await this.ensureFolderExists(filePath);

			const templatePath = this.getDailyNoteTemplatePath();
			const templateContent = templatePath ? await this.getTemplateContent(templatePath) : "";

			if (!templateContent) {
				const date = now().format("YYYY-MM-DD");
				await this.app.vault.create(filePath, `# ${date}\n\n## ${targetHeader}\n- [ ] ${taskContent}\n`);
				new Notice(t("daily.created", { path: filePath }));
				return null;
			}

			const created = await this.app.vault.create(filePath, templateContent);
			new Notice(t("daily.createdFromTemplate", { path: filePath }));
			return created;
		} catch (error) {
			console.error("Zen Zone: failed to create the daily note", error);
			new Notice(t("daily.createFailed"));
			return null;
		}
	}

	private async ensureFolderExists(path: string): Promise<void> {
		const folders = path.split("/").slice(0, -1);
		let currentPath = "";
		for (const folder of folders) {
			currentPath = currentPath === "" ? folder : `${currentPath}/${folder}`;
			if (!this.app.vault.getAbstractFileByPath(currentPath)) {
				await this.app.vault.createFolder(currentPath);
			}
		}
	}

	private getDailyNoteTemplatePath(): string | null {
		try {
			const dailyNotes = (this.app as AppWithInternalPlugins).internalPlugins?.plugins["daily-notes"];
			if (dailyNotes?.enabled) return dailyNotes.instance?.options?.template ?? null;
		} catch (error) {
			console.error("Zen Zone: failed to read the daily notes template path", error);
		}
		return null;
	}

	private async getTemplateContent(templatePath: string): Promise<string> {
		const templateFile = this.app.vault.getAbstractFileByPath(normalizePath(`${templatePath}.md`));
		if (!(templateFile instanceof TFile)) return "";

		const current = now();
		return (await this.app.vault.read(templateFile))
			.replace(/{{\s*date\s*}}/gi, current.format("YYYY-MM-DD"))
			.replace(/{{\s*time\s*}}/gi, current.format("HH:mm"))
			.replace(/{{\s*title\s*}}/gi, current.format(this.settings.dailyNoteFormat || "YYYY-MM-DD"))
			.replace(/{{\s*date:([^}]+)\s*}}/gi, (_match, format: string) => current.format(format.trim()));
	}

	// --- Line editing ----------------------------------------------------

	private applyAction(
		action: DailyTaskAction,
		content: string,
		taskContent: string,
		targetHeader: string,
		noteName: string,
		notices: string[]
	): string {
		switch (action) {
			case "add": {
				const edit = addTaskLine(content, taskContent, targetHeader);
				if (edit.changed) notices.push(t("daily.added", { header: targetHeader }));
				return edit.content;
			}
			case "complete": {
				const edit = completeTaskLine(content, taskContent, now().format("HH:mm"));
				notices.push(t(edit.changed ? "daily.completed" : "daily.notFound", { note: noteName }));
				return edit.content;
			}
			case "delete": {
				const edit = deleteTaskLine(content, taskContent);
				if (edit.changed) notices.push(t("daily.deleted", { note: noteName }));
				return edit.content;
			}
		}
	}
}
