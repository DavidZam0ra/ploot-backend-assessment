import type { ClockPort } from "@ploot/core";

export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}
