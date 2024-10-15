// Mypy worker.

importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js");

const idbKeyvalPromise = import(
  "https://unpkg.com/idb-keyval@5.0.2/dist/esm/index.js"
);

const waitDurationMillis = 1000;

const pyodidePromise = loadPyodide();

const mountPoint = "/home/pyodide/";

let running = false;

/**
 * @typedef {Object} SetInterruptBufferMessage
 * @property {"set-interrupt-buffer"} kind
 * @property {number} id
 * @property {SharedArrayBuffer} buffer
 *
 * @typedef {Object} RunForeverMessage
 * @property {"run"} kind
 * @property {number} id
 * @property {string} python
 * @property {string | undefined} filename
 */

/**
 * @param {PyProxy} mypyOutput
 */
function sendMypy(mypyOutput) {
  const mypy = [mypyOutput.get(0), mypyOutput.get(1), mypyOutput.get(2)];
  self.postMessage({ kind: "mypy", mypy });
}

async function sleep(millis) {
  await new Promise((r) => setTimeout(r, millis));
}

async function mypyForever() {
  const pyodide = await pyodidePromise;
  const { get } = await idbKeyvalPromise;

  let nativefs;

  let lastHex = "";

  async function checkChanged() {
    const newHex = await pyodide.runPythonAsync(`
        import hashlib
        from pathlib import Path

        paths = list(str(s) for s in Path("./").glob("**/*.py"))
        paths.sort()

        py_hash = hashlib.md5()

        for path in paths:
          with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                py_hash.update(chunk)
        
        try:
          py_hash.hexdigest()
        except Exception as e:
          print(e)
      `);

    if (lastHex === newHex) return false;
    lastHex = newHex;
    return true;
  }

  while (running) {
    try {
      const directoryHandle = await get("projectDirectoryHandle");

      if (!directoryHandle) {
        await sleep(waitDurationMillis);
        continue;
      }

      nativefs = await pyodide.mountNativeFS(mountPoint, directoryHandle);
      await nativefs.syncfs();

      if (!(await checkChanged())) {
        await sleep(waitDurationMillis);
        continue;
      }

      await pyodide.loadPackage("micropip");
      await pyodide.loadPackage("typing-extensions");
      await pyodide.loadPackage("mypy");

      // Install all requirements
      await pyodide.runPythonAsync(
        `
          import micropip 
          import pathlib

          await micropip.install("mypy_extensions")

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

      sendMypy(
        await pyodide.runPythonAsync(
          `
            from mypy.api import run
            run(["${mountPoint}"])
          `
        )
      );
    } catch (e) {
      console.error(`Error at mypy worker: ${e}`);
    } finally {
      await sleep(waitDurationMillis);

      pyodide.FS.unmount(mountPoint);
      await nativefs.syncfs();
    }
  }
}

self.onmessage = async (event) => {
  const { data } = event;

  switch (data.kind) {
    case "start":
      if (!running) {
        running = true;
        await mypyForever();
      }
      break;
    case "stop":
      running = false;
      break;
  }
};
