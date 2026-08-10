import { describe, it, expect } from "vitest";
import { computeRecoveryWindow } from "./recovery";

const NOW = new Date("2026-08-10T12:00:00Z").getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 3600000).toISOString();

describe("computeRecoveryWindow", () => {
  it("チェックポイントが無ければ通常の遡及幅を使う(復旧扱いにしない)", () => {
    const result = computeRecoveryWindow(null, 3, 48, NOW);
    expect(result.isRecovery).toBe(false);
    expect(result.lookbackHours).toBe(3);
    expect(result.since.getTime()).toBe(NOW - 3 * 3600000);
  });

  it("直近に成功していれば通常の遡及幅のまま", () => {
    const result = computeRecoveryWindow(hoursAgo(2), 3, 48, NOW);
    expect(result.isRecovery).toBe(false);
    expect(result.lookbackHours).toBe(3);
  });

  it("通常幅の1.5倍以内の遅延は復旧扱いにしない", () => {
    const result = computeRecoveryWindow(hoursAgo(4), 3, 48, NOW);
    expect(result.isRecovery).toBe(false);
  });

  it("大きく間が空いていれば復旧モードとしてその時間分遡及する", () => {
    const result = computeRecoveryWindow(hoursAgo(10), 3, 48, NOW);
    expect(result.isRecovery).toBe(true);
    expect(result.lookbackHours).toBe(10);
    expect(result.since.getTime()).toBe(NOW - 10 * 3600000);
  });

  it("上限を超える遅延はcapHoursで頭打ちにする", () => {
    const result = computeRecoveryWindow(hoursAgo(200), 3, 48, NOW);
    expect(result.isRecovery).toBe(true);
    expect(result.lookbackHours).toBe(48);
    expect(result.since.getTime()).toBe(NOW - 48 * 3600000);
  });

  it("ソースごとに異なるcapHoursを独立して適用できる", () => {
    const edinet = computeRecoveryWindow(hoursAgo(200), 3, 168, NOW);
    const enNews = computeRecoveryWindow(hoursAgo(200), 3, 48, NOW);
    expect(edinet.lookbackHours).toBe(168);
    expect(enNews.lookbackHours).toBe(48);
  });
});
