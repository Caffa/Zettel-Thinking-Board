import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		setupFiles: [],
		globals: false,
	},
	resolve: {
		alias: {
			obsidian: path.resolve(dirname, "src/__mocks__/obsidian.ts"),
			"obsidian/canvas": path.resolve(dirname, "src/__mocks__/obsidian-canvas.ts"),
		},
	},
});
