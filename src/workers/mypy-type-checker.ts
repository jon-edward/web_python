// Mypy worker API

import WorkerApi, { StderrMessage, StdoutMessage } from "./worker-api";

export type MypyResult = [string, string, number];

async function delay(millis: number) {
  return new Promise((res) => setTimeout(res, millis));
}

export default class MypyTypeChecker extends WorkerApi {
  private projectHash?: string | undefined;

  active: boolean = true;

  onStderr(_message: StderrMessage): void {}
  onStdout(_message: StdoutMessage): void {}

  typeCheckedCallback = (_mypyResult: MypyResult) => {};

  private async getProjectDirectoryHash(): Promise<string> {
    const pythonResult = await this.runPython(
      `
        import hashlib
        from pathlib import Path

        paths = list(str(s) for s in Path("./").glob("**/*.py"))
        paths.sort()

        if not paths:
          raise Exception("No Python source files.")

        py_hash = hashlib.md5()

        for path in paths:
          with open(path, 'rb') as f:
            for chunk in iter(lambda: f.read(65536), b''):
                py_hash.update(chunk)
        
        py_hash.hexdigest()
      `
    );

    if (pythonResult.error) return "";

    return pythonResult.result!;
  }

  private async projectDirectoryHasChanged(): Promise<boolean> {
    const currentHash = await this.getProjectDirectoryHash();

    if (currentHash === this.projectHash) {
      return false;
    }

    this.projectHash = currentHash;
    return true;
  }

  async typeCheckProjectDirectory() {
    if (!(await this.projectDirectoryHasChanged())) {
      return;
    }

    if (this.projectHash === undefined) {
      this.typeCheckedCallback(["", "No directory selected", 1]);
      return;
    }

    if (this.projectHash === "") {
      this.typeCheckedCallback(["", "No Python source files.", 1]);
      return;
    }

    const pythonResult = await this.runPython(
      `
        import micropip
        from mypy import api
        import json

        await micropip.install("typing-extensions")
        await micropip.install("mypy_extensions")

        result = api.run(["/home/pyodide/"])

        json.dumps(result)
      `
    );

    if (pythonResult.error)
      throw new Error(`Error type checking: ${pythonResult.error}`);

    const mypyResult = JSON.parse(pythonResult.result as string) as MypyResult;

    this.typeCheckedCallback(mypyResult);
  }

  async typeCheckForever(pollingDurationMillis: number = 100) {
    while (true) {
      if (this.active) {
        await this.typeCheckProjectDirectory();
      }
      await delay(pollingDurationMillis);
    }
  }
}
