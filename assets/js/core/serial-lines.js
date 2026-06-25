export class SerialLineReader {
  constructor({ baudRate, onLine, onStatus, onError }) {
    this.baudRate = baudRate;
    this.onLine = onLine;
    this.onStatus = onStatus;
    this.onError = onError;
    this.port = null;
    this.reader = null;
    this.keepReading = false;
  }

  static isSupported() {
    return "serial" in navigator;
  }

  async connect() {
    if (!SerialLineReader.isSupported()) {
      throw new Error("Web Serial is not available in this browser.");
    }

    this.port = await navigator.serial.requestPort();
    await this.port.open({
      baudRate: this.baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      bufferSize: 4096,
      flowControl: "none",
    });

    this.keepReading = true;
    this.onStatus?.("Connected");
    this.readLoop();
  }

  async disconnect() {
    this.keepReading = false;

    if (this.reader) {
      await this.reader.cancel().catch(() => {});
      this.reader.releaseLock();
      this.reader = null;
    }

    if (this.port) {
      await this.port.close().catch(() => {});
      this.port = null;
    }

    this.onStatus?.("Disconnected");
  }

  async readLoop() {
    const decoder = new TextDecoder();
    let buffer = "";

    while (this.port?.readable && this.keepReading) {
      this.reader = this.port.readable.getReader();

      try {
        while (this.keepReading) {
          const { value, done } = await this.reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r\n|\n|\r/);
          buffer = lines.pop() ?? "";

          lines
            .map((line) => line.trim())
            .filter(Boolean)
            .forEach((line) => this.onLine?.(line));
        }
      } catch (error) {
        if (this.keepReading) {
          this.onError?.(error);
        }
      } finally {
        this.reader?.releaseLock();
        this.reader = null;
      }
    }
  }
}
