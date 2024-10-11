// Defines state-changing App methods and calls render callback with appropriate
// proxy on state change.

import { set } from "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js";
import { showDirectoryPicker } from "https://cdn.jsdelivr.net/npm/file-system-access/lib/es2018.js";
import PyWorker from "./py-worker/py-worker";

export type StyledText = {
  readonly text: string;
  readonly kind?: "success" | "error";
};

export type ReadonlyAppState = {
  readonly running: boolean;
  readonly stdoutLines: Array<StyledText>;
  readonly entryPointName?: StyledText;
  readonly appErrorMessage?: string;
  readonly projectDirectoryHandle?: FileSystemDirectoryHandle;
  readonly entryPointHandle?: FileSystemFileHandle;
};

type AppState = {
  -readonly [key in keyof ReadonlyAppState]: ReadonlyAppState[key];
};

export class App {
  private state: AppState;
  private pyWorkerPromise?: Promise<PyWorker>;
  private renderCallback: (state: ReadonlyAppState) => void;

  readonly readonlyState: ReadonlyAppState;

  constructor(renderCallback: (state: ReadonlyAppState) => void) {
    this.renderCallback = renderCallback;

    const state: AppState = {
      running: false,
      stdoutLines: [],
    };

    const readonlyState = new Proxy(state, {
      set(_obj, prop, _value) {
        throw new TypeError(
          `ReadonlyAppState's property ${String(prop)} cannot be reassigned.`
        );
      },
    });

    this.state = new Proxy(state, {
      set<K extends keyof typeof state>(
        obj: typeof state,
        prop: K,
        value: (typeof state)[K]
      ) {
        obj[prop] = value;
        renderCallback(readonlyState);
        return true;
      },
    });

    this.readonlyState = readonlyState;
  }

  private stdoutFunc(text: string) {
    this.state.stdoutLines.push({ text });
    this.renderCallback(this.readonlyState);
  }

  private stderrFunc(text: string) {
    this.state.stdoutLines.push({ kind: "error", text });
    this.renderCallback(this.readonlyState);
  }

  private async initializedPyWorker(): Promise<PyWorker> {
    const worker = new PyWorker(
      (s) => this.stdoutFunc(s),
      (s) => this.stderrFunc(s)
    );
    await worker.init();
    return worker;
  }

  async requestProjectDirectory() {
    let handle;

    try {
      handle = await showDirectoryPicker({ mode: "readwrite" });

      if (!handle) {
        return;
      }

      if (
        !("requestPermission" in handle) ||
        (await handle.requestPermission({ mode: "readwrite" })) !== "granted"
      ) {
        this.state.appErrorMessage =
          "This browser does not support writable file system directory handles.";
        return;
      }
    } catch (e) {
      if (!(e instanceof DOMException)) {
        this.state.appErrorMessage =
          "Error encountered. Check developer console.";
        throw e;
      }
      // Cancelling raises a DOMException, treat every other
      // kind of error like normal.
    }

    if (!handle) return;

    if (
      this.state.projectDirectoryHandle &&
      (await this.state.projectDirectoryHandle.isSameEntry(handle))
    ) {
      return;
    }

    await set("projectDirectoryHandle", handle);
    this.state.projectDirectoryHandle = handle;
    this.state.entryPointHandle = undefined;
    this.state.entryPointName = undefined;
    // Clear entry point location on
    // project directory change.

    this.pyWorkerPromise = this.initializedPyWorker();
  }

  async requestEntryPoint() {
    const pickerOpts: OpenFilePickerOptions = {
      types: [
        {
          description: "Entry point script",
          accept: { "text/x-python": [".py"] },
        },
      ],
      excludeAcceptAllOption: true,
      multiple: false,
    };

    const [fileHandle] = await window.showOpenFilePicker(pickerOpts);

    if (!this.state.projectDirectoryHandle)
      throw new Error("Project handle is not defined.");

    const pathSegments = await this.state.projectDirectoryHandle.resolve(
      fileHandle
    );

    if (!pathSegments) {
      this.state.entryPointName = {
        kind: "error",
        text: "Entry point provided not in project directory.",
      };
      return;
    }

    await set("entryPointHandle", fileHandle);
    this.state.entryPointHandle = fileHandle;

    this.state.entryPointName = {
      kind: "success",
      text: pathSegments.join(" / "),
    };
  }

  async run() {
    this.state.running = true;

    this.state.stdoutLines = [];

    let pyWorker;

    if (this.pyWorkerPromise !== undefined) {
      pyWorker = await this.pyWorkerPromise;
    } else {
      pyWorker = await this.initializedPyWorker();
    }

    try {
      document.getElementById("stop-button")!.onclick = async () => {
        // Throw away interpreter, and redirect erroring to console.
        // This frees up the UI while the thread has time to stop.
        pyWorker.stderrFunc = console.log;
        pyWorker.stdoutFunc = console.error;
        this.state.running = false;
        pyWorker.stop();
      };

      const mainContent = await (
        await this.state.entryPointHandle!.getFile()
      ).text();

      await pyWorker.runPython(mainContent, this.state.entryPointHandle!.name);
    } catch (e) {
      // Force new PyWorker creation on uncaught error.
      this.pyWorkerPromise = undefined;
      console.error(e);
    } finally {
      this.state.running = false;
    }
  }
}
