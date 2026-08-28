/**
 * Tracks DOM listeners so a region of the UI can detach exactly its own
 * listeners when it re-renders, without touching the rest of the view.
 */
export class DomListenerRegistry {
	private entries: Array<{ el: EventTarget; type: string; handler: EventListener }> = [];

	add(el: EventTarget, type: string, handler: EventListener): void {
		el.addEventListener(type, handler);
		this.entries.push({ el, type, handler });
	}

	clear(): void {
		for (const { el, type, handler } of this.entries) {
			el.removeEventListener(type, handler);
		}
		this.entries = [];
	}
}

/**
 * Collects `setTimeout` handles so they can all be cancelled at once, keeping
 * delayed work from running after the owning component is gone.
 */
export class TimeoutRegistry {
	private handles = new Set<number>();

	set(handler: () => void, delayMs: number): number {
		const id = window.setTimeout(() => {
			this.handles.delete(id);
			handler();
		}, delayMs);
		this.handles.add(id);
		return id;
	}

	clearAll(): void {
		for (const id of this.handles) window.clearTimeout(id);
		this.handles.clear();
	}
}
