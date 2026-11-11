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
	return new RegExp(`^([ \\t]*)[-*+]\\s+\\[${box}\\]\\s+${stamp}${escapeRegExp(taskContent)}\\s*$`);
}

function unchanged(content: string): LineEdit {
	return { content, changed: false };
}

/** Appends `- [ ] task` to the end of the section under `header`, creating the section if needed. */
export function addTaskLine(content: string, taskContent: string, header: string): LineEdit {
	const lines = content.split("\n");
	const open = taskLinePattern(taskContent, " ", false);
	if (lines.some((line) => open.test(line))) return unchanged(content);

	const line = `- [ ] ${taskContent}`;
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

/** Ticks the first open checkbox for the task and stamps it with `time`. */
export function completeTaskLine(content: string, taskContent: string, time: string): LineEdit {
	const lines = content.split("\n");
	const open = taskLinePattern(taskContent, " ", false);
	const index = lines.findIndex((line) => open.test(line));
	if (index < 0) return unchanged(content);

	const indent = open.exec(lines[index])?.[1] ?? "";
	const carriageReturn = lines[index].endsWith("\r") ? "\r" : "";
	lines[index] = `${indent}- [x] ${time} ${taskContent}${carriageReturn}`;
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
