// Mypy worker API

interface MypyMessage {
  kind: "mypy";
  mypy: string;
}

export default class MypyWorker {
  mypyFunc: (content: string) => void;

  private worker: Worker;

  constructor(mypyFunc: (content: string) => void) {
    this.worker = new Worker(new URL("./worker", import.meta.url), {
      type: "classic",
    });
    this.worker.onmessage = (event: MessageEvent<MypyMessage>) =>
      this.onMessage(event.data);
    this.mypyFunc = mypyFunc;
  }

  private onMessage(message: MypyMessage) {
    console.log(message);
  }

  start() {
    this.worker.postMessage({ kind: "start" });
  }

  stop() {
    this.worker.postMessage({ kind: "stop" });
  }
}
