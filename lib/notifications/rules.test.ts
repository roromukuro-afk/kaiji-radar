import { describe, it, expect } from "vitest";
import { resolveNotificationRule, type NotificationRule } from "./rules";

function rule(overrides: Partial<NotificationRule>): NotificationRule {
  return {
    id: "r1",
    stock_id: null,
    importance: null,
    event_type: null,
    source_type: null,
    keyword: null,
    action: "notify",
    priority: 0,
    ...overrides,
  };
}

const target = {
  stock_id: "stock-1",
  importance: "critical",
  event_type: "earnings",
  source_type: "tdnet",
  title: "2026年3月期 決算短信のお知らせ",
};

describe("resolveNotificationRule", () => {
  it("一致するルールが無ければnull", () => {
    const rules = [rule({ id: "a", stock_id: "other-stock", action: "no_notify" })];
    expect(resolveNotificationRule(rules, target)).toBeNull();
  });

  it("すべての条件がnullのルールは常に一致する", () => {
    const rules = [rule({ id: "a", action: "save_only" })];
    expect(resolveNotificationRule(rules, target)?.id).toBe("a");
  });

  it("stock_id/importance/event_type/source_typeすべてが一致する必要がある", () => {
    const rules = [rule({ id: "a", stock_id: "stock-1", importance: "normal", action: "no_notify" })];
    expect(resolveNotificationRule(rules, target)).toBeNull();
  });

  it("keywordはタイトル部分一致・大文字小文字を区別しない", () => {
    const rules = [rule({ id: "a", keyword: "決算短信", action: "save_only" })];
    expect(resolveNotificationRule(rules, target)?.id).toBe("a");
    const rules2 = [rule({ id: "b", keyword: "不一致キーワード", action: "save_only" })];
    expect(resolveNotificationRule(rules2, target)).toBeNull();
  });

  it("priorityが高い方を優先する", () => {
    const rules = [
      rule({ id: "low", priority: 0, action: "no_notify" }),
      rule({ id: "high", priority: 10, action: "notify" }),
    ];
    expect(resolveNotificationRule(rules, target)?.id).toBe("high");
  });

  it("priorityが同点なら条件数が多い(具体的な)方を優先する", () => {
    const rules = [
      rule({ id: "generic", priority: 5, action: "no_notify" }),
      rule({ id: "specific", priority: 5, stock_id: "stock-1", importance: "critical", action: "notify" }),
    ];
    expect(resolveNotificationRule(rules, target)?.id).toBe("specific");
  });
});
