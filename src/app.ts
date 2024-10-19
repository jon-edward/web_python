// Defines state-changing App methods and calls render callback with appropriate
// proxy on state change.

import { set } from "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js";
import { showDirectoryPicker } from "https://cdn.jsdelivr.net/npm/file-system-access/lib/es2018.js";

import PythonRunner from "./workers/python-runner";
import MypyTypeChecker, { MypyResult } from "./workers/mypy-type-checker";

// Stdout is potentially changed *very* frequently, making direct manipulation
// cheaper than passing this as state.
const stdout = document.getElementById("stdout")!;

await set("projectDirectoryHandle", undefined);
await set("entryPointHandle", undefined);

const mypyOutput = document.getElementById("mypy-output")!;

const stdoutResize = document.getElementById("stdout-resize")!;

let stdoutResizeSelected: boolean = false;

stdoutResize.addEventListener("mousedown", (_event) => {
  stdoutResizeSelected = true;
  document.body.addEventListener("mousemove", resizingMove);
  document.body.addEventListener("mouseup", finishResizing);
});

function resizingMove(event: MouseEvent) {
  if (stdoutResizeSelected) {
    const stdoutRect = stdout.getBoundingClientRect();
    stdout.style.width = `${event.clientX - stdoutRect.left - 25}px`;
  } else {
    finishResizing();
  }
}

const finishResizing = () => {
  stdoutResizeSelected = false;
  document.body.removeEventListener("mouseup", finishResizing);
  stdoutResize.removeEventListener("mousemove", resizingMove);
};

function showMypyOutput(output: MypyResult) {
  const mypyOutputHeader = document.createElement("span");
  mypyOutputHeader.textContent = `[mypy report @ ${new Date().toLocaleTimeString()}]\n\n`;

  const errorSpan = document.createElement("span");
  errorSpan.setAttribute("data-kind", output[2] ? "error" : "success");

  errorSpan.textContent = output[0] ? output[0] + "\n\n" : "";

  const infoSpan = document.createElement("span");
  infoSpan.setAttribute("data-kind", "warning");

  infoSpan.textContent = output[1];

  mypyOutput.textContent = "";

  mypyOutput.appendChild(mypyOutputHeader);
  mypyOutput.appendChild(errorSpan);
  mypyOutput.appendChild(infoSpan);
}

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

  private runnerWorker?: PythonRunner;
  private mypyTypeChecker: MypyTypeChecker;

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

    this.mypyTypeChecker = new MypyTypeChecker();
    this.mypyTypeChecker.typeCheckedCallback = showMypyOutput;
    this.mypyTypeChecker.typeCheckForever();

    (
      document.getElementById("mypy-run-checkbox") as HTMLInputElement
    ).onchange = (event: Event) => {
      const checked = (event.currentTarget as HTMLInputElement).checked;
      this.mypyTypeChecker.active = checked;

      mypyOutput.style.display = checked ? "block" : "none";
      stdoutResize.style.display = checked ? "block" : "none";
      stdout.style.width = checked ? "70%" : "100%";
    };
  }

  isStdoutScrolledDown(): boolean {
    return (
      Math.abs(stdout.scrollHeight - stdout.scrollTop - stdout.clientHeight) <
      10 // arbitrary tolerance
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

    this.runnerWorker = new PythonRunner();

    this.runnerWorker.stdoutFunc = (s) => this.stdoutFunc(s);
    this.runnerWorker.stderrFunc = (s) => this.stderrFunc(s);
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
      this.runnerWorker = new PythonRunner();
      this.runnerWorker.stdoutFunc = (s) => this.stdoutFunc(s);
      this.runnerWorker.stderrFunc = (s) => this.stderrFunc(s);
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

      const result = await this.runnerWorker.runPython(
        mainContent,
        this.state.entryPointName!.text
      );

      if (result.error) this.stderrFunc(result.error);
    } catch (e) {
      // Force new PyWorker creation on error.
      this.runnerWorker = undefined;
      console.error(e);
    } finally {
      this.state.running = false;
    }
  }
}
