import { Notice, setIcon } from "obsidian";
import type ZenZonePlugin from "../main";
import { DomListenerRegistry, TimeoutRegistry } from "../dom";
import { ZenTask } from "../types";

/** How long the checkbox stays ticked before the task disappears. */
const COMPLETION_FEEDBACK_MS = 500;

const DEFAULT_LIST_HEIGHT = "200px";

type RowAction = "complete" | "up" | "down" | "delete";

/**
 * The task card: the current focus task, an input to add tasks, and the
 * reorderable backlog.
 *
 * Row interaction is delegated to the list container, so the number of live
 * listeners stays constant no matter how long the backlog gets, and a re-render
 * does not have to rebuild one closure per control. The card also owns its own
 * listener registry, so refreshing it leaves the rest of the view working.
 */
export class TaskCard {
	private readonly listeners = new DomListenerRegistry();
	private readonly timeouts = new TimeoutRegistry();
	/** Preserved across re-renders so the user's manual resize is not lost. */
	private listHeight: string | null = null;
	private dragSrcIndex = -1;

	constructor(
		private readonly el: HTMLElement,
		private readonly plugin: ZenZonePlugin
	) {}

	private get tasks(): ZenTask[] {
		return this.plugin.settings.tasks;
	}

	render(): void {
		this.el.empty();
		this.renderFocus();
		this.renderInput();
		this.renderList();
	}

	refresh(): void {
		const wrapper = this.el.querySelector<HTMLElement>(".zen-task-list-wrapper");
		if (wrapper) this.listHeight = wrapper.style.height || `${wrapper.offsetHeight}px`;
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
		wrapper.createDiv({ text: "🔥 Current Focus", cls: "zen-sub-label" });
		const display = wrapper.createDiv({ cls: "zen-task-focus-display" });

		const activeTask = this.tasks[0];
		if (!activeTask) {
			display.createSpan({ text: "No active tasks. Great job! 🎉", cls: "zen-task-text-placeholder" });
			return;
		}

		const checkbox = display.createEl("input", { type: "checkbox", cls: "zen-task-cb-large" });
		checkbox.checked = false;
		this.listeners.add(checkbox, "click", () => {
			checkbox.checked = true;
			this.completeTask(activeTask, "Task Completed! 🎉");
		});

		const text = display.createSpan({ text: activeTask.content, cls: "zen-task-text-large" });
		if (activeTask.header) {
			text.createSpan({ text: ` [${activeTask.header}]`, cls: "zen-task-header-tag" });
		}
	}

	// --- Add task --------------------------------------------------------

	private renderInput(): void {
		const wrapper = this.el.createDiv({ cls: "zen-task-input-wrapper" });

		const headerInput = wrapper.createEl("input", {
			type: "text",
			placeholder: this.plugin.settings.dailyNoteTargetHeader || "Todo",
			cls: "zen-task-add-input zen-task-header-input",
			attr: { title: "Target header (optional)" }
		});

		const taskInput = wrapper.createEl("input", {
			type: "text",
			placeholder: "Add a new task...",
			cls: "zen-task-add-input"
		});

		const addTask = async () => {
			const content = taskInput.value.trim();
			if (!content) return;

			const task: ZenTask = {
				id: Date.now().toString(),
				content,
				header: headerInput.value.trim() || undefined,
				filePath: this.plugin.dailyNotes.todayPath()
			};

			this.tasks.push(task);
			await this.plugin.dailyNotes.manageTask(task.content, task.header, "add", task.filePath);
			await this.plugin.saveSettings();
			taskInput.value = "";
			this.refresh();
		};

		this.listeners.add(taskInput, "keypress", (event) => {
			if ((event as KeyboardEvent).key === "Enter") void addTask();
		});
		this.listeners.add(headerInput, "keypress", (event) => {
			if ((event as KeyboardEvent).key === "Enter") taskInput.focus();
		});

		const addBtn = wrapper.createEl("button", { text: "+", cls: "zen-task-add-btn" });
		this.listeners.add(addBtn, "click", () => void addTask());
	}

	// --- Backlog ---------------------------------------------------------

	private renderList(): void {
		const listWrapper = this.el.createDiv({ cls: "zen-task-list-wrapper" });
		listWrapper.style.height = this.listHeight ?? DEFAULT_LIST_HEIGHT;

		this.attachListDelegates(listWrapper);
		this.tasks.forEach((task, index) => this.renderRow(listWrapper, task, index));
	}

	/** Five listeners for the whole backlog, however many rows it holds. */
	private attachListDelegates(listWrapper: HTMLElement): void {
		this.listeners.add(listWrapper, "click", (event) => {
			const control = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
			if (!control) return;
			const row = control.closest<HTMLElement>(".zen-task-row");
			const index = this.indexOfRow(row);
			if (index < 0) return;
			void this.runRowAction(control.dataset.action as RowAction, index, row);
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
		row.draggable = true;
		row.dataset.index = index.toString();

		const checkbox = row.createEl("input", { type: "checkbox", cls: "zen-task-cb" });
		checkbox.checked = false;
		checkbox.dataset.action = "complete";

		const text = row.createSpan({ cls: "zen-task-text", text: task.content });
		if (task.header) {
			text.createSpan({ text: ` #${task.header}`, cls: "zen-task-header-tag" });
		}

		const controls = row.createDiv({ cls: "zen-task-row-controls" });
		if (index > 0) this.addControl(controls, "up", "arrow-up", "Move up");
		if (index < this.tasks.length - 1) this.addControl(controls, "down", "arrow-down", "Move down");
		this.addControl(controls, "delete", "trash", "Delete", "is-danger");
	}

	private addControl(parent: HTMLElement, action: RowAction, icon: string, tooltip: string, extraClass = ""): void {
		const btn = parent.createEl("button", { cls: `zen-task-control-btn ${extraClass}`.trim() });
		setIcon(btn, icon);
		btn.title = tooltip;
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
			case "up":
				return this.swapTasks(index, index - 1);
			case "down":
				return this.swapTasks(index, index + 1);
			case "delete":
				await this.plugin.dailyNotes.manageTask(task.content, task.header, "delete", task.filePath);
				this.tasks.splice(index, 1);
				await this.plugin.saveSettings();
				this.refresh();
		}
	}

	private async moveTask(targetIndex: number): Promise<void> {
		if (this.dragSrcIndex < 0 || this.dragSrcIndex === targetIndex) return;
		const [moved] = this.tasks.splice(this.dragSrcIndex, 1);
		this.tasks.splice(targetIndex, 0, moved);
		this.dragSrcIndex = -1;
		await this.plugin.saveSettings();
		this.refresh();
	}

	private async swapTasks(a: number, b: number): Promise<void> {
		[this.tasks[a], this.tasks[b]] = [this.tasks[b], this.tasks[a]];
		await this.plugin.saveSettings();
		this.refresh();
	}

	/** Ticks the checkbox, then removes the task once the feedback delay is over. */
	private completeTask(task: ZenTask, notice?: string): void {
		this.timeouts.set(async () => {
			const index = this.tasks.indexOf(task);
			if (index < 0) return;
			await this.plugin.dailyNotes.manageTask(task.content, task.header, "complete", task.filePath);
			this.tasks.splice(index, 1);
			await this.plugin.saveSettings();
			this.refresh();
			if (notice) new Notice(notice);
		}, COMPLETION_FEEDBACK_MS);
	}
}
