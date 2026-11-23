/**
 * `OnboardingJobEvent` sequences are unique per job, but more than one process
 * appends to a job's log: the worker, and the CRM itself (e.g. a password
 * reveal while the job is still running). A writer that caches the next
 * sequence in memory can therefore collide. On a unique violation (P2002),
 * re-read the sequence and retry instead of failing the job.
 *
 * Returns the sequence the row was finally written at.
 */
export async function insertWithSequenceRetry(
  proposed: number,
  insert: (sequence: number) => Promise<unknown>,
  reseed: () => Promise<number>,
  maxAttempts = 3,
): Promise<number> {
  let sequence = proposed;
  for (let attempt = 1; ; attempt++) {
    try {
      await insert(sequence);
      return sequence;
    } catch (error) {
      const isSequenceCollision = (error as { code?: string } | undefined)?.code === "P2002";
      if (!isSequenceCollision || attempt >= maxAttempts) throw error;
      sequence = await reseed();
    }
  }
}
