import assert from "node:assert/strict";
import { test } from "node:test";
import { clamp, extractYouTubeInfo, formatTime, parseTimeString, taskTally } from "../src/utils";

void test("parseTimeString", () => {
	assert.equal(parseTimeString("90"), 90);
	assert.equal(parseTimeString("10:30"), 630);
	assert.equal(parseTimeString("1:00:05"), 3605);
	assert.equal(parseTimeString("abc"), 0);
});

void test("formatTime", () => {
	assert.equal(formatTime(0), "0:00");
	assert.equal(formatTime(65), "1:05");
	assert.equal(formatTime(NaN), "0:00");
});

void test("clamp", () => {
	assert.equal(clamp(5, 10, 20), 10);
	assert.equal(clamp(25, 10, 20), 20);
});

void test("extractYouTubeInfo", () => {
	assert.deepEqual(extractYouTubeInfo("https://www.youtube.com/watch?v=jfKfPfyJRdk"), { videoId: "jfKfPfyJRdk", listId: null });
	assert.deepEqual(extractYouTubeInfo("https://youtu.be/jfKfPfyJRdk"), { videoId: "jfKfPfyJRdk", listId: null });
	assert.deepEqual(extractYouTubeInfo("https://www.youtube.com/playlist?list=PLabc_123"), { videoId: null, listId: "PLabc_123" });
	assert.deepEqual(extractYouTubeInfo("https://www.youtube.com/watch?v=jfKfPfyJRdk&list=PLabc"), { videoId: "jfKfPfyJRdk", listId: "PLabc" });
	assert.deepEqual(extractYouTubeInfo("jfKfPfyJRdk"), { videoId: "jfKfPfyJRdk", listId: null });
	assert.deepEqual(extractYouTubeInfo("not a url"), { videoId: null, listId: null });
});

void test("taskTally", () => {
	assert.equal(taskTally({}), "");
	assert.equal(taskTally({ pomodoros: 2 }), "🍅2");
	assert.equal(taskTally({ estimate: 4 }), "🍅0/4");
	assert.equal(taskTally({ pomodoros: 5, estimate: 4 }), "🍅5/4");
});
