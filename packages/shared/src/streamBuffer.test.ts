import { describe, expect, it } from "vitest";
import { StreamBuffer } from "./streamBuffer.ts";

describe("StreamBuffer", () => {
  it("should append chunks and read lines", () => {
    const buf = new StreamBuffer();
    buf.append("hello\nworld\npartial");

    const lines = buf.readLines();
    expect(lines).toEqual(["hello", "world"]);
    expect(buf.peek()).toBe("partial");
  });

  it("should handle CRLF line endings", () => {
    const buf = new StreamBuffer();
    buf.append("line1\r\nline2\r\nincomplete");

    const lines = buf.readLines();
    expect(lines).toEqual(["line1", "line2"]);
    expect(buf.peek()).toBe("incomplete");
  });

  it("should parse JSON lines", () => {
    const buf = new StreamBuffer();
    buf.append('{"type":"start"}\n{"type":"data","value":42}\n{"bad json\n');

    const messages = buf.readJsonLines<{ type: string }>();
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe("start");
    expect(messages[1]).toMatchObject({ type: "data", value: 42 });
  });

  it("should read by custom delimiter", () => {
    const buf = new StreamBuffer("data:hello||data:world||incomplete");
    const segments = buf.readDelimited("||");

    expect(segments).toEqual(["data:hello", "data:world"]);
    expect(buf.peek()).toBe("incomplete");
  });

  it("should flush all remaining content", () => {
    const buf = new StreamBuffer("leftover");
    const flushed = buf.flush();
    expect(flushed).toBe("leftover");
    expect(buf.isEmpty()).toBe(true);
  });

  it("should clear the buffer", () => {
    const buf = new StreamBuffer("some data");
    buf.clear();
    expect(buf.length).toBe(0);
    expect(buf.peek()).toBe("");
  });
});
