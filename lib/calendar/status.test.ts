import { describe, it, expect } from "vitest";
import { deriveEventStatus, isAutoLinkCandidate } from "./status";

const NOW = new Date("2026-08-10T12:00:00Z").getTime();

describe("deriveEventStatus", () => {
  it("linked_article_idがあれば常に確認済み", () => {
    expect(deriveEventStatus({ scheduled_date: "2026-09-01", status: "scheduled", linked_article_id: "a1" }, NOW)).toBe("confirmed");
  });

  it("postponedならlinkが無ければ延期", () => {
    expect(deriveEventStatus({ scheduled_date: "2026-09-01", status: "postponed", linked_article_id: null }, NOW)).toBe("postponed");
  });

  it("未来日でscheduledなら予定済み", () => {
    expect(deriveEventStatus({ scheduled_date: "2026-09-01", status: "scheduled", linked_article_id: null }, NOW)).toBe("scheduled");
  });

  it("過去日でリンク無しなら未確認", () => {
    expect(deriveEventStatus({ scheduled_date: "2026-07-01", status: "scheduled", linked_article_id: null }, NOW)).toBe("unconfirmed");
  });

  it("linked_article_idはpostponedより優先される", () => {
    expect(deriveEventStatus({ scheduled_date: "2026-09-01", status: "postponed", linked_article_id: "a1" }, NOW)).toBe("confirmed");
  });
});

describe("isAutoLinkCandidate", () => {
  const baseEvent = { event_type: "earnings", scheduled_date: "2026-08-05", status: "scheduled" as const, linked_article_id: null };

  it("開示種別と日付窓が一致すればtrue", () => {
    const article = { event_type: "earnings", published_at: "2026-08-07T00:00:00Z" };
    expect(isAutoLinkCandidate(baseEvent, article, NOW)).toBe(true);
  });

  it("開示種別が違えばfalse", () => {
    const article = { event_type: "dividend", published_at: "2026-08-07T00:00:00Z" };
    expect(isAutoLinkCandidate(baseEvent, article, NOW)).toBe(false);
  });

  it("日付窓を超えていればfalse", () => {
    const article = { event_type: "earnings", published_at: "2026-09-01T00:00:00Z" };
    expect(isAutoLinkCandidate(baseEvent, article, NOW)).toBe(false);
  });

  it("既にlinked_article_idがあればfalse", () => {
    const linked = { ...baseEvent, linked_article_id: "a1" };
    const article = { event_type: "earnings", published_at: "2026-08-07T00:00:00Z" };
    expect(isAutoLinkCandidate(linked, article, NOW)).toBe(false);
  });

  it("postponedならfalse", () => {
    const postponed = { ...baseEvent, status: "postponed" as const };
    const article = { event_type: "earnings", published_at: "2026-08-07T00:00:00Z" };
    expect(isAutoLinkCandidate(postponed, article, NOW)).toBe(false);
  });

  it("記事のpublished_atが無ければfalse", () => {
    const article = { event_type: "earnings", published_at: null };
    expect(isAutoLinkCandidate(baseEvent, article, NOW)).toBe(false);
  });

  it("other種別のイベントは自動リンク対象外", () => {
    const other = { ...baseEvent, event_type: "other" };
    const article = { event_type: "other", published_at: "2026-08-07T00:00:00Z" };
    expect(isAutoLinkCandidate(other, article, NOW)).toBe(false);
  });
});
