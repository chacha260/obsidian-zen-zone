import { AbstractInputSuggest, App, TFile, TFolder } from "obsidian";
import { AUDIO_EXTENSIONS } from "../constants";

const MAX_SUGGESTIONS = 30;

/** Suggests audio files (and optionally folders) from the vault while typing a path. */
export class VaultPathSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private readonly inputEl: HTMLInputElement,
		private readonly includeFolders: boolean
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): string[] {
		const needle = query.trim().toLowerCase();
		// Typing a URL is not a search for a file.
		if (/^https?:/.test(needle)) return [];

		const matches: string[] = [];
		for (const entry of this.app.vault.getAllLoadedFiles()) {
			const wanted =
				(entry instanceof TFile && AUDIO_EXTENSIONS.includes(entry.extension.toLowerCase())) ||
				(this.includeFolders && entry instanceof TFolder && !entry.isRoot());
			if (!wanted || !entry.path.toLowerCase().includes(needle)) continue;
			matches.push(entry.path);
			if (matches.length >= MAX_SUGGESTIONS) break;
		}
		return matches;
	}

	renderSuggestion(path: string, el: HTMLElement): void {
		el.setText(path);
	}

	selectSuggestion(path: string): void {
		this.setValue(path);
		// Let the setting's own change handler pick the value up.
		this.inputEl.dispatchEvent(new Event("input"));
		this.close();
	}
}
