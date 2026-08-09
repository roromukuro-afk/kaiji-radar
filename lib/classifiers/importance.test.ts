import { describe, it, expect } from "vitest";
import { classifyImportance, importanceLabel } from "./importance";

// 自己株式取得・特別損失系(AI補助判定を経由するカテゴリ)はAPI呼び出しが発生するため、
// ユニットテストでは意図的に避け、規則ベース・EDINETベースの経路だけを検証する。

describe("classifyImportance", () => {
  it("EDINETの公開買付届出書コードをcriticalに分類する", async () => {
    const r = await classifyImportance({
      title: "何かのタイトル",
      edinetDocTypeCode: "070",
      isSafeSource: true,
    });
    expect(r.tier).toBe("critical");
    expect(r.source).toBe("rule");
  });

  it("下方修正をcriticalに分類する", async () => {
    const r = await classifyImportance({
      title: "2026年3月期 通期業績予想の下方修正に関するお知らせ",
      isSafeSource: true,
    });
    expect(r.tier).toBe("critical");
  });

  it("決算短信をimportantに分類する", async () => {
    const r = await classifyImportance({
      title: "2026年3月期 決算短信〔日本基準〕(連結)",
      isSafeSource: true,
    });
    expect(r.tier).toBe("important");
  });

  it("安全ソースでルールに一致しなければimportant(既定値)にする", async () => {
    const r = await classifyImportance({
      title: "特に何の変哲もないタイトル",
      isSafeSource: true,
    });
    expect(r.tier).toBe("important");
    expect(r.source).toBe("rule");
  });

  it("非安全ソースでルールに一致しなければnormal(既定値)にする", async () => {
    const r = await classifyImportance({
      title: "特に何の変哲もないタイトル",
      isSafeSource: false,
    });
    expect(r.tier).toBe("normal");
  });
});

describe("importanceLabel", () => {
  it("各tierを日本語ラベルに変換する", () => {
    expect(importanceLabel("critical")).toBe("最重要");
    expect(importanceLabel("important")).toBe("重要");
    expect(importanceLabel("normal")).toBe("通常");
  });
  it("nullは空文字", () => {
    expect(importanceLabel(null)).toBe("");
  });
});
