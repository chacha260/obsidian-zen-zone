import { escapeRegExp } from "./utils";

/**
 * Pure edits on the markdown of a daily note. Kept free of Obsidian APIs so the
 * matching rules can be unit-tested.
 *
 * A task is always matched as a whole line, never as a substring, so editing
 * "mail" can never touch "send mail".
 */

export interface LineEdit {
	content: string;
	changed: boolean;
}

const HEADING = /^#{1,6}\s/;

function taskLinePattern(taskContent: string, box: string, allowTimestamp: boolean): RegExp {
	const stamp = allowTimestamp ? "(?:\\d{1,2}:\\d{2}\\s+)?" : "";
	// A completed line may carry a pomodoro count after the text.
	const tally = allowTimestamp ? "(?:\\s+🍅\\d+(?:/\\d+)?)?" : "";
	return new RegExp(`^([ \\t]*)[-*+]\\s+\\[${box}\\]\\s+${stamp}${escapeRegExp(taskContent)}${tally}\\s*$`, "u");
}

function unchanged(content: string): LineEdit {
	return { content, changed: false };
}

/** Appends `- [ ] task` to the end of the section under `header`, creating the section if needed. */
export function addTaskLine(content: string, taskContent: string, header: string): LineEdit {
	const open = taskLinePattern(taskContent, " ", false);
	if (content.split("\n").some((line) => open.test(line))) return unchanged(content);
	return appendUnderHeading(content, `- [ ] ${taskContent}`, header);
}

function findSection(lines: string[], header: string): { start: number; end: number } | null {
	const headerPattern = new RegExp(`^#{1,6}\\s+${escapeRegExp(header)}\\s*$`, "i");
	const start = lines.findIndex((candidate) => headerPattern.test(candidate));
	if (start < 0) return null;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (HEADING.test(lines[i])) {
			end = i;
			break;
		}
	}
	return { start, end };
}

/** Appends `line` to the end of the section under `header`, creating the section if needed. */
export function appendUnderHeading(content: string, line: string, header: string): LineEdit {
	const lines = content.split("\n");
	const headerPattern = new RegExp(`^#{1,6}\\s+${escapeRegExp(header)}\\s*$`, "i");
	const headerIndex = lines.findIndex((candidate) => headerPattern.test(candidate));

	if (headerIndex < 0) {
		const body = content.trimEnd();
		return { content: `${body}${body ? "\n\n" : ""}## ${header}\n${line}\n`, changed: true };
	}

	let sectionEnd = lines.length;
	for (let i = headerIndex + 1; i < lines.length; i++) {
		if (HEADING.test(lines[i])) {
			sectionEnd = i;
			break;
		}
	}

	// Insert after the last line of the section that actually has text.
	let insertAt = sectionEnd;
	while (insertAt > headerIndex + 1 && lines[insertAt - 1].trim() === "") insertAt--;

	lines.splice(insertAt, 0, line);
	// Keep the file newline-terminated when the task became its last line.
	if (insertAt === lines.length - 1) lines.push("");
	return { content: lines.join("\n"), changed: true };
}

/** The text of every open checkbox in the section under `header`, in order. */
export function listOpenTasks(content: string, header: string): string[] {
	const lines = content.split("\n");
	const section = findSection(lines, header);
	if (!section) return [];
	const open = /^[ \t]*[-*+]\s+\[ \]\s+(.+?)\s*$/;
	return lines
		.slice(section.start + 1, section.end)
		.map((line) => open.exec(line)?.[1])
		.filter((text): text is string => Boolean(text));
}

/** Ticks the first open checkbox for the task and stamps it with `time`, plus an optional `suffix`. */
export function completeTaskLine(content: string, taskContent: string, time: string, suffix = ""): LineEdit {
	const lines = content.split("\n");
	const open = taskLinePattern(taskContent, " ", false);
	const index = lines.findIndex((line) => open.test(line));
	if (index < 0) return unchanged(content);

	const indent = open.exec(lines[index])?.[1] ?? "";
	const carriageReturn = lines[index].endsWith("\r") ? "\r" : "";
	lines[index] = `${indent}- [x] ${time} ${taskContent}${suffix}${carriageReturn}`;
	return { content: lines.join("\n"), changed: true };
}

/** Turns a completed, stamped line back into an open checkbox. */
export function reopenTaskLine(content: string, taskContent: string): LineEdit {
	const lines = content.split("\n");
	const done = taskLinePattern(taskContent, "[xX]", true);
	const index = lines.findIndex((line) => done.test(line));
	if (index < 0) return unchanged(content);

	const indent = done.exec(lines[index])?.[1] ?? "";
	const carriageReturn = lines[index].endsWith("\r") ? "\r" : "";
	lines[index] = `${indent}- [ ] ${taskContent}${carriageReturn}`;
	return { content: lines.join("\n"), changed: true };
}

/** Rewrites the text of an open task, keeping its place and indentation. */
export function renameTaskLine(content: string, oldContent: string, newContent: string): LineEdit {
	const lines = content.split("\n");
	const open = taskLinePattern(oldContent, " ", false);
	const index = lines.findIndex((line) => open.test(line));
	if (index < 0) return unchanged(content);

	const indent = open.exec(lines[index])?.[1] ?? "";
	const carriageReturn = lines[index].endsWith("\r") ? "\r" : "";
	lines[index] = `${indent}- [ ] ${newContent}${carriageReturn}`;
	return { content: lines.join("\n"), changed: true };
}

/** Marks an open task as moved on to a later note (`- [>] task`), the bullet-journal way. */
export function forwardTaskLine(content: string, taskContent: string): LineEdit {
	const lines = content.split("\n");
	const open = taskLinePattern(taskContent, " ", false);
	const index = lines.findIndex((line) => open.test(line));
	if (index < 0) return unchanged(content);

	const indent = open.exec(lines[index])?.[1] ?? "";
	const carriageReturn = lines[index].endsWith("\r") ? "\r" : "";
	lines[index] = `${indent}- [>] ${taskContent}${carriageReturn}`;
	return { content: lines.join("\n"), changed: true };
}

/** Removes the task's line, whether it is still open or already completed and stamped. */
export function deleteTaskLine(content: string, taskContent: string): LineEdit {
	const lines = content.split("\n");
	const any = taskLinePattern(taskContent, ".", true);
	const index = lines.findIndex((line) => any.test(line));
	if (index < 0) return unchanged(content);

	lines.splice(index, 1);
	return { content: lines.join("\n"), changed: true };
}
