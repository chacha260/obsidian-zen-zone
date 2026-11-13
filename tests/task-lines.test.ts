import assert from "node:assert/strict";
import { test } from "node:test";
import {
	addTaskLine,
	appendUnderHeading,
	completeTaskLine,
	deleteTaskLine,
	forwardTaskLine,
	listOpenTasks,
	renameTaskLine,
	reopenTaskLine
} from "../src/task-lines";

void test("add: appends to the end of the target section", () => {
	const note = "# Day\n\n## Todo\n- [ ] a\n\n## Notes\ntext\n";
	assert.equal(addTaskLine(note, "b", "Todo").content, "# Day\n\n## Todo\n- [ ] a\n- [ ] b\n\n## Notes\ntext\n");
});

void test("add: creates the section when it is missing", () => {
	assert.equal(addTaskLine("# Day\n", "a", "Todo").content, "# Day\n\n## Todo\n- [ ] a\n");
	assert.equal(addTaskLine("", "a", "Todo").content, "## Todo\n- [ ] a\n");
});

void test("add: works when the section is last, with or without a trailing newline", () => {
	assert.equal(addTaskLine("## Todo\n- [ ] a\n", "b", "Todo").content, "## Todo\n- [ ] a\n- [ ] b\n");
	assert.equal(addTaskLine("## Todo\n- [ ] a", "b", "Todo").content, "## Todo\n- [ ] a\n- [ ] b\n");
	assert.equal(addTaskLine("## Todo", "b", "Todo").content, "## Todo\n- [ ] b\n");
});

void test("add: a task that is a prefix of another is still added", () => {
	const edit = addTaskLine("## Todo\n- [ ] foobar\n", "foo", "Todo");
	assert.equal(edit.changed, true);
	assert.equal(edit.content, "## Todo\n- [ ] foobar\n- [ ] foo\n");
});

void test("add: an identical open task is not duplicated", () => {
	assert.equal(addTaskLine("## Todo\n- [ ] foo\n", "foo", "Todo").changed, false);
});

void test("add: does not match a longer header with the same prefix", () => {
	const edit = addTaskLine("## Todo list\n- [ ] a\n", "b", "Todo");
	assert.equal(edit.content, "## Todo list\n- [ ] a\n\n## Todo\n- [ ] b\n");
});

void test("complete: stamps the exact task only", () => {
	const note = "- [ ] send mail\n  - [ ] mail\n";
	assert.equal(completeTaskLine(note, "mail", "09:30").content, "- [ ] send mail\n  - [x] 09:30 mail\n");
});

void test("complete: task text with regex and replacement characters is taken literally", () => {
	const note = "- [ ] pay $1 (50%) [now]\n";
	assert.equal(completeTaskLine(note, "pay $1 (50%) [now]", "10:00").content, "- [x] 10:00 pay $1 (50%) [now]\n");
});

void test("complete: reports when the task is missing", () => {
	assert.equal(completeTaskLine("- [x] 09:00 a\n", "a", "10:00").changed, false);
});

void test("delete: removes the exact task and leaves lookalikes", () => {
	const note = "- [ ] send mail\n- [ ] mail\n- [ ] mail merge\n";
	assert.equal(deleteTaskLine(note, "mail").content, "- [ ] send mail\n- [ ] mail merge\n");
});

void test("delete: removes a completed, stamped task", () => {
	assert.equal(deleteTaskLine("- [x] 09:30 mail\nrest\n", "mail").content, "rest\n");
});

void test("delete: does nothing when only a lookalike exists", () => {
	assert.equal(deleteTaskLine("- [ ] send mail\n", "mail").changed, false);
});

void test("CRLF notes keep their line endings", () => {
	const note = "## Todo\r\n- [ ] a\r\n";
	assert.equal(completeTaskLine(note, "a", "09:00").content, "## Todo\r\n- [x] 09:00 a\r\n");
});

void test("append: adds any line under a heading, creating it when missing", () => {
	assert.equal(
		appendUnderHeading("# Day\n\n## Focus log\n- 09:00–09:25 🍅 a\n", "- 09:30–09:55 🍅 b", "Focus log").content,
		"# Day\n\n## Focus log\n- 09:00–09:25 🍅 a\n- 09:30–09:55 🍅 b\n"
	);
	assert.equal(appendUnderHeading("# Day\n", "- x", "Focus log").content, "# Day\n\n## Focus log\n- x\n");
});

void test("list: returns open tasks of the section only", () => {
	const note = "## Todo\n- [ ] a\n- [x] 09:00 done\n  - [ ] nested b\ntext\n\n## Other\n- [ ] c\n";
	assert.deepEqual(listOpenTasks(note, "Todo"), ["a", "nested b"]);
	assert.deepEqual(listOpenTasks(note, "Missing"), []);
});

void test("complete: appends the pomodoro tally, and delete still finds the line", () => {
	const done = completeTaskLine("- [ ] write\n", "write", "10:00", " 🍅3").content;
	assert.equal(done, "- [x] 10:00 write 🍅3\n");
	assert.equal(deleteTaskLine(done, "write").content, "");
});

void test("complete: a tally with an estimate is written and still found by delete and reopen", () => {
	const done = completeTaskLine("- [ ] write\n", "write", "10:00", " 🍅2/4").content;
	assert.equal(done, "- [x] 10:00 write 🍅2/4\n");
	assert.equal(reopenTaskLine(done, "write").content, "- [ ] write\n");
	assert.equal(deleteTaskLine(done, "write").content, "");
});

void test("reopen: leaves lookalikes and open tasks alone", () => {
	assert.equal(reopenTaskLine("- [x] 09:00 send mail\n", "mail").changed, false);
	assert.equal(reopenTaskLine("- [ ] mail\n", "mail").changed, false);
	assert.equal(reopenTaskLine("  - [x] 09:00 mail\n", "mail").content, "  - [ ] mail\n");
});

void test("rename: rewrites the exact open task in place", () => {
	const note = "## Todo\n- [ ] send mail\n  - [ ] mail\n";
	assert.equal(renameTaskLine(note, "mail", "post $1").content, "## Todo\n- [ ] send mail\n  - [ ] post $1\n");
	assert.equal(renameTaskLine(note, "missing", "x").changed, false);
});

void test("forward: marks the exact open task as moved on", () => {
	const note = "## Todo\n- [ ] send mail\n- [ ] mail\n- [x] 09:00 done\n";
	assert.equal(forwardTaskLine(note, "mail").content, "## Todo\n- [ ] send mail\n- [>] mail\n- [x] 09:00 done\n");
	assert.equal(forwardTaskLine(note, "done").changed, false);
	// A forwarded task is no longer open, so it is not picked up again.
	assert.deepEqual(listOpenTasks(forwardTaskLine(note, "mail").content, "Todo"), ["send mail"]);
});
