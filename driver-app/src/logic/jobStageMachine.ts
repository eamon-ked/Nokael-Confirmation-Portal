import { stageIndex, type HandoffKind, type JobStage } from "./model";

/** One row in the collapsible progress tracker. */
export interface ProgressStep {
  label: string;
  done: boolean;
  active: boolean;
}

/** The single big button the driver should press next. */
export type PrimaryAction = "ARRIVED_AT_PICKUP" | "PICK_UP" | "ARRIVED_AT_DROPOFF" | "DROP_OFF" | "COMPLETE_JOB";

/** All the rules about how a job moves through its stages (same as the Android `JobStageMachine`). */
export const JobStageMachine = {
  primaryActionFor(stage: JobStage): PrimaryAction {
    switch (stage) {
      case "HEADING_TO_PICKUP":
        return "ARRIVED_AT_PICKUP";
      case "AT_PICKUP":
        return "PICK_UP";
      case "PICKED_UP":
        return "ARRIVED_AT_DROPOFF";
      case "AT_DROPOFF":
        return "DROP_OFF";
      case "DROPPED_OFF":
        return "COMPLETE_JOB";
    }
  },

  /** The stage reached after the driver reports arrival at `kind`. */
  afterArrival: (kind: HandoffKind): JobStage => (kind === "PICKUP" ? "AT_PICKUP" : "AT_DROPOFF"),

  /** The stage reached after the OTP for `kind` is accepted. */
  afterHandoff: (kind: HandoffKind): JobStage => (kind === "PICKUP" ? "PICKED_UP" : "DROPPED_OFF"),

  /** True once the driver has reported arrival at the pickup. */
  hasArrivedAtPickup: (stage: JobStage) => stage !== "HEADING_TO_PICKUP",

  progressSteps(stage: JobStage): ProgressStep[] {
    const i = stageIndex(stage);
    return [
      { label: "Heading to pickup", done: stage !== "HEADING_TO_PICKUP", active: stage === "HEADING_TO_PICKUP" },
      { label: "Arrived at pickup", done: i >= stageIndex("PICKED_UP"), active: stage === "AT_PICKUP" },
      { label: "Package collected", done: i >= stageIndex("AT_DROPOFF"), active: stage === "PICKED_UP" },
      { label: "Arrived at dropoff", done: stage === "DROPPED_OFF", active: stage === "AT_DROPOFF" },
      { label: "Delivered", done: stage === "DROPPED_OFF", active: false },
    ];
  },
};
