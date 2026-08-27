"use client";

import { Check, ShoppingBag, UserRound } from "@/components/Icons";
import type { NeededItem } from "@/types/handoff";

export type NeededItemCardProps = {
  item: NeededItem;
  onClaim?: (itemId: string) => void;
  onComplete?: (itemId: string) => void;
  busy?: boolean;
};

export function NeededItemCard({ item, onClaim, onComplete, busy = false }: NeededItemCardProps) {
  const isPurchased = item.status === "purchased";
  return (
    <article className="rounded-2xl border border-[var(--color-divider)] bg-[#fbfaf5] p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eef4f1] text-[var(--color-primary)]">
          {isPurchased ? <Check aria-hidden="true" size={20} /> : <ShoppingBag aria-hidden="true" size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-[var(--color-heading)]">{item.name}</h4>
          {item.claimedBy ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--color-secondary)]">
              <UserRound aria-hidden="true" size={14} />
              {item.claimedBy.displayName}さんが担当
            </p>
          ) : (
            <p className="mt-1 text-xs text-[var(--color-secondary)]">まだ担当は決まっていません</p>
          )}
        </div>
      </div>

      {item.status === "needed" ? (
        <button
          className="primary-button mt-4 w-full"
          disabled={busy || !onClaim}
          onClick={() => onClaim?.(item.id)}
          type="button"
        >
          購入します
        </button>
      ) : (
        <button
          className={isPurchased ? "secondary-button mt-4 w-full" : "primary-button mt-4 w-full"}
          disabled={busy || isPurchased || !onComplete}
          onClick={() => onComplete?.(item.id)}
          type="button"
        >
          {isPurchased ? <Check aria-hidden="true" size={19} /> : null}
          購入しました
        </button>
      )}
    </article>
  );
}
