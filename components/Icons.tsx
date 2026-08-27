import type { ReactNode, SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: string | number;
  strokeWidth?: string | number;
};

function IconBase({
  children,
  size = 24,
  strokeWidth = 2,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
    </svg>
  );
}

export function Camera(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14.5 4 16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3l1.5-3h5Z" />
      <circle cx="12" cy="13" r="4" />
    </IconBase>
  );
}

export function HeartHandshake(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
      <path d="m8.5 12 2 2 5-5" />
    </IconBase>
  );
}

export function FlaskConical(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 3h6" />
      <path d="M10 9V3h4v6l5 9a2 2 0 0 1-1.7 3H6.7A2 2 0 0 1 5 18l5-9Z" />
      <path d="M7.5 16h9" />
    </IconBase>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </IconBase>
  );
}

export function ArrowLeft(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </IconBase>
  );
}

export function RotateCcw(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </IconBase>
  );
}

export function Mic(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect height="12" rx="3" width="7" x="8.5" y="2" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v4M9 21h6" />
    </IconBase>
  );
}

export function Square(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect height="14" rx="2" width="14" x="5" y="5" />
    </IconBase>
  );
}

export function Check(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m5 12 4 4L19 6" />
    </IconBase>
  );
}

export function CircleCheck(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </IconBase>
  );
}

export function Send(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
      <path d="M22 2 11 13" />
    </IconBase>
  );
}

export function ShoppingBag(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 8h12l1 13H5L6 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </IconBase>
  );
}

export function UserRound(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </IconBase>
  );
}

export function Clock3(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </IconBase>
  );
}

export function Sparkles(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3Z" />
      <path d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14ZM19 13l.7 1.8 1.8.7-1.8.7L19 18l-.7-1.8-1.8-.7 1.8-.7L19 13Z" />
    </IconBase>
  );
}

export function ShieldCheck(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3 20 6v6c0 5-3.4 8-8 9-4.6-1-8-4-8-9V6l8-3Z" />
      <path d="m8 12 2.5 2.5L16 9" />
    </IconBase>
  );
}

export function AlertTriangle(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10.3 4.3 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </IconBase>
  );
}

export function ImagePlus(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect height="16" rx="2" width="18" x="3" y="5" />
      <circle cx="9" cy="11" r="2" />
      <path d="m21 16-4-4-8 8M17 2v6M14 5h6" />
    </IconBase>
  );
}

export function SwitchCamera(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-1.5-3h-5L8 7Z" />
      <path d="m9 11-2 2 2 2M15 15l2-2-2-2M7 13h10" />
    </IconBase>
  );
}

export function X(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </IconBase>
  );
}
