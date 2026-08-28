import { YouTubeInfo } from "./types";

/** Parses `ss`, `mm:ss` or `hh:mm:ss` into seconds. Returns 0 for anything else. */
export function parseTimeString(timeStr: string): number {
	const parts = timeStr.split(":").map(Number);
	if (parts.some(isNaN)) return 0;
	if (parts.length === 1) return parts[0];
	if (parts.length === 2) return parts[0] * 60 + parts[1];
	if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
	return 0;
}

/** Formats seconds as `m:ss`. */
export function formatTime(seconds: number): string {
	if (isNaN(seconds)) return "0:00";
	const m = Math.floor(seconds / 60);
	const s = Math.floor(seconds % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const YOUTUBE_VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_URL = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
const YOUTUBE_LIST = /[?&]list=([a-zA-Z0-9_-]+)/;

/** Pulls a video id and/or a playlist id out of a YouTube URL or a bare video id. */
export function extractYouTubeInfo(input: string): YouTubeInfo {
	if (!input) return { videoId: null, listId: null };

	const listMatch = input.match(YOUTUBE_LIST);
	const listId = listMatch ? listMatch[1] : null;

	if (YOUTUBE_VIDEO_ID.test(input)) return { videoId: input, listId };

	const match = input.match(YOUTUBE_URL);
	const videoId = match && match[2].length === 11 ? match[2] : null;
	return { videoId, listId };
}
