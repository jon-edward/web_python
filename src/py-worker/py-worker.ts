// Pyodide worker API.

interface FinishedMessage {
  kind: "finished";
  id: number;
}

interface StdoutMessage {
  kind: "stdout";
  stdout: string;
}

interface StderrMessage {
  kind: "stderr";
  stderr: string;
}

interface ErrorMessage {
  kind: "error";
  error: string;
  id: number;
}

export default class PyWorker {
  stderrFunc: (content: string) => void;
  stdoutFunc: (content: string) => void;

  private callbacks: Record<number, () => void>;
  private worker: Worker;
  private id: number;
  private interruptBuffer: Uint8Array;

  constructor(
    stdoutFunc: (content: string) => void,
    stderrFunc: (content: string) => void
  ) {
    this.callbacks = {};
    this.worker = new Worker(new URL("./_worker", import.meta.url), {
      type: "classic",
    });
    this.worker.onmessage = (event: {
      data: FinishedMessage | StderrMessage | StdoutMessage | ErrorMessage;
    }) => this.onMessage(event.data);
    this.id = 0;
    this.stdoutFunc = stdoutFunc;
    this.stderrFunc = stderrFunc;
    this.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
  }

  private invokeCallback(id: number) {
    const onSuccess = this.callbacks[id];
    delete this.callbacks[id];
    onSuccess();
  }

  private onFinished(message: FinishedMessage) {
    const { id } = message;
    this.invokeCallback(id);
  }

  private onStderr(message: StderrMessage) {
    const { stderr } = message;
    this.stderrFunc(stderr);
  }

  private onStdout(message: StdoutMessage) {
    const { stdout } = message;
    this.stdoutFunc(stdout);
  }

  private onError(message: ErrorMessage) {
    const { error, id } = message;
    this.stderrFunc(`Error at worker: \n${error}`);
    this.invokeCallback(id);
  }

  private onMessage(
    message: FinishedMessage | StderrMessage | StdoutMessage | ErrorMessage
  ) {
    switch (message.kind) {
      case "finished":
        // Some call was finished successfully.
        this.onFinished(message);
        break;
      case "stderr":
        // Python script has not finished, but there's stderr that should be logged.
        this.onStderr(message);
        break;
      case "stdout":
        // Python script has not finished, but there's stdout that should be logged.
        this.onStdout(message);
        break;
      case "error":
        // Some call was finished, but there's an associated error message.
        this.onError(message);
        break;
    }
  }

  private async sendMessage(data: any) {
    this.id = (this.id + 1) % Number.MAX_SAFE_INTEGER;
    return new Promise<void>((onSuccess) => {
      this.callbacks[this.id] = onSuccess;
      this.worker.postMessage({
        id: this.id,
        ...data,
      });
    });
  }

  async runPython(python: string, filename: string) {
    this.interruptBuffer[0] = 0;
    await this.sendMessage({ kind: "run", python, filename });
  }

  async init() {
    await this.sendMessage({
      kind: "init",
      interruptBuffer: this.interruptBuffer,
    });
  }

  stop() {
    console.log(this.interruptBuffer);
    this.interruptBuffer[0] = 2;
  }
}
