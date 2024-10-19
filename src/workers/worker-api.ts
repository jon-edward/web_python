// Worker API

export interface FinishedMessage {
  kind: "finished";
  id: number;
  error?: string;
  result?: any;
}

export interface StdoutMessage {
  kind: "stdout";
  stdout: string;
}

export interface StderrMessage {
  kind: "stderr";
  stderr: string;
}

type Message = FinishedMessage | StderrMessage | StdoutMessage;

/**
 * Defines internal behavior for interacting with a Pyodide worker.
 *
 * Override abstract methods to handle various message types.
 */
export default abstract class WorkerApi {
  private _callbacks: Record<number, (message: FinishedMessage) => void>;
  private _worker: Worker;
  private _id: number;
  private _interruptBuffer: Uint8Array;
  private _initPromise: Promise<FinishedMessage>;

  constructor() {
    this._callbacks = {};
    this._worker = new Worker(new URL("./_worker", import.meta.url), {
      type: "classic",
    });
    this._worker.onmessage = (event: { data: Message }) =>
      this._onMessage(event.data);
    this._id = 0;

    this._interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));

    this._initPromise = this._sendMessageAwaitable({
      kind: "init",
      interruptBuffer: this._interruptBuffer,
    });
  }

  private _invokeCallback(message: FinishedMessage) {
    const id = message.id;
    const onSuccess = this._callbacks[id];
    delete this._callbacks[id];
    onSuccess(message);
  }

  /**
   * Python script has not finished, but there's stderr that should be logged.
   */
  abstract onStderr(_message: StderrMessage): void;

  /**
   * Python script has not finished, but there's stdout that should be logged.
   */
  abstract onStdout(_message: StdoutMessage): void;

  private _onMessage(message: Message) {
    switch (message.kind) {
      case "finished":
        this._invokeCallback(message);
        break;
      case "stderr":
        this.onStderr(message);
        break;
      case "stdout":
        this.onStdout(message);
        break;
    }
  }

  private async _sendMessageAwaitable(data: any): Promise<FinishedMessage> {
    this._id = (this._id + 1) % Number.MAX_SAFE_INTEGER;
    return new Promise<FinishedMessage>((onSuccess) => {
      this._callbacks[this._id] = onSuccess;
      this._worker.postMessage({
        id: this._id,
        ...data,
      });
    });
  }

  async runPython(python: string, filename?: string) {
    await this._initPromise;
    this._interruptBuffer[0] = 0;
    return await this._sendMessageAwaitable({
      kind: "run",
      python,
      filename,
    });
  }

  stop() {
    this._interruptBuffer[0] = 2;
  }
}
