import type { SVGProps } from "react";

interface BottleIconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  strokeWidth?: number;
}

/**
 * Hand-crafted bottle icon on a 24px Lucide grid.
 * Thin stroke, round linecap/join, currentColor.
 * Shape: bottle body, neck, cork stopper, tiny rectangle = rolled paper inside.
 */
export function BottleIcon({
  size = 24,
  strokeWidth = 1.5,
  ...props
}: BottleIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* Bottle body — rounded flask shape */}
      <path d="M9 12.5C8 13.5 7 15 7 17a5 5 0 0 0 10 0c0-2-1-3.5-2-4.5V9h-5v3.5z" />
      {/* Neck */}
      <line x1="9" y1="9" x2="15" y2="9" />
      {/* Cork stopper */}
      <rect x="10" y="5.5" width="4" height="3.5" rx="1" />
      {/* Hint of rolled paper inside body */}
      <rect x="10.5" y="14" width="3" height="4" rx="0.5" opacity="0.6" />
    </svg>
  );
}
