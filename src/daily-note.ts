import { App, Notice, TFile, normalizePath } from "obsidian";
import { t } from "./i18n";
import { now } from "./moment";
import {
	addTaskLine,
	appendUnderHeading,
	completeTaskLine,
	deleteTaskLine,
	listOpenTasks,
	renameTaskLine,
	reopenTaskLine
} from "./task-lines";
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
 * and deleting it removes the line. Also appends the focus log and reads back
 * tasks that were written into the note by hand.
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
		specificFilePath?: string,
		tally = ""
	): Promise<void> {
		if (!this.settings.autoLogToDaily) return;

		const filePath = specificFilePath ?? this.todayPath();
		const targetHeader = customHeader || this.defaultHeader;
		const note = await this.openNote(filePath, action === "add");
		if (!note) return;

		await this.edit(note, (content, notices) => {
			switch (action) {
				case "add": {
					const edit = addTaskLine(content, taskContent, targetHeader);
					if (edit.changed) notices.push(t("daily.added", { header: targetHeader }));
					return edit.content;
				}
				case "complete": {
					const edit = completeTaskLine(content, taskContent, now().format("HH:mm"), tally ? ` ${tally}` : "");
					notices.push(t(edit.changed ? "daily.completed" : "daily.notFound", { note: note.basename }));
					return edit.content;
				}
				case "delete": {
					const edit = deleteTaskLine(content, taskContent);
					if (edit.changed) notices.push(t("daily.deleted", { note: note.basename }));
					return edit.content;
				}
				case "reopen": {
					// A line that is gone or was edited by hand is put back rather than lost.
					const edit = reopenTaskLine(content, taskContent);
					return edit.changed ? edit.content : addTaskLine(content, taskContent, targetHeader).content;
				}
			}
		});
	}

	/** Follows a renamed task into the daily note it was filed in. */
	async renameTask(oldContent: string, newContent: string, specificFilePath?: string): Promise<void> {
		if (!this.settings.autoLogToDaily || oldContent === newContent) return;
		const note = await this.openNote(specificFilePath ?? this.todayPath(), false);
		if (!note) return;
		await this.edit(note, (content) => renameTaskLine(content, oldContent, newContent).content);
	}

	/** Appends a line under `header` in today's daily note, creating the note if needed. */
	async appendLine(line: string, header: string): Promise<void> {
		const note = await this.openNote(this.todayPath(), true);
		if (!note) return;
		await this.edit(note, (content) => appendUnderHeading(content, line, header).content);
	}

	/** The open checkboxes under the default heading of today's daily note. */
	async readOpenTasks(): Promise<string[]> {
		const file = this.app.vault.getAbstractFileByPath(normalizePath(this.todayPath()));
		if (!(file instanceof TFile)) return [];
		return listOpenTasks(await this.app.vault.cachedRead(file), this.defaultHeader);
	}

	private get defaultHeader(): string {
		return this.settings.dailyNoteTargetHeader || "Todo";
	}

	// --- Note access -----------------------------------------------------

	private async openNote(filePath: string, createIfMissing: boolean): Promise<TFile | null> {
		const path = normalizePath(filePath);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) return file;
		if (file) return null;
		if (!createIfMissing) {
			console.warn(`Zen Zone: daily note not found: ${path}`);
			return null;
		}
		return this.createDailyNote(path);
	}

	/**
	 * Runs one read-modify-write over the note. `process()` does it atomically,
	 * so a note the user is editing at the same time cannot lose the update.
	 * Notices are collected rather than fired inside the mutator, which may run
	 * more than once and must stay pure.
	 */
	private async edit(note: TFile, mutate: (content: string, notices: string[]) => string): Promise<void> {
		let notices: string[] = [];
		try {
			await this.app.vault.process(note, (content) => {
				notices = [];
				return mutate(content, notices);
			});
		} catch (error) {
			console.error("Zen Zone: failed to update the daily note", error);
			new Notice(t("daily.updateFailed"));
			return;
		}
		for (const notice of notices) new Notice(notice);
	}

	/** Creates the daily note from the Daily notes template, or with just a date title. */
	private async createDailyNote(filePath: string): Promise<TFile | null> {
		try {
			await this.ensureFolderExists(filePath);

			const templatePath = this.getDailyNoteTemplatePath();
			const templateContent = templatePath ? await this.getTemplateContent(templatePath) : "";
			const created = await this.app.vault.create(
				filePath,
				templateContent || `# ${now().format("YYYY-MM-DD")}\n`
			);
			new Notice(t(templateContent ? "daily.createdFromTemplate" : "daily.created", { path: filePath }));
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
}
