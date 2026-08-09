import { describe, it, expect } from "vitest";
import { classifyEventType, classifyFromEdinetCode, classifyFromTdnetDocType, classifyFromText } from "./event-type";

describe("classifyFromEdinetCode", () => {
  it("公開買付届出書コードをma_tobに分類する", () => {
    expect(classifyFromEdinetCode("070")).toBe("ma_tob");
  });
  it("未知のコードはnull", () => {
    expect(classifyFromEdinetCode("999")).toBeNull();
  });
  it("nullはnull", () => {
    expect(classifyFromEdinetCode(null)).toBeNull();
  });
});

describe("classifyFromTdnetDocType", () => {
  it("決算短信をearningsに分類する", () => {
    expect(classifyFromTdnetDocType("決算短信")).toBe("earnings");
  });
  it("未知の種別はnull", () => {
    expect(classifyFromTdnetDocType("未知の種別")).toBeNull();
  });
});

describe("classifyFromText", () => {
  it("TOBキーワードを含むタイトルをma_tobに分類する", () => {
    expect(classifyFromText("A社によるB社株式のTOB(公開買付)開始のお知らせ")).toBe("ma_tob");
  });
  it("決算関連の語を含むタイトルをearningsに分類する", () => {
    expect(classifyFromText("2026年3月期 決算短信〔日本基準〕(連結)")).toBe("earnings");
  });
  it("どの規則にも一致しなければotherを返す", () => {
    expect(classifyFromText("特に何の変哲もないタイトル")).toBe("other");
  });
});

describe("classifyEventType (統合)", () => {
  it("EDINETコードを最優先する(タイトルが決算関連でもTOB扱い)", () => {
    const type = classifyEventType({
      title: "決算短信のような文言を含むTOBに関する書類",
      edinetDocTypeCode: "070",
    });
    expect(type).toBe("ma_tob");
  });

  it("EDINETコードが無ければTDnet文書種別を使う", () => {
    const type = classifyEventType({ title: "何かのお知らせ", tdnetDocType: "配当" });
    expect(type).toBe("dividend");
  });

  it("どちらも無ければタイトル規則にフォールバックする", () => {
    const type = classifyEventType({ title: "株主総会招集のご通知" });
    expect(type).toBe("agm");
  });
});
