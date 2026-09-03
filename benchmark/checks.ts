/**
 * Reusable, pure correctness checks for benchmark tasks. Each factory
 * returns a function of `replies: string[]` (never touching a model,
 * the network, or any other external state), so the same replies always
 * produce the same verdict.
 */

/** Case-insensitive substring check against the reply to the task's final turn. */
export function finalReplyContains(needle: string): (replies: string[]) => boolean {
  return (replies) => lastReply(replies).toLowerCase().includes(needle.toLowerCase());
}

/** All of `needles` must appear (case-insensitively) in the final turn's reply. */
export function finalReplyContainsAll(needles: string[]): (replies: string[]) => boolean {
  return (replies) => {
    const last = lastReply(replies).toLowerCase();
    return needles.every((needle) => last.includes(needle.toLowerCase()));
  };
}

/**
 * Every number in `numbers` must appear in the final turn's reply as a
 * standalone number - not as a substring of a longer digit run (so a check
 * for `42` does not accept `142`).
 */
export function finalReplyContainsNumbers(numbers: number[]): (replies: string[]) => boolean {
  return (replies) => {
    const last = lastReply(replies);
    return numbers.every((n) => new RegExp(`(?<!\\d)${n}(?!\\d)`).test(last));
  };
}

function lastReply(replies: string[]): string {
  return replies[replies.length - 1] ?? '';
}
