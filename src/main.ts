// Main UI entry point.

import "./style.css";

import { App, ReadonlyAppState } from "./app";

export const appElements = {
  projectDirectoryButton: document.getElementById(
    "project-directory"
  ) as HTMLButtonElement,
  projectDirectoryName: document.getElementById("project-directory-name")!,
  entryPointButton: document.getElementById("entry-point") as HTMLButtonElement,
  entryPointName: document.getElementById("entry-point-name")!,
  runButton: document.getElementById("run-button") as HTMLButtonElement,
  stopButton: document.getElementById("stop-button") as HTMLButtonElement,
  clearButton: document.getElementById("clear-button") as HTMLButtonElement,
  stdout: document.getElementById("stdout")!,
  errorMessage: document.getElementById("error-message")!,
};

const app = new App(render);

appElements.projectDirectoryButton.onclick = async () =>
  await app.requestProjectDirectory();

appElements.entryPointButton.onclick = async () =>
  await app.requestEntryPoint();

appElements.runButton.onclick = async () => await app.run();

render(app.readonlyState);

function setDisabled(state: ReadonlyAppState) {
  if (state.appErrorMessage) {
    appElements.projectDirectoryButton.disabled = true;
    appElements.entryPointButton.disabled = true;
    appElements.runButton.disabled = true;
    appElements.stopButton.disabled = true;
    appElements.clearButton.disabled = true;
    return;
  }

  appElements.clearButton.disabled = false;

  if (state.running) {
    appElements.projectDirectoryButton.disabled = true;
    appElements.entryPointButton.disabled = true;
    appElements.runButton.disabled = true;
    appElements.stopButton.disabled = false;
    return;
  }

  appElements.stopButton.disabled = true;

  appElements.projectDirectoryButton.disabled = false;

  appElements.entryPointButton.disabled =
    state.projectDirectoryHandle === undefined;

  appElements.runButton.disabled =
    !state.entryPointHandle || !state.projectDirectoryHandle;
}

function render(state: ReadonlyAppState) {
  setDisabled(state);

  if (state.appErrorMessage) {
    appElements.errorMessage.textContent = state.appErrorMessage;
    return;
  }

  if (state.entryPointName) {
    appElements.entryPointName.setAttribute(
      "data-kind",
      state.entryPointName.kind!
    );
    appElements.entryPointName.textContent = state.entryPointName.text;
  } else {
    appElements.entryPointName.setAttribute("data-kind", "");
    appElements.entryPointName.textContent = "No file selected";
  }

  if (state.projectDirectoryHandle) {
    appElements.projectDirectoryName.setAttribute("data-kind", "success");
    appElements.projectDirectoryName.textContent =
      state.projectDirectoryHandle.name;
  } else {
    appElements.projectDirectoryName.setAttribute("data-kind", "");
    appElements.projectDirectoryName.textContent = "No directory selected";
  }

  const dummy = document.createElement("div");

  for (const line of state.stdoutLines) {
    const lineElem = document.createElement("span");
    if (line.kind === "error") {
      lineElem.setAttribute("data-kind", "error");
    }
    lineElem.textContent = `${line.text}\n`;
    dummy.appendChild(lineElem);
  }

  appElements.stdout.innerHTML = dummy.innerHTML;
}
