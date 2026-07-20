export type TurnAction = "delete" | "none" | "respond";

export class TurnCoordinator {
  private responseActive = false;
  private responsePending = false;
  private turnStarted = false;

  speechStarted(): boolean {
    this.turnStarted = true;
    return this.responseActive;
  }

  turnCommitted(): TurnAction {
    if (!this.turnStarted) {
      return "delete";
    }

    this.turnStarted = false;
    if (this.responseActive) {
      this.responsePending = true;
      return "none";
    }

    this.responseActive = true;
    return "respond";
  }

  responseCreated(): void {
    this.responseActive = true;
  }

  responseDone(): TurnAction {
    this.responseActive = false;
    if (!this.responsePending) {
      return "none";
    }

    this.responsePending = false;
    this.responseActive = true;
    return "respond";
  }
}
