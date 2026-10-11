/**
 * Credora - Loan Management System (sample excerpt)
 * Copyright (c) 2026 Krishna Prasadh. All rights reserved.
 *
 * Matches a parsed bank credit-alert email against PENDING receipts.
 *
 * Priority:
 *   1. Exact UTR match (both sides have a UTR) - unique by DB constraint,
 *      collision-proof regardless of how many borrowers paid the same amount.
 *   2. No UTR on either side: amount + time-window match, but ONLY if it
 *      resolves to exactly one PENDING receipt. Two borrowers paying the
 *      same amount in the same window is genuinely ambiguous - guessing
 *      would risk crediting the wrong loan, so neither gets auto-verified.
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/database/prisma.service";
import { ReceiptsService } from "../receipts/receipts.service";
import { BankEmailParserService, ParsedBankEmail } from "./bank-email-parser.service";
import { ReceiptStatus } from "@credora/db";

const AMOUNT_MATCH_WINDOW_MINUTES = 6 * 60;

@Injectable()
export class BankEmailMatchingService {
  private readonly logger = new Logger(BankEmailMatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly receipts: ReceiptsService,
    private readonly parser: BankEmailParserService
  ) {}

  async matchAndVerify(
    subject: string,
    bodyText: string,
    receivedAt: Date
  ): Promise<{ matched: boolean; receiptId?: string; reason: string }> {
    if (!this.parser.isCreditAlert(subject, bodyText)) {
      return { matched: false, reason: "not a credit alert (debit or unrecognised email)" };
    }

    const parsed: ParsedBankEmail = this.parser.parse(subject, bodyText);

    if (parsed.utr) {
      const receipt = await this.prisma.receiptVerification.findFirst({
        where: { utr: parsed.utr, status: ReceiptStatus.PENDING },
      });
      if (receipt) {
        await this.receipts.autoVerifyFromBankEmail(receipt.id, parsed.amount ?? 0, parsed.utr);
        return { matched: true, receiptId: receipt.id, reason: "UTR match" };
      }
      // A UTR was found in the email but no PENDING receipt has it - could
      // be a receipt not yet submitted, or one already verified another way.
      // Fall through to the amount fallback only if the email had no amount
      // either is pointless; still try amount fallback since the borrower's
      // receipt may lack a UTR even though the bank email has one.
    }

    if (parsed.amount) {
      const windowStart = new Date(receivedAt.getTime() - AMOUNT_MATCH_WINDOW_MINUTES * 60 * 1000);
      const candidates = await this.prisma.receiptVerification.findMany({
        where: {
          status: ReceiptStatus.PENDING,
          amount: parsed.amount,
          submittedAt: { gte: windowStart },
        },
        select: { id: true },
      });

      if (candidates.length === 1) {
        await this.receipts.autoVerifyFromBankEmail(candidates[0]!.id, parsed.amount, parsed.utr);
        return {
          matched: true,
          receiptId: candidates[0]!.id,
          reason: "unique amount+window match",
        };
      }
      if (candidates.length > 1) {
        this.logger.warn(
          `Bank email amount collision: ${candidates.length} PENDING receipts match Rs.${parsed.amount} within the match window - leaving all for admin review`
        );
        return { matched: false, reason: `amount collision across ${candidates.length} receipts` };
      }
    }

    return { matched: false, reason: "no matching PENDING receipt" };
  }
}
