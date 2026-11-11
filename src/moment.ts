import { moment } from "obsidian";

/** The subset of moment.js that this plugin uses. */
export interface MomentLike {
	format(pattern?: string): string;
}

interface MomentFactory {
	(input?: number): MomentLike;
	locale(): string;
}

// Obsidian types `moment` as a module namespace, which TypeScript refuses to
// call under `esModuleInterop`; at runtime it is the usual moment function.
const factory = moment as unknown as MomentFactory;

/** The current time, as a moment. */
export function now(): MomentLike {
	return factory();
}

/** Formats an epoch-millisecond timestamp with a moment pattern. */
export function formatClock(epochMs: number, pattern: string): string {
	return factory(epochMs).format(pattern);
}

/** The app language as moment reports it, e.g. `en` or `ja`. */
export function appLocale(): string {
	return factory.locale();
}
