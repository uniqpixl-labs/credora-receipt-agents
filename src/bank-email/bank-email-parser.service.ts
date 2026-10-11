/**
 * Credora - Loan Management System (sample excerpt)
 * Copyright (c) 2026 Krishna Prasadh. All rights reserved.
 *
 * Generic regex parser for bank credit-alert emails. Deliberately
 * bank-agnostic (no sample email was available when this was written) -
 * mirrors the amount/UTR extraction patterns already proven in
 * receipts/ocr.service.ts against real receipt text.
 */

import { Injectable } from "@nestjs/common";

export interface ParsedBankEmail {
  amount: number | null;
  utr: string | null;
}

@Injectable()
export class BankEmailParserService {
  parse(subject: string, bodyText: string): ParsedBankEmail {
    const text = `${subject}\n${bodyText}`;
    return { amount: this.extractAmount(text), utr: this.extractUtr(text) };
  }

  /** Only treat this as a credit (money IN), never a debit - a debit alert must never auto-verify a receipt. */
  isCreditAlert(subject: string, bodyText: string): boolean {
    const text = `${subject}\n${bodyText}`.toLowerCase();
    const hasCreditWord =
      /\bcredited\b|\bcredit alert\b|\bamount received\b|\bpayment received\b/.test(text);
    const hasDebitWord = /\bdebited\b|\bdebit alert\b|\bwithdrawn\b/.test(text);
    return hasCreditWord && !hasDebitWord;
  }

  private extractAmount(text: string): number | null {
    const patterns = [
      /(?:credited with|credited)\s*(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i,
      /₹\s*([\d,]+(?:\.\d{1,2})?)/,
      /Rs\.?\s*([\d,]+(?:\.\d{1,2})?)/i,
      /INR\s*([\d,]+(?:\.\d{1,2})?)/i,
      /Amount[:\s]+(?:INR\s*)?([\d,]+(?:\.\d{1,2})?)/i,
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
    const patterns = [
      /UTR[:\s#]*([A-Z0-9]{12,22})/i,
      /UPI\s*Ref(?:erence)?(?:\s*No\.?)?[:\s#]*([A-Z0-9]{10,22})/i,
      /Ref(?:erence)?(?:\s*No\.?)?[:\s#]*([A-Z0-9]{12,22})/i,
      /Transaction\s*ID[:\s#]*([A-Z0-9]{12,22})/i,
      /\b([A-Z]{4}\d{8,})\b/,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1]!.trim().toUpperCase();
    }
    return null;
  }
}
