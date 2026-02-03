import {App, Modal, Notice, Setting, TFile} from "obsidian";
import {listCanvasTemplates} from "../canvas/canvasTemplates";
import type {Vault} from "obsidian";

/**
 * Modal for selecting a canvas template to duplicate.
 * Displays a list of available templates from the configured template folder.
 */
export class CanvasTemplateModal extends Modal {
	private templateFolder: string;
	private onSelect: (templateFile: TFile) => void;
	private templates: TFile[] = [];

	constructor(
		app: App,
		templateFolder: string,
		onSelect: (templateFile: TFile) => void
	) {
		super(app);
		this.templateFolder = templateFolder;
		this.onSelect = onSelect;
	}

	async onOpen(): Promise<void> {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass("ztb-template-modal");

		contentEl.createEl("h2", {text: "Select canvas template"});

		// Load templates
		this.templates = await listCanvasTemplates(this.app.vault, this.templateFolder);

		if (this.templates.length === 0) {
			const msg = contentEl.createDiv({cls: "ztb-template-modal-empty"});
			msg.createEl("p", {text: "No canvas templates found."});
			msg.createEl("p", {
				text: `Make sure you have .canvas files in the folder: ${this.templateFolder}`,
				cls: "setting-item-description",
			});

			const btnContainer = contentEl.createDiv({cls: "ztb-template-modal-buttons"});
			const closeBtn = btnContainer.createEl("button", {text: "Close"});
			closeBtn.addEventListener("click", () => this.close());
			return;
		}

		const listEl = contentEl.createDiv({cls: "ztb-template-modal-list"});

		for (const template of this.templates) {
			const item = listEl.createDiv({cls: "ztb-template-modal-item"});
			
			const nameEl = item.createDiv({cls: "ztb-template-modal-item-name"});
			nameEl.setText(template.basename);

			const pathEl = item.createDiv({cls: "ztb-template-modal-item-path"});
			pathEl.setText(template.path);

			item.addEventListener("click", () => {
				this.onSelect(template);
				this.close();
			});

			// Hover effect
			item.addEventListener("mouseenter", () => {
				item.addClass("ztb-template-modal-item-hover");
			});
			item.addEventListener("mouseleave", () => {
				item.removeClass("ztb-template-modal-item-hover");
			});
		}

		const btnContainer = contentEl.createDiv({cls: "ztb-template-modal-buttons"});
		const cancelBtn = btnContainer.createEl("button", {text: "Cancel"});
		cancelBtn.addEventListener("click", () => this.close());
	}

	onClose(): void {
		const {contentEl} = this;
		contentEl.empty();
	}
}
