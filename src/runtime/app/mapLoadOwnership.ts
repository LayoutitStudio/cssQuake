/** A completed load can lose ownership before an awaiting caller resumes. */
export interface QuakeMapLoadCompletion {
  isCurrent(): boolean;
}

export type QuakeMapLoadResult = QuakeMapLoadCompletion | false;

/** Keep failure ownership alive through async wrappers and catch callbacks too. */
export class QuakeMapLoadFailure extends Error {
  constructor(cause: unknown, readonly isCurrent: () => boolean) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "QuakeMapLoadFailure";
  }
}

export function quakeMapLoadFailureIsCurrent(error: unknown): boolean {
  return !(error instanceof QuakeMapLoadFailure) || error.isCurrent();
}

export function quakeMapLoadFailureCause(error: unknown): unknown {
  return error instanceof QuakeMapLoadFailure ? error.cause : error;
}
