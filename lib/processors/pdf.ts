/**
 * PDF 保存・テキスト抽出
 *
 * 1. pdf-parse でテキスト抽出を試みる
 * 2. 失敗または空の場合は OCR (Tesseract.js) にフォールバック
 * 3. Supabase Storage に原本 PDF を保存
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const PDF_BUCKET = "pdfs";

export interface PdfResult {
  storagePath: string | null;
  fileHash: string;
  fileSizeBytes: number;
  extractedText: string | null;
  ocrText: string | null;
  extractionMethod: "pdfparse" | "ocr" | "failed";
  ocrQuality: "good" | "poor" | null;
}

export async function fetchAndStorePdf(
  pdfUrl: string,
  docId: string,
  sourceType: string
): Promise<PdfResult> {
  let pdfBytes: Buffer;
  try {
    const res = await fetch(pdfUrl, {
      headers: {
        "User-Agent": "KaijiRadar/1.0 (+https://github.com/roromukuro/kaiji-radar)",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pdfBytes = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error(`[PDF] 取得失敗 ${pdfUrl}:`, err);
    return {
      storagePath: null,
      fileHash: "",
      fileSizeBytes: 0,
      extractedText: null,
      ocrText: null,
      extractionMethod: "failed",
      ocrQuality: null,
    };
  }

  const fileHash = createHash("sha256").update(pdfBytes).digest("hex");
  const fileSizeBytes = pdfBytes.length;

  // Store in Supabase Storage
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const storagePath = `${sourceType}/${docId}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(PDF_BUCKET)
    .upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    console.error(`[PDF] Storage 保存失敗 ${docId}:`, uploadError);
  }

  // Text extraction
  let extractedText: string | null = null;
  let ocrText: string | null = null;
  let extractionMethod: "pdfparse" | "ocr" | "failed" = "failed";
  let ocrQuality: "good" | "poor" | null = null;

  try {
    const pdfParse = require("pdf-parse");
    const result = await pdfParse(pdfBytes);
    const text = result.text?.trim();
    if (text && text.length > 50) {
      extractedText = text;
      extractionMethod = "pdfparse";
    } else {
      throw new Error("Extracted text too short");
    }
  } catch {
    // OCR fallback (only for smaller PDFs to control cost/time)
    if (fileSizeBytes < 10 * 1024 * 1024) {
      try {
        const result = await runOcr(pdfBytes);
        ocrText = result.text;
        ocrQuality = result.quality;
        extractionMethod = "ocr";
      } catch (ocrErr) {
        console.error("[PDF] OCR 失敗:", ocrErr);
        extractionMethod = "failed";
      }
    }
  }

  return {
    storagePath: uploadError ? null : storagePath,
    fileHash,
    fileSizeBytes,
    extractedText,
    ocrText,
    extractionMethod,
    ocrQuality,
  };
}

async function runOcr(
  pdfBytes: Buffer
): Promise<{ text: string; quality: "good" | "poor" }> {
  const { createWorker } = require("tesseract.js");
  const worker = await createWorker(["jpn", "eng"]);
  await worker.setParameters({ tessedit_pageseg_mode: "1" });

  // For PDF OCR, convert first page to image-like buffer
  // Tesseract can process PDFs directly in some configurations
  const result = await worker.recognize(pdfBytes);
  await worker.terminate();

  const text = result.data.text ?? "";
  const confidence = result.data.confidence ?? 0;

  return {
    text: text.trim(),
    quality: confidence >= 60 ? "good" : "poor",
  };
}

export async function getPdfSignedUrl(
  storagePath: string,
  expiresIn = 3600
): Promise<string | null> {
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase.storage
    .from(PDF_BUCKET)
    .createSignedUrl(storagePath, expiresIn);

  if (error || !data) return null;
  return data.signedUrl;
}
