import type {PythonKernel} from "./pythonKernel";
import {createPythonKernel} from "./pythonKernel";

/** One kernel per canvas (key = canvas file path). */
const kernels = new Map<string, PythonKernel>();

export function getKernelForCanvas(canvasKey: string, pythonPath: string, condaEnv?: string): PythonKernel {
	let k = kernels.get(canvasKey);
	if (!k) {
		k = createPythonKernel(pythonPath, condaEnv?.trim() || undefined);
		kernels.set(canvasKey, k);
	}
	return k;
}

export function terminateKernel(canvasKey: string): void {
	const k = kernels.get(canvasKey);
	if (k) {
		k.terminate();
		kernels.delete(canvasKey);
	}
}

export function terminateAllKernels(): void {
	for (const k of kernels.values()) k.terminate();
	kernels.clear();
}
