/** Stub prepended to user Python script so obsidian_log() is available. Writes to stderr with OBSIDIAN_LOG prefix for side panel. */
export const OBSIDIAN_LOG_STUB = `
import sys
def obsidian_log(*args):
    msg = " ".join(str(a) for a in args)
    print("OBSIDIAN_LOG:" + msg, file=sys.stderr, flush=True)
`;

const END_MARKER = "__ZTB_END__";

export interface PythonKernel {
	run(code: string, inputText: string): Promise<string>;
	onLog?: ((line: string) => void) | undefined;
	onError?: ((message: string) => void) | undefined;
	terminate(): void;
}

function reportError(onError: ((message: string) => void) | undefined, err: Error): void {
	const msg = err?.message ?? String(err);
	onError?.(msg);
}

export function createPythonKernel(pythonPath: string, condaEnv?: string): PythonKernel {
	let child: import("child_process").ChildProcess | null = null;
	let onLogCb: ((line: string) => void) | undefined;
	let onErrorCb: ((message: string) => void) | undefined;
	let pendingResolve: ((value: string) => void) | null = null;
	let pendingReject: ((err: Error) => void) | null = null;
	let stdoutBuf = "";

	function spawnProcess(): Promise<void> {
		if (child) return Promise.resolve();
		return new Promise((resolve, reject) => {
			try {
				const { spawn } = require("child_process") as typeof import("child_process");
				const exec = (condaEnv && condaEnv.trim())
					? "conda"
					: (pythonPath || "python3");
				const args = (condaEnv && condaEnv.trim())
					? ["run", "-n", condaEnv.trim(), "--no-capture-output", pythonPath || "python", "-u", "-i"]
					: ["-u", "-i"];
				child = spawn(exec, args, {
					stdio: ["pipe", "pipe", "pipe"],
					shell: false,
				});
				child.stdout?.on("data", (chunk: Buffer) => {
					const s = chunk.toString();
					stdoutBuf += s;
					if (stdoutBuf.includes(END_MARKER)) {
						const parts = stdoutBuf.split(END_MARKER);
						stdoutBuf = parts.pop() ?? "";
						const result = parts.join(END_MARKER).trim();
						if (pendingResolve) {
							pendingResolve(result);
							pendingResolve = null;
							pendingReject = null;
						}
					}
				});
				child.stderr?.on("data", (chunk: Buffer) => {
					const s = chunk.toString();
					const lines = s.split("\n");
					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed) continue;
						if (line.startsWith("OBSIDIAN_LOG:")) {
							onLogCb?.(line.slice("OBSIDIAN_LOG:".length).trim());
						} else {
							onErrorCb?.(trimmed);
						}
					}
				});
				child.on("error", (err) => {
					reportError(onErrorCb, err);
					reject(err);
				});
				child.on("exit", (code) => {
					child = null;
					if (pendingReject) {
						const err = new Error(`Python exited with code ${code ?? "unknown"}`);
						reportError(onErrorCb, err);
						pendingReject(err);
						pendingResolve = null;
						pendingReject = null;
					}
				});
				// Allow process to start
				setTimeout(() => resolve(), 100);
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e));
				reportError(onErrorCb, err);
				reject(e);
			}
		});
	}

	async function run(code: string, inputText: string): Promise<string> {
		await spawnProcess();
		if (!child?.stdin) throw new Error("Python process not running");
		const fullCode =
			OBSIDIAN_LOG_STUB +
			"\ninput = " +
			JSON.stringify(inputText) +
			"\n\n" +
			code +
			"\nprint(" +
			JSON.stringify(END_MARKER) +
			")\n";
		// Encode as base64 so we can send without escaping issues
		const b64 = Buffer.from(fullCode, "utf-8").toString("base64");
		const payload = `exec(__import__('base64').b64decode("${b64}").decode())\n`;
		stdoutBuf = "";
		return new Promise((resolve, reject) => {
			pendingResolve = resolve;
			pendingReject = reject;
			child!.stdin!.write(payload, (err) => {
				if (err) {
					reportError(onErrorCb, err);
					pendingReject?.(err);
					pendingResolve = null;
					pendingReject = null;
				}
			});
			setTimeout(() => {
				if (pendingReject) {
					const timeoutErr = new Error("Python execution timeout (60s)");
					reportError(onErrorCb, timeoutErr);
					pendingReject(timeoutErr);
					pendingResolve = null;
					pendingReject = null;
				}
			}, 60_000);
		});
	}

	return {
		get onLog() {
			return onLogCb;
		},
		set onLog(cb: ((line: string) => void) | undefined) {
			onLogCb = cb;
		},
		get onError() {
			return onErrorCb;
		},
		set onError(cb: ((message: string) => void) | undefined) {
			onErrorCb = cb;
		},
		run,
		terminate() {
			if (child) {
				child.kill();
				child = null;
			}
			if (pendingReject) {
				const err = new Error("Kernel terminated");
				reportError(onErrorCb, err);
				pendingReject(err);
				pendingResolve = null;
				pendingReject = null;
			}
		},
	};
}
