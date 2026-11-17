import { describe, expect, it } from "vitest";

import { createNoteQueue } from "./note-queue";

describe("the note prompt's queue", () => {
  it("a second request waits for the first instead of cancelling it", async () => {
    const queue = createNoteQueue();
    const first = queue.ask();
    const second = queue.ask();
    expect(queue.current()).not.toBeNull();
    queue.current()!.resolve("first reason");
    expect(await first).toBe("first reason");
    // The second prompt opens only now.
    expect(queue.current()).not.toBeNull();
    queue.current()!.resolve(null);
    expect(await second).toBeNull();
    expect(queue.current()).toBeNull();
  });

  it("tells subscribers when the open prompt changes", () => {
    const queue = createNoteQueue();
    let calls = 0;
    const stop = queue.subscribe(() => calls++);
    void queue.ask();
    queue.current()!.resolve("x");
    stop();
    void queue.ask();
    expect(calls).toBe(2);
  });
});
