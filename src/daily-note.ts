import { App, Notice, TFile, normalizePath } from "obsidian";
import { DailyTaskAction, ZenZoneSettings } from "./types";
import { escapeRegExp } from "./utils";

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
		const fileName = window.moment().format(this.settings.dailyNoteFormat);
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

		let file = this.app.vault.getAbstractFileByPath(filePath);
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

		const currentContent = await this.app.vault.read(file);
		const newContent = this.applyAction(action, currentContent, taskContent, targetHeader, file.basename);
		if (newContent !== currentContent) await this.app.vault.modify(file, newContent);
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
				const date = window.moment().format("YYYY-MM-DD");
				await this.app.vault.create(filePath, `# ${date}\n\n## ${targetHeader}\n- [ ] ${taskContent}\n`);
				new Notice(`Daily note created: ${filePath}`);
				return null;
			}

			const created = await this.app.vault.create(filePath, templateContent);
			new Notice(`Daily note created from template: ${filePath}`);
			return created;
		} catch (error) {
			console.error("Zen Zone: failed to create the daily note", error);
			new Notice("Failed to create the daily note.");
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

		const now = window.moment();
		return (await this.app.vault.read(templateFile))
			.replace(/{{\s*date\s*}}/gi, now.format("YYYY-MM-DD"))
			.replace(/{{\s*time\s*}}/gi, now.format("HH:mm"))
			.replace(/{{\s*title\s*}}/gi, now.format(this.settings.dailyNoteFormat))
			.replace(/{{\s*date:([^}]+)\s*}}/gi, (_match, format: string) => now.format(format.trim()));
	}

	// --- Line editing ----------------------------------------------------

	private applyAction(
		action: DailyTaskAction,
		content: string,
		taskContent: string,
		targetHeader: string,
		noteName: string
	): string {
		switch (action) {
			case "add":
				return this.addTaskLine(content, taskContent, targetHeader);
			case "complete":
				return this.completeTaskLine(content, taskContent, noteName);
			case "delete":
				return this.deleteTaskLine(content, taskContent, noteName);
		}
	}

	private addTaskLine(content: string, taskContent: string, targetHeader: string): string {
		const line = `- [ ] ${taskContent}`;
		if (content.includes(line)) return content;

		const sectionRegex = new RegExp(
			`(#{1,6}\\s+${escapeRegExp(targetHeader)}[\\s\\S]*?)(?=\\n#{1,6}\\s|$)`,
			"i"
		);

		new Notice(`Task added to ${targetHeader}`);
		if (sectionRegex.test(content)) {
			return content.replace(sectionRegex, (section) => `${section.trimEnd()}\n${line}\n`);
		}
		return `${content.trimEnd()}\n\n## ${targetHeader}\n${line}`;
	}

	private completeTaskLine(content: string, taskContent: string, noteName: string): string {
		const taskRegex = new RegExp(`^([\\s\\t]*)[-*+]\\s+\\[ \\]\\s+${escapeRegExp(taskContent)}\\s*$`, "m");
		if (!taskRegex.test(content)) {
			new Notice(`Task not found in ${noteName}.`);
			return content;
		}
		new Notice(`Task marked completed in ${noteName}`);
		return content.replace(taskRegex, `$1- [x] ${window.moment().format("HH:mm")} ${taskContent}`);
	}

	private deleteTaskLine(content: string, taskContent: string, noteName: string): string {
		const deleteRegex = new RegExp(
			`^([\\s\\t]*)[-*+]\\s+\\[.\\]\\s+.*?${escapeRegExp(taskContent)}\\s*(\\n|$)`,
			"m"
		);
		if (!deleteRegex.test(content)) return content;
		new Notice(`Task deleted from ${noteName}`);
		return content.replace(deleteRegex, "");
	}
}
