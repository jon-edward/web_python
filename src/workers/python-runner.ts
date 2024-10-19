import WorkerApi, { StderrMessage, StdoutMessage } from "./worker-api";

export default class PythonRunner extends WorkerApi {
  stderrFunc = (_content: string) => {};
  stdoutFunc = (_content: string) => {};

  onStderr(message: StderrMessage): void {
    this.stderrFunc(message.stderr);
  }

  onStdout(message: StdoutMessage): void {
    this.stdoutFunc(message.stdout);
  }
}
