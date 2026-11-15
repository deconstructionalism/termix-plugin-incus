import { INCUS_COMMANDS, type IncusCommand } from "./settings.js";

// SSH runs commands through the user's shell, so words that could mean more
// than themselves are refused, not quoted
const SAFE_WORD =
  /^[A-Za-z0-9][A-Za-z0-9_.:/=,-]*$|^\/[A-Za-z0-9_.:/=,-]+$|^--?[A-Za-z][A-Za-z0-9-]*$|^--$/;

export class UnsafeWordError extends Error {
  constructor(word: string) {
    super(`Refused to put ${JSON.stringify(word)} in a command`);
    this.name = "UnsafeWordError";
  }
}

export function commandLine(words: readonly string[]): string {
  for (const word of words) {
    if (!SAFE_WORD.test(word)) throw new UnsafeWordError(word);
  }
  return words.join(" ");
}

export function incus(command: IncusCommand, args: readonly string[]): string {
  return commandLine([...INCUS_COMMANDS[command], ...args]);
}
