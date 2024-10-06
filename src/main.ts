// Main UI entry point.

import "./style.css";
import { showDirectoryPicker } from "https://cdn.jsdelivr.net/npm/file-system-access/lib/es2018.js";

const { set } = await import(
  "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js"
);

import PyWorker from "./py-worker/py-worker";

const projectDirectoryButton = document.getElementById(
  "project-directory"
) as HTMLButtonElement;

const projectDirectoryName = document.getElementById("project-directory-name")!;

const entryPointButton = document.getElementById(
  "entry-point"
) as HTMLButtonElement;

const entryPointName = document.getElementById("entry-point-name")!;

const runButton: HTMLButtonElement = document.getElementById(
  "run-button"
) as HTMLButtonElement;

const stopButton: HTMLButtonElement = document.getElementById(
  "stop-button"
) as HTMLButtonElement;

const stdout = document.getElementById("stdout")!;

let projectHandle: FileSystemDirectoryHandle | undefined;
let entryPointHandle: FileSystemFileHandle | undefined;

let running = false;

function projectDirectoryButtonDisabled() {
  return running;
}

function entryPointInputDisabled() {
  return running || projectHandle === undefined;
}

function runButtonDisabled() {
  return (
    running || projectHandle === undefined || entryPointHandle === undefined
  );
}

function checkDisabledElements() {
  projectDirectoryButton.disabled = projectDirectoryButtonDisabled();
  runButton.disabled = runButtonDisabled();
  entryPointButton.disabled = entryPointInputDisabled();
  stopButton.disabled = !running;
}

function setEntryPointEmpty() {
  if (entryPointHandle) {
    entryPointHandle = undefined;
  }

  entryPointName.textContent = "No file selected";
}

function setProjectHandleSuccess(dirHandle: FileSystemDirectoryHandle) {
  projectHandle = dirHandle;

  const successContent = document.createElement("span");
  successContent.textContent = dirHandle.name;
  successContent.classList.add("success");
  projectDirectoryName.innerHTML = successContent.outerHTML;
}

async function setEntryPointSuccess(
  fileHandle: FileSystemFileHandle,
  path: Array<string>
) {
  entryPointHandle = fileHandle;

  const successContent = document.createElement("span");
  successContent.textContent = path.join(" / ");
  successContent.classList.add("success");
  entryPointName.innerHTML = successContent.outerHTML;
}

function setEntryPointError(message: string) {
  entryPointHandle = undefined;

  const errorMessage = document.createElement("span");
  errorMessage.textContent = message;
  errorMessage.classList.add("error");
  entryPointName.innerHTML = errorMessage.outerHTML;
}

checkDisabledElements();

export class DirectoryNotWriteable extends Error {}

projectDirectoryButton.onclick = async () => {
  let handle;

  try {
    handle = await showDirectoryPicker({ mode: "readwrite" });

    if (!handle) return;

    if (
      !("requestPermission" in handle) ||
      (await handle.requestPermission({ mode: "readwrite" })) !== "granted"
    ) {
      throw new DirectoryNotWriteable(
        "This browser does not support writeable file system directory handles."
      );
    }
  } catch (e) {
    if (!(e instanceof DOMException)) throw e;
    // Cancelling raises a DOMException, treat every other
    // kind of error like normal.
  }

  if (!handle) return;

  if (projectHandle && (await projectHandle.isSameEntry(handle))) {
    return;
  }

  await set("webPythonDirectoryHandle", handle);

  setProjectHandleSuccess(handle);

  setEntryPointEmpty(); // Entry point should be invalidated, selected directory changed.
  checkDisabledElements();
};

entryPointButton.onclick = async () => {
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

  if (!projectHandle) throw new Error("Project handle is not defined.");

  const pathSegments = await projectHandle.resolve(fileHandle);

  if (!pathSegments) {
    setEntryPointError("Entry point provided not in project directory.");
    checkDisabledElements();
    return;
  }

  setEntryPointSuccess(fileHandle, pathSegments);
  checkDisabledElements();
};

function stdoutFunc(content: string) {
  const contentElem = document.createElement("span");
  contentElem.textContent = `${content}\n`;
  stdout.appendChild(contentElem);
}

function stderrFunc(content: string) {
  const contentElem = document.createElement("span");
  contentElem.classList.add("error");
  contentElem.textContent = content;
  stdout.appendChild(contentElem);
}

runButton.onclick = async () => {
  running = true;

  checkDisabledElements();

  stdout.textContent = "";

  try {
    const pyWorker = new PyWorker(stdoutFunc, stderrFunc);
    await pyWorker.init();

    stopButton.onclick = async () => {
      // Throw away interpreter, and redirect erroring to console.
      // This frees up the UI while the thread has time to stop.
      pyWorker.stderrFunc = console.log;
      pyWorker.stdoutFunc = console.error;
      running = false;
      checkDisabledElements();
      pyWorker.stop();
    };

    const mainContent = await (await entryPointHandle!.getFile()).text();
    await pyWorker.runPython(mainContent, entryPointHandle!.name);
  } finally {
    running = false;
    checkDisabledElements();
  }
};
