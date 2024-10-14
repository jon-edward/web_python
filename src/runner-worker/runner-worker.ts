// Pyodide worker API.

interface FinishedMessage {
  kind: "finished";
  id: number;
  result?: any;
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

export default class RunnerWorker {
  stderrFunc: (content: string) => void;
  stdoutFunc: (content: string) => void;

  private callbacks: Record<
    number,
    (message: FinishedMessage | ErrorMessage) => void
  >;
  private worker: Worker;
  private id: number;
  private interruptBuffer: Uint8Array;
  private setInterruptBufferPromise: Promise<FinishedMessage | ErrorMessage>;

  constructor(
    stdoutFunc: (content: string) => void,
    stderrFunc: (content: string) => void
  ) {
    this.callbacks = {};
    this.worker = new Worker(new URL("./worker", import.meta.url), {
      type: "classic",
    });
    this.worker.onmessage = (event: {
      data: FinishedMessage | StderrMessage | StdoutMessage | ErrorMessage;
    }) => this.onMessage(event.data);
    this.id = 0;
    this.stdoutFunc = stdoutFunc;
    this.stderrFunc = stderrFunc;
    this.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));

    this.setInterruptBufferPromise = this.sendMessage({
      kind: "set-interrupt-buffer",
      interruptBuffer: this.interruptBuffer,
    });
  }

  private invokeCallback(message: FinishedMessage | ErrorMessage) {
    const id = message.id;
    const onSuccess = this.callbacks[id];
    delete this.callbacks[id];
    onSuccess(message);
  }

  private onFinished(message: FinishedMessage) {
    this.invokeCallback(message);
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
    this.stderrFunc(`Error at worker: \n${message.error}`);
    this.invokeCallback(message);
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

  private async sendMessage(
    data: any
  ): Promise<FinishedMessage | ErrorMessage> {
    this.id = (this.id + 1) % Number.MAX_SAFE_INTEGER;
    return new Promise<FinishedMessage | ErrorMessage>((onSuccess) => {
      this.callbacks[this.id] = onSuccess;
      this.worker.postMessage({
        id: this.id,
        ...data,
      });
    });
  }

  async runPython(python: string, filename: string) {
    await this.setInterruptBufferPromise;
    this.interruptBuffer[0] = 0;
    return await this.sendMessage({ kind: "run", python, filename });
  }

  stop() {
    this.interruptBuffer[0] = 2;
  }
}
