import assert from "node:assert/strict";
import { test } from "node:test";
import { addTaskLine, completeTaskLine, deleteTaskLine } from "../src/task-lines";

test("add: appends to the end of the target section", () => {
	const note = "# Day\n\n## Todo\n- [ ] a\n\n## Notes\ntext\n";
	assert.equal(addTaskLine(note, "b", "Todo").content, "# Day\n\n## Todo\n- [ ] a\n- [ ] b\n\n## Notes\ntext\n");
});

test("add: creates the section when it is missing", () => {
	assert.equal(addTaskLine("# Day\n", "a", "Todo").content, "# Day\n\n## Todo\n- [ ] a\n");
	assert.equal(addTaskLine("", "a", "Todo").content, "## Todo\n- [ ] a\n");
});

test("add: works when the section is last, with or without a trailing newline", () => {
	assert.equal(addTaskLine("## Todo\n- [ ] a\n", "b", "Todo").content, "## Todo\n- [ ] a\n- [ ] b\n");
	assert.equal(addTaskLine("## Todo\n- [ ] a", "b", "Todo").content, "## Todo\n- [ ] a\n- [ ] b\n");
	assert.equal(addTaskLine("## Todo", "b", "Todo").content, "## Todo\n- [ ] b\n");
});

test("add: a task that is a prefix of another is still added", () => {
	const edit = addTaskLine("## Todo\n- [ ] foobar\n", "foo", "Todo");
	assert.equal(edit.changed, true);
	assert.equal(edit.content, "## Todo\n- [ ] foobar\n- [ ] foo\n");
});

test("add: an identical open task is not duplicated", () => {
	assert.equal(addTaskLine("## Todo\n- [ ] foo\n", "foo", "Todo").changed, false);
});

test("add: does not match a longer header with the same prefix", () => {
	const edit = addTaskLine("## Todo list\n- [ ] a\n", "b", "Todo");
	assert.equal(edit.content, "## Todo list\n- [ ] a\n\n## Todo\n- [ ] b\n");
});

test("complete: stamps the exact task only", () => {
	const note = "- [ ] send mail\n  - [ ] mail\n";
	assert.equal(completeTaskLine(note, "mail", "09:30").content, "- [ ] send mail\n  - [x] 09:30 mail\n");
});

test("complete: task text with regex and replacement characters is taken literally", () => {
	const note = "- [ ] pay $1 (50%) [now]\n";
	assert.equal(completeTaskLine(note, "pay $1 (50%) [now]", "10:00").content, "- [x] 10:00 pay $1 (50%) [now]\n");
});

test("complete: reports when the task is missing", () => {
	assert.equal(completeTaskLine("- [x] 09:00 a\n", "a", "10:00").changed, false);
});

test("delete: removes the exact task and leaves lookalikes", () => {
	const note = "- [ ] send mail\n- [ ] mail\n- [ ] mail merge\n";
	assert.equal(deleteTaskLine(note, "mail").content, "- [ ] send mail\n- [ ] mail merge\n");
});

test("delete: removes a completed, stamped task", () => {
	assert.equal(deleteTaskLine("- [x] 09:30 mail\nrest\n", "mail").content, "rest\n");
});

test("delete: does nothing when only a lookalike exists", () => {
	assert.equal(deleteTaskLine("- [ ] send mail\n", "mail").changed, false);
});

test("CRLF notes keep their line endings", () => {
	const note = "## Todo\r\n- [ ] a\r\n";
	assert.equal(completeTaskLine(note, "a", "09:00").content, "## Todo\r\n- [x] 09:00 a\r\n");
});
