// Defines state-changing App methods and calls render callback with appropriate
// proxy on state change.

import { set } from "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js";
import { showDirectoryPicker } from "https://cdn.jsdelivr.net/npm/file-system-access/lib/es2018.js";
import RunnerWorker from "./runner-worker/runner-worker";

// Stdout is potentially changed *very* frequently, making direct manipulation
// cheaper than passing this as state.
const stdout = document.getElementById("stdout")!;

export type StyledText = {
  readonly text: string;
  readonly kind?: "success" | "error";
};

export type ReadonlyAppState = {
  readonly running: boolean;
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
  private runnerWorker?: RunnerWorker;

  readonly readonlyState: ReadonlyAppState;

  constructor(renderCallback: (state: ReadonlyAppState) => void) {
    const state: AppState = {
      running: false,
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

  isStdoutScrolledDown(): boolean {
    return (
      Math.abs(stdout.scrollHeight - stdout.scrollTop - stdout.clientHeight) <
      10 // arbitrary tolerance, 10 works pretty well
    );
  }

  private stdoutFunc(text: string) {
    const isScrolled = this.isStdoutScrolledDown();
    const contentElem = document.createElement("span");
    contentElem.textContent = `${text}\n`;
    stdout.appendChild(contentElem);
    if (isScrolled) stdout.scrollTop = stdout.scrollHeight;
  }

  private stderrFunc(text: string) {
    const isScrolled = this.isStdoutScrolledDown();
    const contentElem = document.createElement("span");
    contentElem.textContent = `${text}\n`;
    contentElem.setAttribute("data-kind", "error");
    stdout.appendChild(contentElem);
    if (isScrolled) if (isScrolled) stdout.scrollTop = stdout.scrollHeight;
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

    this.runnerWorker = new RunnerWorker(
      (s) => this.stdoutFunc(s),
      (s) => this.stderrFunc(s)
    );
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
      text: pathSegments.join("/"),
    };
  }

  async run() {
    this.state.running = true;

    if (this.runnerWorker === undefined) {
      this.runnerWorker = new RunnerWorker(
        (s) => this.stdoutFunc(s),
        (s) => this.stderrFunc(s)
      );
    }

    try {
      document.getElementById("stop-button")!.onclick = async () => {
        // Throw away interpreter, and redirect erroring to console.
        // This frees up the UI while the thread has time to stop.
        if (this.runnerWorker === undefined) return;

        this.runnerWorker.stdoutFunc = (_s) => {};
        this.runnerWorker.stderrFunc = (_s) => {};
        this.state.running = false;
        this.runnerWorker.stop();

        this.runnerWorker = undefined;
      };

      const mainContent = await (
        await this.state.entryPointHandle!.getFile()
      ).text();

      await this.runnerWorker.runPython(
        mainContent,
        this.state.entryPointName!.text
      );
    } catch (e) {
      // Force new PyWorker creation on error.
      this.runnerWorker = undefined;
      console.error(e);
    } finally {
      this.state.running = false;
    }
  }
}
