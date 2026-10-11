/**
 * Credora - Loan Management System (sample excerpt)
 * Copyright (c) 2026 Krishna Prasadh. All rights reserved.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface OcrResult {
  rawText: string;
  amount: number | null;
  utr: string | null;
  payerUpiId: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidenceScore: number;
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(private readonly config: ConfigService) {}

  async extractFromImage(imageBuffer: Buffer): Promise<OcrResult> {
    let sharp: any;
    let Tesseract: any;
    try {
      sharp = require("sharp");
      Tesseract = require("tesseract.js");
    } catch {
      this.logger.warn("OCR dependencies not installed - returning empty result");
      return this.emptyResult();
    }

    try {
      const processed = await sharp(imageBuffer).grayscale().normalise().sharpen().toBuffer();

      const { data } = await Tesseract.recognize(processed, "eng", {
        logger: () => {},
      });

      const tesseractResult = this.parseText(data.text);

      // When Tesseract confidence is LOW and OpenRouter is configured, fall
      // back to a vision-LLM for better extraction on blurry/handwritten receipts.
      if (
        tesseractResult.confidence === "LOW" &&
        this.config.get<string>("CREDORA_OPENROUTER_API_KEY")
      ) {
        const llmResult = await this.extractWithLlm(imageBuffer);
        if (llmResult) return llmResult;
      }

      return tesseractResult;
    } catch (err) {
      this.logger.error("OCR extraction failed", err);
      return this.emptyResult();
    }
  }

  private async extractWithLlm(imageBuffer: Buffer): Promise<OcrResult | null> {
    const apiKey = this.config.get<string>("CREDORA_OPENROUTER_API_KEY");
    if (!apiKey) return null;

    try {
      const base64 = imageBuffer.toString("base64");
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://credora.app",
          "X-Title": "Credora LMS OCR",
        },
        body: JSON.stringify({
          model: "google/gemini-flash-1.5",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: 'Extract payment details from this receipt image. Reply ONLY with a JSON object (no markdown): {"amount": number|null, "utr": string|null, "payerUpiId": string|null, "rawText": string}',
                },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
              ],
            },
          ],
          max_tokens: 256,
        }),
      });

      if (!res.ok) {
        this.logger.warn(`OpenRouter OCR fallback HTTP ${res.status}`);
        return null;
      }

      const body = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = body.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(raw) as {
        amount?: number | null;
        utr?: string | null;
        payerUpiId?: string | null;
        rawText?: string;
      };

      const fieldsFound = [parsed.amount, parsed.utr, parsed.payerUpiId].filter(Boolean).length;
      return {
        rawText: parsed.rawText ?? "",
        amount: parsed.amount ?? null,
        utr: parsed.utr ?? null,
        payerUpiId: parsed.payerUpiId ?? null,
        confidence: fieldsFound >= 2 ? "HIGH" : fieldsFound === 1 ? "MEDIUM" : "LOW",
        confidenceScore: fieldsFound >= 2 ? 0.85 : fieldsFound === 1 ? 0.5 : 0.1,
      };
    } catch (err) {
      this.logger.warn("OpenRouter OCR fallback failed", err);
      return null;
    }
  }

  parseText(rawText: string): OcrResult {
    const amount = this.extractAmount(rawText);
    const utr = this.extractUtr(rawText);
    const payerUpiId = this.extractUpiId(rawText);

    const fieldsFound = [amount, utr, payerUpiId].filter(Boolean).length;
    let confidence: "HIGH" | "MEDIUM" | "LOW";
    let confidenceScore: number;

    if (fieldsFound >= 2) {
      confidence = "HIGH";
      confidenceScore = 0.9;
    } else if (fieldsFound === 1) {
      confidence = "MEDIUM";
      confidenceScore = 0.5;
    } else {
      confidence = "LOW";
      confidenceScore = 0.1;
    }

    return { rawText, amount, utr, payerUpiId, confidence, confidenceScore };
  }

  private extractAmount(text: string): number | null {
    // Matches ₹1,234.56 or Rs.1234 or INR 1234 or plain numbers after currency cues
    const patterns = [
      /₹\s*([\d,]+(?:\.\d{1,2})?)/,
      /Rs\.?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /INR\s*([\d,]+(?:\.\d{1,2})?)/i,
      /Amount[:\s]+(?:INR\s*)?([\d,]+(?:\.\d{1,2})?)/i,
      /Total[:\s]+([\d,]+(?:\.\d{1,2})?)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const value = parseFloat(match[1]!.replace(/,/g, ""));
        if (!isNaN(value) && value > 0) return value;
      }
    }
    return null;
  }

  private extractUtr(text: string): string | null {
    // UTR is exactly 12 digits (NEFT/RTGS) or alphanumeric Razorpay reference
    const patterns = [
      /UTR[:\s#]*([A-Z0-9]{12,22})/i,
      /Ref(?:erence)?[:\s#]*([A-Z0-9]{12,22})/i,
      /Transaction\s*ID[:\s#]*([A-Z0-9]{12,22})/i,
      /\b([A-Z]{4}\d{8,})\b/, // NEFT/IMPS format
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1]!.trim();
    }
    return null;
  }

  private extractUpiId(text: string): string | null {
    const match = text.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9]+)/);
    return match ? match[1]!.trim() : null;
  }

  private emptyResult(): OcrResult {
    return {
      rawText: "",
      amount: null,
      utr: null,
      payerUpiId: null,
      confidence: "LOW",
      confidenceScore: 0,
    };
  }
}
