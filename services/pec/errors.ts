import { ApiError } from "@/lib/api/errors";

export class PecNotConfiguredError extends ApiError {
  constructor(what = "PEC") {
    super(503, "PEC_NOT_CONFIGURED", `${what} non configurato (variabili PEC_* mancanti)`);
  }
}

export class PecRecipientMissingError extends ApiError {
  constructor() {
    super(422, "PEC_RECIPIENT_MISSING", "L'azienda non ha un indirizzo PEC");
  }
}

export class PecSuppressedError extends ApiError {
  constructor(detail: string) {
    super(409, "PEC_SUPPRESSED", `Destinatario in lista di soppressione: ${detail}`);
  }
}
