import "server-only";

const WINDOW_MS = 10 * 60 * 1_000;
const MEMBER_MAX_REQUESTS = 3;
const HOUSEHOLD_MAX_REQUESTS = 10;
const MEMBER_MAX_CONCURRENT = 1;
const HOUSEHOLD_MAX_CONCURRENT = 2;
const MAX_BUCKETS = 2_000;

type Bucket = {
  active: number;
  attempts: number[];
  touchedAt: number;
};

type GuardInput = Readonly<{
  householdId: string;
  memberId: string;
  now?: number;
}>;

export type OpenAIRequestGuardResult =
  | Readonly<{ release: () => void; status: "allowed" }>
  | Readonly<{
      retryAfterSeconds: number;
      status: "busy" | "rate_limited";
    }>;

const memberBuckets = new Map<string, Bucket>();
const householdBuckets = new Map<string, Bucket>();

function compact(bucket: Bucket, now: number) {
  const cutoff = now - WINDOW_MS;
  bucket.attempts = bucket.attempts.filter((attempt) => attempt > cutoff);
  bucket.touchedAt = now;
}

function bucketFor(buckets: Map<string, Bucket>, key: string, now: number) {
  const existing = buckets.get(key);
  if (existing) {
    compact(existing, now);
    return existing;
  }

  const created: Bucket = { active: 0, attempts: [], touchedAt: now };
  buckets.set(key, created);
  return created;
}

function prune(buckets: Map<string, Bucket>, now: number) {
  if (buckets.size <= MAX_BUCKETS) return;
  const staleBefore = now - WINDOW_MS;
  for (const [key, bucket] of buckets) {
    if (bucket.active === 0 && bucket.touchedAt <= staleBefore) {
      buckets.delete(key);
    }
    if (buckets.size <= MAX_BUCKETS) return;
  }
}

function retryAfter(bucket: Bucket, maximum: number, now: number) {
  if (bucket.attempts.length < maximum) return 1;
  const oldest = bucket.attempts[0] ?? now;
  return Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1_000));
}

function validSubject(value: string) {
  return value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

export function acquireOpenAIRequestSlot({
  householdId,
  memberId,
  now = Date.now(),
}: GuardInput): OpenAIRequestGuardResult {
  if (!validSubject(memberId) || !validSubject(householdId)) {
    return { retryAfterSeconds: 600, status: "rate_limited" };
  }

  prune(memberBuckets, now);
  prune(householdBuckets, now);
  const member = bucketFor(memberBuckets, memberId, now);
  const household = bucketFor(householdBuckets, householdId, now);

  if (
    member.active >= MEMBER_MAX_CONCURRENT ||
    household.active >= HOUSEHOLD_MAX_CONCURRENT
  ) {
    return { retryAfterSeconds: 1, status: "busy" };
  }
  if (
    member.attempts.length >= MEMBER_MAX_REQUESTS ||
    household.attempts.length >= HOUSEHOLD_MAX_REQUESTS
  ) {
    return {
      retryAfterSeconds: Math.max(
        retryAfter(member, MEMBER_MAX_REQUESTS, now),
        retryAfter(household, HOUSEHOLD_MAX_REQUESTS, now),
      ),
      status: "rate_limited",
    };
  }

  member.active += 1;
  household.active += 1;
  member.attempts.push(now);
  household.attempts.push(now);
  let released = false;

  return {
    status: "allowed",
    release() {
      if (released) return;
      released = true;
      member.active = Math.max(0, member.active - 1);
      household.active = Math.max(0, household.active - 1);
    },
  };
}

export function resetOpenAIRequestGuardForTests() {
  memberBuckets.clear();
  householdBuckets.clear();
}
