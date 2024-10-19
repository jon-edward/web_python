// Pyodide webworker script.
//
// Defines functionality which can be used by different APIs.

importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");

const idbKeyvalPromise = import(
  "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js"
);

const pyodidePromise = loadPyodide();

const mountPoint = "/home/pyodide/";

/**
 * @typedef {Object} InitMessage
 * @property {"init"} kind
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

/**
 * @param {SetInterruptBufferMessage} message
 */
async function onInit(message) {
  const { interruptBuffer, id } = message;

  try {
    const pyodide = await pyodidePromise;

    pyodide.setInterruptBuffer(interruptBuffer);

    pyodide.setStdout({ batched: sendStdout });
    pyodide.setStderr({ batched: sendStderr });

    self.postMessage({ kind: "finished", id });
  } catch (e) {
    self.postMessage({
      kind: "finished",
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

  let nativefs;

  if (directoryHandle) {
    nativefs = await pyodide.mountNativeFS(mountPoint, directoryHandle);
  }

  const loadPackagesOptions = { messageCallback: (_s) => {} };

  await pyodide.loadPackage("micropip", loadPackagesOptions);

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

  await pyodide.loadPackagesFromImports(python, loadPackagesOptions);

  let result;
  let error;

  // Run Python and send uncaught errors to stderr, excluding Pyodide runner errors.
  try {
    if (filename) {
      result = await pyodide.runPythonAsync(python, { filename });
    } else {
      result = await pyodide.runPythonAsync(python);
    }
  } catch {
    error = await pyodide.runPythonAsync(
      `
        import sys
        import traceback
        
        exc = sys.last_exc 
        tb = exc.__traceback__.tb_next.tb_next
        
        "".join(traceback.format_exception(None, value=exc, tb=tb))
      `
    );
  }

  if (nativefs !== undefined) {
    await nativefs.syncfs();

    // To see remote changes that occur between the end of this run
    // and the start of the next run, the mounted directory needs to be
    // remounted.
    pyodide.FS.unmount(mountPoint);
    await nativefs.syncfs();
  }

  self.postMessage({ kind: "finished", result, error, id });
}

/**
 * @param {MessageEvent<SetInterruptBufferMessage | RunMessage>} event
 */
self.onmessage = async (event) => {
  const { data } = event;

  switch (data.kind) {
    case "init":
      // Initialize interpreter with interrupt buffer and set io functions.
      onInit(data);
      break;
    case "run":
      // Run some code.
      onRun(data);
      break;
  }
};
