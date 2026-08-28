import { Notice, setIcon } from "obsidian";
import type ZenZonePlugin from "../main";
import { DomListenerRegistry, TimeoutRegistry } from "../dom";
import { ZenTask } from "../types";

/** How long the checkbox stays ticked before the task disappears. */
const COMPLETION_FEEDBACK_MS = 500;

const DEFAULT_LIST_HEIGHT = "200px";

/**
 * The task card: the current focus task, an input to add tasks, and the
 * reorderable backlog. It owns its own listeners so a re-render detaches only
 * its own handlers and leaves the rest of the view working.
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

		this.listeners.add(listWrapper, "dragover", (event) => this.allowDrop(event));
		this.listeners.add(listWrapper, "drop", (event) => {
			event.preventDefault();
			// Dropping on the empty area below the rows sends the task to the end.
			if (event.target === listWrapper) void this.moveTask(this.tasks.length - 1);
		});

		this.tasks.forEach((task, index) => this.renderRow(listWrapper, task, index));
	}

	private renderRow(listWrapper: HTMLElement, task: ZenTask, index: number): void {
		const row = listWrapper.createDiv({ cls: "zen-task-row" });
		row.draggable = true;

		this.listeners.add(row, "dragstart", (event) => {
			this.dragSrcIndex = index;
			row.addClass("is-dragging");
			const transfer = (event as DragEvent).dataTransfer;
			if (transfer) {
				transfer.effectAllowed = "move";
				transfer.setData("text/plain", index.toString());
			}
		});
		this.listeners.add(row, "dragover", (event) => this.allowDrop(event));
		this.listeners.add(row, "drop", (event) => {
			event.stopPropagation();
			void this.moveTask(index);
		});
		this.listeners.add(row, "dragend", () => {
			row.removeClass("is-dragging");
			this.dragSrcIndex = -1;
		});

		const checkbox = row.createEl("input", { type: "checkbox", cls: "zen-task-cb" });
		checkbox.checked = false;
		this.listeners.add(checkbox, "click", () => {
			checkbox.checked = true;
			row.addClass("is-completed");
			this.completeTask(task);
		});

		const text = row.createSpan({ cls: "zen-task-text", text: task.content });
		if (task.header) {
			text.createSpan({ text: ` #${task.header}`, cls: "zen-task-header-tag" });
		}

		this.renderRowControls(row, task, index);
	}

	private renderRowControls(row: HTMLElement, task: ZenTask, index: number): void {
		const controls = row.createDiv({ cls: "zen-task-row-controls" });

		if (index > 0) {
			this.addControl(controls, "arrow-up", "Move up", () => this.swapTasks(index, index - 1));
		}
		if (index < this.tasks.length - 1) {
			this.addControl(controls, "arrow-down", "Move down", () => this.swapTasks(index, index + 1));
		}
		this.addControl(controls, "trash", "Delete", async () => {
			await this.plugin.dailyNotes.manageTask(task.content, task.header, "delete", task.filePath);
			this.tasks.splice(index, 1);
			await this.plugin.saveSettings();
			this.refresh();
		}, "is-danger");
	}

	private addControl(
		parent: HTMLElement,
		icon: string,
		tooltip: string,
		onClick: () => Promise<void>,
		extraClass = ""
	): void {
		const btn = parent.createEl("button", { cls: `zen-task-control-btn ${extraClass}`.trim() });
		setIcon(btn, icon);
		btn.title = tooltip;
		this.listeners.add(btn, "click", () => void onClick());
	}

	// --- Mutations -------------------------------------------------------

	private allowDrop(event: Event): void {
		event.preventDefault();
		const transfer = (event as DragEvent).dataTransfer;
		if (transfer) transfer.dropEffect = "move";
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
