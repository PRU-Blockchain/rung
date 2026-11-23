// Error codes are only meaningful together with the program that raised them:
// 6042 is a slippage failure only when pump raised it, 6040 only when PumpSwap
// did (from pump, 6040 means "not enough SOL for rent"). The failing program
// is read from the logs (the first `Program <id> failed` line is the innermost).

import { PublicKey } from "@solana/web3.js";

import {
  COMPUTE_BUDGET_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  PUMP_SLIPPAGE_ERROR,
  PUMP_SWAP_PROGRAM_ID,
  PUMP_SWAP_SLIPPAGE_ERROR,
  RUNG_PROGRAM_ID,
} from "./constants";

/** Rung's `RungError` (target/idl/rung.json `errors`; a test compares them). */
export const RUNG_ERRORS: Readonly<Record<number, string>> = {
  6000: "InvalidRungCount",
  6001: "RungsNotIncreasing",
  6002: "CapTooHigh",
  6003: "AmountTooSmall",
  6004: "AmountAboveLimit",
  6005: "RentReserveAboveLimit",
  6006: "FeeBudgetAboveLimit",
  6007: "InvalidWindow",
  6008: "InvalidLifetime",
  6009: "InvalidExpectedTokens",
  6010: "OrderAlreadyOpen",
  6011: "WrongSessionKey",
  6012: "OrderFilled",
  6013: "OrderNotOpen",
  6014: "RungAboveCap",
  6015: "RungNotDue",
  6016: "OrderExpired",
  6017: "BoughtLessThanMinimum",
  6018: "OrderNotExpired",
  6019: "WrongUser",
  6020: "AccountMismatch",
  6021: "WrongBuyProgram",
  6022: "InvalidVenueAccount",
  6023: "MathOverflow",
  6024: "VenueNotSupported",
  6025: "CurveComplete",
  6026: "BuyTookTooMuchSol",
  6027: "FeeBudgetBelowRent",
};

/** The pump errors a buy can raise (docs/pump-arayuz.md G). */
export const PUMP_ERRORS: Readonly<Record<number, string>> = {
  6002: "TooMuchSolRequired",
  6005: "BondingCurveComplete",
  6020: "BuyZeroAmount",
  6021: "NotEnoughTokensToBuy",
  6040: "BuyNotEnoughSolToCoverRent",
  6042: "BuySlippageBelowMinTokensOut",
  6048: "MayhemModeDisabled",
  6061: "WrongBuybackFeeRecipientsCount",
  6072: "MissingCashbackAccounts",
  6074: "InvalidBondingCurveV2",
  6094: "CashbackCoinNotSupported",
  6097: "FeeConfigTooShort",
  6107: "QuoteCurveAwaitingMigration",
};

/**
 * The PumpSwap errors a buy can raise (docs/pump-arayuz.md G; 6027 and 6053
 * as observed in real_pumpswap.rs T8).
 */
export const PUMP_SWAP_ERRORS: Readonly<Record<number, string>> = {
  6004: "ExceededSlippage",
  6020: "DisabledBuy",
  // A listed buyback wallet's wrapped-SOL account that does not exist.
  6027: "AccountTypeNotSupported",
  6039: "BuyNotEnoughQuoteTokensToCoverFees",
  6040: "BuySlippageBelowMinBaseAmountOut",
  6041: "MayhemModeDisabled",
  // The buyback account belongs to a wallet that is not on the list.
  6053: "BuybackFeeRecipientNotAuthorized",
  6059: "MissingCashbackAccounts",
  6062: "InvalidPoolV2",
  6079: "CashbackCoinNotSupported",
  6080: "MayhemPoolNotSupported",
  6083: "FeeConfigTooShort",
};

/** Anchor framework errors, raised by any Anchor program (a few common ones). */
export const ANCHOR_ERRORS: Readonly<Record<number, string>> = {
  100: "InstructionMissing",
  101: "InstructionFallbackNotFound",
  102: "InstructionDidNotDeserialize",
  2000: "ConstraintMut",
  2001: "ConstraintHasOne",
  2002: "ConstraintSigner",
  2003: "ConstraintRaw",
  2006: "ConstraintSeeds",
  2012: "ConstraintAddress",
  3001: "AccountDiscriminatorNotFound",
  3002: "AccountDiscriminatorMismatch",
  3007: "AccountOwnedByWrongProgram",
  3012: "AccountNotInitialized",
};

export type FailureKind =
  /** pump (6042) or PumpSwap (6040) refused the buy at this rung's minimum: try the next rung. */
  | "slippage"
  /** Rung says the order already bought: stop. */
  | "order-filled"
  /** Any other Rung error. */
  | "rung"
  | "other";

export interface Failure {
  kind: FailureKind;
  /** Top-level instruction that failed, if the error names one. */
  instructionIndex?: number;
  /** Program that raised the error (innermost), when the logs show it. */
  programId?: PublicKey;
  code?: number;
  /** Error name, if the (program, code) pair is known. */
  name?: string;
  /** The raw error, for anything not decoded above. */
  raw: unknown;
}

/** Name of `code` as raised by `programId`. Codes below 6000 are Anchor's own. */
export function errorName(programId: PublicKey | undefined, code: number): string | undefined {
  const anchor = [RUNG_PROGRAM_ID, PUMP_PROGRAM_ID, PUMP_SWAP_PROGRAM_ID];
  if (programId && code < 6000 && anchor.some((id) => programId.equals(id))) return ANCHOR_ERRORS[code];
  if (programId?.equals(RUNG_PROGRAM_ID)) return RUNG_ERRORS[code];
  if (programId?.equals(PUMP_PROGRAM_ID)) return PUMP_ERRORS[code];
  if (programId?.equals(PUMP_SWAP_PROGRAM_ID)) return PUMP_SWAP_ERRORS[code];
  return undefined;
}

/** A venue's own "fewer tokens than the minimum" error: pump 6042, PumpSwap 6040. */
export function isVenueSlippage(programId: PublicKey | undefined, code: number | undefined): boolean {
  if (!programId || code === undefined) return false;
  return (
    (programId.equals(PUMP_PROGRAM_ID) && code === PUMP_SLIPPAGE_ERROR) ||
    (programId.equals(PUMP_SWAP_PROGRAM_ID) && code === PUMP_SWAP_SLIPPAGE_ERROR)
  );
}

const FAILED = /^Program (\S+) failed: (.*)$/;
const CUSTOM = /custom program error: 0x([0-9a-fA-F]+)/;

/** The innermost failing program and its custom code, from the logs. */
export function failingProgramFromLogs(logs: readonly string[]): { programId: PublicKey; code?: number } | undefined {
  for (const line of logs) {
    const m = FAILED.exec(line);
    if (!m) continue;
    let programId: PublicKey;
    try {
      programId = new PublicKey(m[1]);
    } catch {
      continue;
    }
    const custom = CUSTOM.exec(m[2]);
    return { programId, code: custom ? parseInt(custom[1], 16) : undefined };
  }
  return undefined;
}

/**
 * Classifies a failed transaction from its error (`meta.err`, e.g.
 * `{ InstructionError: [2, { Custom: 6042 }] }`) and its logs.
 * `programIds` are the transaction's top-level programs, in order; they name
 * the program when the logs do not (for example when they were truncated).
 */
export function classifyFailure(err: unknown, logs: readonly string[] = [], programIds: readonly PublicKey[] = []): Failure {
  const failure: Failure = { kind: "other", raw: err };
  const ie = (err as { InstructionError?: [number, unknown] } | null)?.InstructionError;
  if (Array.isArray(ie)) {
    failure.instructionIndex = ie[0];
    const detail = ie[1] as { Custom?: number } | string;
    if (typeof detail === "object" && detail !== null && typeof detail.Custom === "number") failure.code = detail.Custom;
  }
  const fromLogs = failingProgramFromLogs(logs);
  if (fromLogs && (failure.code === undefined || fromLogs.code === undefined || fromLogs.code === failure.code)) {
    failure.programId = fromLogs.programId;
    failure.code ??= fromLogs.code;
  } else if (failure.instructionIndex !== undefined && programIds[failure.instructionIndex]) {
    failure.programId = programIds[failure.instructionIndex];
  }
  if (failure.code !== undefined) failure.name = errorName(failure.programId, failure.code);

  const by = (id: PublicKey) => failure.programId?.equals(id) ?? false;
  if (isVenueSlippage(failure.programId, failure.code)) failure.kind = "slippage";
  else if (by(RUNG_PROGRAM_ID) && failure.name === "OrderFilled") failure.kind = "order-filled";
  else if (by(RUNG_PROGRAM_ID)) failure.kind = "rung";
  return failure;
}

/** One line for a receipt or a log. */
export function describeFailure(f: Failure): string {
  const who = f.programId
    ? f.programId.equals(RUNG_PROGRAM_ID)
      ? "rung"
      : f.programId.equals(PUMP_PROGRAM_ID)
        ? "pump"
        : f.programId.equals(PUMP_SWAP_PROGRAM_ID)
          ? "PumpSwap"
          : f.programId.equals(COMPUTE_BUDGET_PROGRAM_ID)
          ? "compute budget"
          : f.programId.toBase58()
    : "unknown program";
  const what = f.code !== undefined ? `${f.name ?? "error"} (${f.code})` : JSON.stringify(f.raw);
  return `${who}: ${what}`;
}
