// Pyodide worker

importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");

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

  const { get } = await import(
    "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js"
  );

  try {
    const pyodide = await pyodidePromise;

    const directoryHandle = await get("webPythonDirectoryHandle");

    pyodide.setInterruptBuffer(interruptBuffer);

    pyodide.setStdout({ batched: sendStdout });
    pyodide.setStderr({ batched: sendStderr });

    nativefsPromise = pyodide.mountNativeFS("/home/pyodide/", directoryHandle);

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

  const nativefs = await nativefsPromise;

  try {
    await nativefs.syncfs();

    await pyodide.loadPackage("micropip");
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

    await pyodide.loadPackagesFromImports(python);
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
