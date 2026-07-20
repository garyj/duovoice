import { describe, expect, it } from "vitest";

import { TurnCoordinator } from "../src/turns";

describe("TurnCoordinator", () => {
  it("requests a response after a spoken turn is committed", () => {
    const turns = new TurnCoordinator();

    expect(turns.speechStarted()).toBe(false);
    expect(turns.turnCommitted()).toBe("respond");
  });

  it("deletes a committed item that has no speech start", () => {
    const turns = new TurnCoordinator();

    expect(turns.turnCommitted()).toBe("delete");
  });

  it("queues an interrupted turn until the active response closes", () => {
    const turns = new TurnCoordinator();
    turns.responseCreated();

    expect(turns.speechStarted()).toBe(true);
    expect(turns.turnCommitted()).toBe("none");
    expect(turns.responseDone()).toBe("respond");
  });

  it("does nothing when a response finishes without a queued turn", () => {
    const turns = new TurnCoordinator();
    turns.responseCreated();

    expect(turns.responseDone()).toBe("none");
  });
});
