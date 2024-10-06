# web_python

This is a browser-based Python interpreter (using
[Pyodide](https://pyodide.org/en/stable/)) which allows the user to mount
a local project directory and run an entry point script from within the
directory.

## Building from source

```bash
npm install
npm run build
```

## Notes

Mounting a local directory is currently only available in
**Chromium-based browsers** (ie. Chrome, Edge), which means
this will likely not work on other browsers. Progress toward making this
widely available is on [MDN's Web Docs](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemHandle/requestPermission).

The interpreter is run within a web worker, and stdout/stderr is handled
through messages between the main running thread and the worker. This is
convenient for keeping the main thread open for UI, but makes print
operations relatively slow; because of this, you may want to write logs to
a file instead of feeding it all to the console for large amounts of
logging.

Lines of `requirements.txt` (if it exists in the project
directory) are fed directory to `micropip.install`, which
allows for very simple package installation when a pure Python wheel is
available. See [packages built by Pyodide](https://pyodide.org/en/stable/usage/packages-in-pyodide.html)
for some common packages which don't have a pure Python wheel.
