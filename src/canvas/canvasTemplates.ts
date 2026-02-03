import {TFile, Vault, normalizePath} from "obsidian";
import type {CanvasData} from "./types";
import {loadCanvasData, saveCanvasData} from "./nodes";

/**
 * List all canvas files in the template folder.
 * Returns an array of canvas file paths relative to vault root.
 */
export async function listCanvasTemplates(
	vault: Vault,
	templateFolder: string
): Promise<TFile[]> {
	if (!templateFolder || templateFolder.trim() === "") return [];

	const normalizedFolder = normalizePath(templateFolder);
	const folder = vault.getAbstractFileByPath(normalizedFolder);

	if (!folder || !(folder instanceof vault.adapter.constructor)) {
		// Not a folder
		return [];
	}

	const canvasFiles: TFile[] = [];

	// Recursively find all .canvas files in the folder
	const files = vault.getFiles();
	for (const file of files) {
		if (file.extension === "canvas" && file.path.startsWith(normalizedFolder + "/")) {
			canvasFiles.push(file);
		}
	}

	return canvasFiles;
}

/**
 * Check if a canvas path is in the template folder.
 */
export function isCanvasInTemplateFolder(
	canvasPath: string,
	templateFolder: string
): boolean {
	if (!templateFolder || !canvasPath) return false;
	const normalizedFolder = normalizePath(templateFolder);
	const normalizedPath = normalizePath(canvasPath);
	return normalizedPath.startsWith(normalizedFolder + "/");
}

/**
 * Duplicate a canvas to a target folder.
 * Creates a new canvas file with a unique name and copies all nodes and edges.
 * Returns the path of the new canvas file, or null if failed.
 */
async function duplicateCanvasToFolder(
	vault: Vault,
	sourcePath: string,
	targetFolder: string,
	baseName?: string
): Promise<string | null> {
	// Load the source canvas data
	const sourceData = await loadCanvasData(vault, sourcePath);
	if (!sourceData) return null;

	// Determine the base name for the new canvas
	const sourceFile = vault.getAbstractFileByPath(sourcePath);
	if (!sourceFile || !(sourceFile instanceof TFile)) return null;

	const nameBase = baseName || sourceFile.basename;

	// Determine the output path
	const targetFolderNormalized = targetFolder ? normalizePath(targetFolder) : "";
	let outputPath: string;
	let counter = 0;

	// Find a unique name
	while (true) {
		const fileName = counter === 0 ? `${nameBase}.canvas` : `${nameBase} ${counter}.canvas`;
		outputPath = targetFolderNormalized
			? normalizePath(`${targetFolderNormalized}/${fileName}`)
			: normalizePath(fileName);

		if (!vault.getAbstractFileByPath(outputPath)) break;
		counter += 1;

		// Safety: prevent infinite loop
		if (counter > 1000) return null;
	}

	// Ensure the target folder exists
	if (targetFolderNormalized) {
		const folder = vault.getAbstractFileByPath(targetFolderNormalized);
		if (!folder) {
			try {
				await vault.createFolder(targetFolderNormalized);
			} catch (e) {
				console.error("Failed to create target folder:", e);
				return null;
			}
		}
	}

	// Create a deep copy of the canvas data to avoid mutation
	const newCanvasData: CanvasData = {
		nodes: sourceData.nodes.map((node) => ({ ...node })),
		edges: sourceData.edges.map((edge) => ({ ...edge })),
	};

	// Save the new canvas
	const success = await saveCanvasData(vault, outputPath, newCanvasData);
	if (!success) return null;

	return outputPath;
}

/**
 * Duplicate a canvas template to the output folder.
 * Creates a new canvas file with a unique name and copies all nodes and edges.
 * Returns the path of the new canvas file, or null if failed.
 */
export async function duplicateCanvasTemplate(
	vault: Vault,
	templatePath: string,
	outputFolder: string,
	baseName?: string
): Promise<string | null> {
	return duplicateCanvasToFolder(vault, templatePath, outputFolder, baseName);
}

/**
 * Save current canvas as a template by duplicating it to the template folder.
 * Returns the path of the new template file, or null if failed.
 */
export async function saveCanvasAsTemplate(
	vault: Vault,
	currentCanvasPath: string,
	templateFolder: string
): Promise<string | null> {
	if (!templateFolder || templateFolder.trim() === "") return null;
	return duplicateCanvasToFolder(vault, currentCanvasPath, templateFolder);
}
