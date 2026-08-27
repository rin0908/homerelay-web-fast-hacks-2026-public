import type { MemberRole } from "@/types/handoff";

const ROLE_LABELS: Record<MemberRole, string> = {
  family: "ご家族",
  relative: "ご親族",
  helper: "訪問ヘルパー",
};

const ROLE_STYLES: Record<MemberRole, string> = {
  family: "border-[#c9ded6] bg-[#edf6f2] text-[#315c52]",
  relative: "border-[#ddd1e5] bg-[#f7f0fa] text-[#655273]",
  helper: "border-[#e5d3bd] bg-[#fff5e9] text-[#76522f]",
};

export function getRoleLabel(role: MemberRole): string {
  return ROLE_LABELS[role];
}

export function RoleBadge({ role }: { role: MemberRole }) {
  return (
    <span
      className={`inline-flex min-h-8 items-center rounded-full border px-3 py-1 text-xs font-semibold ${ROLE_STYLES[role]}`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}
