// Pyodide worker

importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");

const idbKeyvalPromise = import(
  "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js"
);

const pyodidePromise = loadPyodide();

function sendStdout(stdout) {
  self.postMessage({ kind: "stdout", stdout });
}

function sendStderr(stderr) {
  self.postMessage({ kind: "stderr", stderr });
}

let nativefsPromise;

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
      kind: "error",
      error: error.message,
      id,
    });
  }
}

async function onRun(message) {
  const pyodide = await pyodidePromise;
  const { python, id, filename } = message;

  const { get } = await idbKeyvalPromise;

  let nativefs;

  try {
    const directoryHandle = await get("projectDirectoryHandle");

    nativefs = await pyodide.mountNativeFS("/home/pyodide/", directoryHandle);

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
          await micropip.install(reqs, keep_going=True)`
    );

    // Delete imported modules if they originate from project directory
    await pyodide.runPythonAsync(
      `
        import sys

        for name, module in list(sys.modules.items()):
          if hasattr(module, "__file__") and module.__file__ and module.__file__.startswith("/home/pyodide/"):
            del sys.modules[name]
      `
    );

    await pyodide.loadPackagesFromImports(python);

    // Run Python and send uncaught errors to stderr.
    await pyodide.runPythonAsync(python, { filename }).catch(async () => {
      sendStderr(
        await pyodide.runPythonAsync(
          "import sys; import traceback; '\\n'.join(traceback.format_exception(sys.last_exc))"
        )
      );
    });

    self.postMessage({ kind: "finished", id });
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
    // remounted
    pyodide.FS.unmount("/home/pyodide/");
  }
}

self.onmessage = async (event) => {
  const { data } = event;

  switch (data.kind) {
    case "init":
      // Initialize interpreter with interrupt buffer.
      onInit(data);
      break;
    case "run":
      // Run some code.
      onRun(data);
      break;
  }
};
