import { Notice, setIcon } from "obsidian";
import type ZenZonePlugin from "../main";
import { DomListenerRegistry, TimeoutRegistry } from "../dom";
import { t } from "../i18n";
import { ZenTask } from "../types";
import { taskTally } from "../utils";

/** How long the checkbox stays ticked before the task disappears. */
const COMPLETION_FEEDBACK_MS = 500;
/** How long the "undo" notice stays up. */
const UNDO_WINDOW_MS = 8000;
const MAX_ESTIMATE = 99;

type RowAction = "complete" | "focus" | "edit" | "save" | "cancel" | "up" | "down" | "delete";

/** What it takes to take back a completion or a deletion. */
interface UndoableRemoval {
	task: ZenTask;
	index: number;
	kind: "complete" | "delete";
}

function parseEstimate(value: string): number | undefined {
	const parsed = parseInt(value, 10);
	return parsed > 0 ? Math.min(parsed, MAX_ESTIMATE) : undefined;
}

/**
 * The task card: the current focus task, an input to add tasks, and the
 * backlog, which can be reordered, edited in place and promoted to the
 * current task with one click.
 *
 * Row interaction is delegated to the list container, so the number of live
 * listeners stays constant no matter how long the backlog gets. The card owns
 * its own listener registry, so refreshing it leaves the rest of the view
 * working.
 */
export class TaskCard {
	private readonly listeners = new DomListenerRegistry();
	private readonly timeouts = new TimeoutRegistry();
	private dragSrcIndex = -1;
	/** Id of the task whose row is showing its edit fields, if any. */
	private editingId: string | null = null;

	constructor(
		private readonly el: HTMLElement,
		private readonly plugin: ZenZonePlugin
	) {}

	private get tasks(): ZenTask[] {
		return this.plugin.settings.tasks;
	}

	render(): void {
		this.el.empty();
		this.attachRowDelegates(this.el);
		this.renderFocus();
		this.renderInput();
		this.renderList();
	}

	refresh(): void {
		// A redraw would throw away what is being typed; data changes can wait.
		const active = this.el.ownerDocument.activeElement;
		if (active?.instanceOf(HTMLInputElement) && this.el.contains(active) && active.value !== "") return;
		this.forceRefresh();
	}

	private forceRefresh(): void {
		this.listeners.clear();
		this.render();
	}

	destroy(): void {
		this.listeners.clear();
		this.timeouts.clearAll();
	}

	// --- Current focus ---------------------------------------------------

	private renderFocus(): void {
		const wrapper = this.el.createDiv({ cls: "zen-task-focus-wrapper" });
		const heading = wrapper.createDiv({ cls: "zen-task-focus-heading" });
		heading.createDiv({ text: t("task.current"), cls: "zen-sub-label" });
		if (this.plugin.settings.autoLogToDaily) {
			const importBtn = heading.createEl("button", {
				cls: "zen-task-control-btn",
				attr: { "aria-label": t("task.import") }
			});
			setIcon(importBtn, "download");
			this.listeners.add(importBtn, "click", () => void this.importFromDailyNote());
		}
		const activeTask = this.tasks[0];
		if (!activeTask) {
			wrapper.createDiv({ text: t("task.empty"), cls: "zen-task-text-placeholder" });
			return;
		}
		// The current task is an ordinary row, only larger: it can be ticked,
		// edited and deleted exactly like the ones below it.
		this.renderRow(wrapper, activeTask, 0);
	}

	/** `🍅2/4`, turning to a warning colour once the estimate is used up. */
	private renderTally(parent: HTMLElement, task: ZenTask): void {
		const tally = taskTally(task);
		if (!tally) return;
		const el = parent.createSpan({ text: tally, cls: "zen-task-tally" });
		el.toggleClass("is-over", Boolean(task.estimate) && (task.pomodoros ?? 0) > (task.estimate ?? 0));
	}

	/** Pulls in open checkboxes that were written into today's daily note by hand. */
	private async importFromDailyNote(): Promise<void> {
		const known = new Set(this.tasks.map((task) => task.content));
		const filePath = this.plugin.dailyNotes.todayPath();
		let added = 0;
		for (const content of await this.plugin.dailyNotes.readOpenTasks()) {
			if (known.has(content)) continue;
			known.add(content);
			this.tasks.push({ id: `${Date.now()}-${added}`, content, filePath });
			added++;
		}
		new Notice(t(added > 0 ? "task.imported" : "task.nothingToImport", { count: added }));
		if (added === 0) return;
		await this.plugin.saveSettings();
		this.forceRefresh();
	}

	// --- Add task --------------------------------------------------------

	private renderInput(): void {
		const wrapper = this.el.createDiv({ cls: "zen-task-input-wrapper" });
		const mainRow = wrapper.createDiv({ cls: "zen-task-input-row" });

		const taskInput = mainRow.createEl("input", {
			type: "text",
			placeholder: t("task.placeholder"),
			cls: "zen-task-add-input",
			attr: { "aria-label": t("task.add") }
		});
		const addBtn = mainRow.createEl("button", { cls: "zen-task-add-btn", attr: { "aria-label": t("task.add") } });
		setIcon(addBtn, "plus");

		const optionRow = wrapper.createDiv({ cls: "zen-task-input-row zen-task-option-row" });
		const estimateInput = optionRow.createEl("input", {
			type: "number",
			placeholder: t("task.estimatePlaceholder"),
			cls: "zen-task-add-input zen-task-estimate-input",
			attr: { min: "1", max: MAX_ESTIMATE.toString(), "aria-label": t("task.estimate") }
		});
		const headerInput = optionRow.createEl("input", {
			type: "text",
			placeholder: this.plugin.settings.dailyNoteTargetHeader || "Todo",
			cls: "zen-task-add-input zen-task-header-input",
			attr: { "aria-label": t("task.headerTooltip") }
		});
		// The heading only means something when tasks are filed into the daily note.
		headerInput.toggleClass("is-hidden", !this.plugin.settings.autoLogToDaily);

		const addTask = async () => {
			const content = taskInput.value.trim();
			if (!content) return;

			const task: ZenTask = {
				id: Date.now().toString(),
				content,
				header: headerInput.value.trim() || undefined,
				estimate: parseEstimate(estimateInput.value),
				filePath: this.plugin.dailyNotes.todayPath()
			};

			this.tasks.push(task);
			taskInput.value = "";
			estimateInput.value = "";
			await this.plugin.dailyNotes.manageTask(task.content, task.header, "add", task.filePath);
			await this.plugin.saveSettings();
			this.forceRefresh();
			// Keep the cursor where it was, ready for the next task.
			this.el.querySelector<HTMLInputElement>(".zen-task-input-row .zen-task-add-input")?.focus();
		};

		const onEnter = (input: HTMLInputElement, action: () => void) => {
			this.listeners.add(input, "keydown", (event) => {
				const key = event as KeyboardEvent;
				// Enter also confirms an IME composition; that must not submit the task.
				if (key.key === "Enter" && !key.isComposing) action();
			});
		};
		onEnter(taskInput, () => void addTask());
		onEnter(estimateInput, () => void addTask());
		onEnter(headerInput, () => void addTask());
		this.listeners.add(addBtn, "click", () => void addTask());
	}

	// --- Backlog ---------------------------------------------------------

	private renderList(): void {
		if (this.tasks.length <= 1) return;
		const listWrapper = this.el.createDiv({ cls: "zen-task-list-wrapper" });
		this.tasks.forEach((task, index) => {
			if (index > 0) this.renderRow(listWrapper, task, index);
		});
	}

	/** A fixed handful of listeners for every task row, however many there are. */
	private attachRowDelegates(listWrapper: HTMLElement): void {
		this.listeners.add(listWrapper, "click", (event) => {
			const control = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
			if (!control) return;
			const row = control.closest<HTMLElement>(".zen-task-row");
			const index = this.indexOfRow(row);
			if (index < 0) return;
			void this.runRowAction(control.dataset.action as RowAction, index, row);
		});

		this.listeners.add(listWrapper, "keydown", (event) => {
			const key = event as KeyboardEvent;
			const row = (key.target as HTMLElement).closest<HTMLElement>(".zen-task-row.is-editing");
			const index = this.indexOfRow(row);
			if (index < 0 || key.isComposing) return;
			if (key.key === "Enter") void this.runRowAction("save", index, row);
			if (key.key === "Escape") void this.runRowAction("cancel", index, row);
		});

		this.listeners.add(listWrapper, "dragstart", (event) => {
			const row = (event.target as HTMLElement).closest<HTMLElement>(".zen-task-row");
			const index = this.indexOfRow(row);
			if (index < 0 || !row) return;
			this.dragSrcIndex = index;
			row.addClass("is-dragging");
			const transfer = (event as DragEvent).dataTransfer;
			if (transfer) {
				transfer.effectAllowed = "move";
				transfer.setData("text/plain", index.toString());
			}
		});

		this.listeners.add(listWrapper, "dragover", (event) => {
			event.preventDefault();
			const transfer = (event as DragEvent).dataTransfer;
			if (transfer) transfer.dropEffect = "move";
		});

		this.listeners.add(listWrapper, "drop", (event) => {
			event.preventDefault();
			if (this.dragSrcIndex < 0) return;
			const row = (event.target as HTMLElement).closest<HTMLElement>(".zen-task-row");
			// Dropping below the last row sends the task to the end.
			const target = this.indexOfRow(row);
			void this.moveTask(target < 0 ? this.tasks.length - 1 : target);
		});

		this.listeners.add(listWrapper, "dragend", (event) => {
			(event.target as HTMLElement).closest<HTMLElement>(".zen-task-row")?.removeClass("is-dragging");
			this.dragSrcIndex = -1;
		});
	}

	private indexOfRow(row: HTMLElement | null): number {
		if (!row?.dataset.index) return -1;
		const index = parseInt(row.dataset.index, 10);
		return index >= 0 && index < this.tasks.length ? index : -1;
	}

	private renderRow(listWrapper: HTMLElement, task: ZenTask, index: number): void {
		const row = listWrapper.createDiv({ cls: "zen-task-row" });
		row.dataset.index = index.toString();
		row.toggleClass("is-current", index === 0);

		if (task.id === this.editingId) {
			this.renderEditFields(row, task);
			return;
		}
		row.draggable = true;

		const checkbox = row.createEl("input", {
			type: "checkbox",
			cls: "zen-task-cb",
			attr: { "aria-label": t("task.complete") }
		});
		checkbox.checked = false;
		checkbox.dataset.action = "complete";

		// The text doubles as the way to make this the task being worked on.
		const text = row.createEl("button", { cls: "zen-task-text", text: task.content });
		text.dataset.action = "focus";
		if (index > 0) text.ariaLabel = t("task.makeCurrent");
		if (task.header) {
			text.createSpan({ text: ` #${task.header}`, cls: "zen-task-header-tag" });
		}
		this.renderTally(row, task);

		const controls = row.createDiv({ cls: "zen-task-row-controls" });
		this.addControl(controls, "edit", "pencil", t("task.edit"));
		if (index > 0) this.addControl(controls, "up", "arrow-up", t("task.moveUp"));
		if (index < this.tasks.length - 1) this.addControl(controls, "down", "arrow-down", t("task.moveDown"));
		this.addControl(controls, "delete", "trash", t("task.delete"), "is-danger");
	}

	private renderEditFields(row: HTMLElement, task: ZenTask): void {
		row.addClass("is-editing");
		const content = row.createEl("input", {
			type: "text",
			cls: "zen-task-add-input zen-task-edit-content",
			attr: { "aria-label": t("task.edit") }
		});
		content.value = task.content;

		const estimate = row.createEl("input", {
			type: "number",
			placeholder: t("task.estimatePlaceholder"),
			cls: "zen-task-add-input zen-task-estimate-input",
			attr: { min: "1", max: MAX_ESTIMATE.toString(), "aria-label": t("task.estimate") }
		});
		estimate.value = task.estimate?.toString() ?? "";

		const controls = row.createDiv({ cls: "zen-task-row-controls" });
		this.addControl(controls, "save", "check", t("task.save"));
		this.addControl(controls, "cancel", "x", t("task.cancel"));

		// The row only exists once this render pass is over.
		this.timeouts.set(() => {
			content.focus();
			content.select();
		}, 0);
	}

	private addControl(parent: HTMLElement, action: RowAction, icon: string, tooltip: string, extraClass = ""): void {
		const btn = parent.createEl("button", { cls: `zen-task-control-btn ${extraClass}`.trim() });
		setIcon(btn, icon);
		btn.ariaLabel = tooltip;
		btn.dataset.action = action;
	}

	// --- Mutations -------------------------------------------------------

	private async runRowAction(action: RowAction, index: number, row: HTMLElement | null): Promise<void> {
		const task = this.tasks[index];
		if (!task) return;

		switch (action) {
			case "complete":
				row?.addClass("is-completed");
				this.completeTask(task);
				return;
			case "focus":
				return this.makeCurrent(index);
			case "edit":
				this.editingId = task.id;
				this.forceRefresh();
				return;
			case "save":
				return this.saveEdit(task, row);
			case "cancel":
				this.editingId = null;
				this.forceRefresh();
				return;
			case "up":
				return this.swapTasks(index, index - 1);
			case "down":
				return this.swapTasks(index, index + 1);
			case "delete":
				return this.deleteTask(task, index);
		}
	}

	/** Puts a task at the top of the list, where the timer counts towards it. */
	private async makeCurrent(index: number): Promise<void> {
		if (index <= 0) return;
		const [task] = this.tasks.splice(index, 1);
		this.tasks.unshift(task);
		await this.plugin.saveSettings();
		this.forceRefresh();
	}

	private async saveEdit(task: ZenTask, row: HTMLElement | null): Promise<void> {
		const content = row?.querySelector<HTMLInputElement>(".zen-task-edit-content")?.value.trim() ?? "";
		const estimate = row?.querySelector<HTMLInputElement>(".zen-task-estimate-input")?.value ?? "";
		this.editingId = null;

		// An emptied name is treated as a change of mind, not as a deletion.
		if (content && content !== task.content) {
			await this.plugin.dailyNotes.renameTask(task.content, content, task.filePath);
			task.content = content;
		}
		task.estimate = parseEstimate(estimate);
		await this.plugin.saveSettings();
		this.forceRefresh();
	}

	private async deleteTask(task: ZenTask, index: number): Promise<void> {
		await this.plugin.dailyNotes.manageTask(task.content, task.header, "delete", task.filePath);
		this.tasks.splice(index, 1);
		await this.plugin.saveSettings();
		this.forceRefresh();
		this.offerUndo({ task, index, kind: "delete" });
	}

	private async moveTask(targetIndex: number): Promise<void> {
		if (this.dragSrcIndex < 0 || this.dragSrcIndex === targetIndex) return;
		const [moved] = this.tasks.splice(this.dragSrcIndex, 1);
		this.tasks.splice(targetIndex, 0, moved);
		this.dragSrcIndex = -1;
		await this.plugin.saveSettings();
		this.forceRefresh();
	}

	private async swapTasks(a: number, b: number): Promise<void> {
		[this.tasks[a], this.tasks[b]] = [this.tasks[b], this.tasks[a]];
		await this.plugin.saveSettings();
		this.forceRefresh();
	}

	/** Ticks the checkbox, then removes the task once the feedback delay is over. */
	private completeTask(task: ZenTask): void {
		this.timeouts.set(() => void this.finishTask(task), COMPLETION_FEEDBACK_MS);
	}

	private async finishTask(task: ZenTask): Promise<void> {
		const index = this.tasks.indexOf(task);
		if (index < 0) return;
		await this.plugin.dailyNotes.manageTask(task.content, task.header, "complete", task.filePath, taskTally(task));
		this.tasks.splice(index, 1);
		await this.plugin.saveSettings();
		this.forceRefresh();
		this.offerUndo({ task, index, kind: "complete" });
	}

	// --- Undo ------------------------------------------------------------

	/** Says what just happened, with a button that takes it back. */
	private offerUndo(removal: UndoableRemoval): void {
		const message = createFragment((fragment) => {
			const key = removal.kind === "complete" ? "task.completedNotice" : "task.deletedNotice";
			fragment.createSpan({ text: t(key, { task: removal.task.content }) });
			fragment.createEl("button", { text: t("task.undo"), cls: "zen-undo-btn" });
		});
		const notice = new Notice(message, UNDO_WINDOW_MS);
		// The notice outlives a re-render of the card, so it keeps its own listener.
		notice.messageEl.querySelector("button")?.addEventListener("click", (event) => {
			event.stopPropagation();
			notice.hide();
			void this.undo(removal);
		});
	}

	private async undo({ task, index, kind }: UndoableRemoval): Promise<void> {
		if (this.tasks.includes(task)) return;
		this.tasks.splice(Math.min(index, this.tasks.length), 0, task);
		await this.plugin.dailyNotes.manageTask(
			task.content,
			task.header,
			kind === "complete" ? "reopen" : "add",
			task.filePath
		);
		await this.plugin.saveSettings();
		this.plugin.notifyDataChange();
	}
}
