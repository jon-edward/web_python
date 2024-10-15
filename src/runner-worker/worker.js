// Pyodide worker

importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");

const idbKeyvalPromise = import(
  "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js"
);

const pyodidePromise = loadPyodide();

const mountPoint = "/home/pyodide/";

/**
 * @typedef {Object} SetInterruptBufferMessage
 * @property {"set-interrupt-buffer"} kind
 * @property {number} id
 * @property {SharedArrayBuffer} buffer
 *
 * @typedef {Object} RunMessage
 * @property {"run"} kind
 * @property {number} id
 * @property {string} python
 * @property {string | undefined} filename
 */

/**
 * @param {string} stdout
 */
function sendStdout(stdout) {
  self.postMessage({ kind: "stdout", stdout });
}

/**
 * @param {string} stderr
 */
function sendStderr(stderr) {
  self.postMessage({ kind: "stderr", stderr });
}

let nativefsPromise;

/**
 * @param {SetInterruptBufferMessage} message
 */
async function onSetInterruptBuffer(message) {
  const { interruptBuffer, id } = message;

  try {
    const pyodide = await pyodidePromise;

    pyodide.setInterruptBuffer(interruptBuffer);

    pyodide.setStdout({ batched: sendStdout });
    pyodide.setStderr({ batched: sendStderr });

    self.postMessage({ kind: "finished", id });
  } catch (e) {
    self.postMessage({
      kind: "error",
      error: error.message,
      id,
    });
  }
}

/**
 * @param {RunMessage} message
 */
async function onRun(message) {
  const pyodide = await pyodidePromise;
  const { python, id, filename } = message;

  const { get } = await idbKeyvalPromise;

  const directoryHandle = await get("projectDirectoryHandle");

  const nativefs = await pyodide.mountNativeFS(mountPoint, directoryHandle);

  try {
    await pyodide.loadPackage("micropip");

    // Install all requirements
    await pyodide.runPythonAsync(
      `
        import micropip 
        import pathlib

        req_f = pathlib.Path("requirements.txt")

        reqs = []

        if req_f.is_file():
          reqs = [x.strip() for x in open("requirements.txt", "r").readlines() if x.strip()]
          await micropip.install(reqs, keep_going=True)
      `
    );

    // Delete imported modules if they originate from project directory
    await pyodide.runPythonAsync(
      `
        import sys

        for name, module in list(sys.modules.items()):
          if not hasattr(module, "__file__") or not module.__file__:
            continue
          
          if module.__file__.startswith("${mountPoint}"):
            del sys.modules[name]
      `
    );

    await pyodide.loadPackagesFromImports(python);

    // Run Python and send uncaught errors to stderr.
    const result = await pyodide
      .runPythonAsync(python, { filename })
      .catch(async () => {
        sendStderr(
          await pyodide.runPythonAsync(
            `
              import sys
              import traceback
              exc_lines = list(traceback.format_exception(sys.last_exc))
              '\\n'.join(exc_lines[:1] + exc_lines[3:])  # Excludes Pyodide traceback
            `
          )
        );
      });

    self.postMessage({ kind: "finished", result, id });
  } catch (error) {
    self.postMessage({
      kind: "error",
      error: error.message,
      id,
    });
  } finally {
    await nativefs.syncfs();

    // To see remote changes that occur between the end of this run
    // and the start of the next run, the mounted directory needs to be
    // remounted.
    pyodide.FS.unmount(mountPoint);
    await nativefs.syncfs();
  }
}

/**
 * @param {MessageEvent<SetInterruptBufferMessage | RunMessage>} event
 */
self.onmessage = async (event) => {
  const { data } = event;

  switch (data.kind) {
    case "set-interrupt-buffer":
      // Initialize interpreter with interrupt buffer.
      onSetInterruptBuffer(data);
      break;
    case "run":
      // Run some code.
      onRun(data);
      break;
  }
};
