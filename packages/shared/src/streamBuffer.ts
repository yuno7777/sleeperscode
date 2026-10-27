export class StreamBuffer {
  private buffer: string = "";

  constructor(initialContent: string = "") {
    this.buffer = initialContent;
  }

  public append(chunk: string): void {
    this.buffer += chunk;
  }

  public get length(): number {
    return this.buffer.length;
  }

  public isEmpty(): boolean {
    return this.buffer.length === 0;
  }

  public peek(): string {
    return this.buffer;
  }

  public readLines(): string[] {
    const lines: string[] = [];
    let newlineIndex: number;

    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, newlineIndex);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      lines.push(line);
      this.buffer = this.buffer.slice(newlineIndex + 1);
    }

    return lines;
  }

  public readDelimited(delimiter: string): string[] {
    if (!delimiter) {
      throw new Error("Delimiter cannot be empty");
    }

    const segments: string[] = [];
    let delimIndex: number;

    while ((delimIndex = this.buffer.indexOf(delimiter)) !== -1) {
      segments.push(this.buffer.slice(0, delimIndex));
      this.buffer = this.buffer.slice(delimIndex + delimiter.length);
    }

    return segments;
  }

  public readJsonLines<T = unknown>(): T[] {
    const lines = this.readLines();
    const results: T[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        results.push(JSON.parse(trimmed) as T);
      } catch (err) {
        // Discard or re-throw depending on caller; here return valid ones
      }
    }

    return results;
  }

  public flush(): string {
    const remaining = this.buffer;
    this.buffer = "";
    return remaining;
  }

  public clear(): void {
    this.buffer = "";
  }
}
