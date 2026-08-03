import type { SVGProps } from "react";

interface BottleIconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  strokeWidth?: number;
}

/**
 * Horizontal bottle icon on a 24px Lucide grid.
 * Bottle lies on its side: rounded body, short neck on left, cork stopper,
 * small rolled note visible inside the body.
 * Thin stroke, round linecap/join, currentColor.
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
      {/* Bottle body — rounded rectangle lying horizontal */}
      <rect x="7" y="8" width="13" height="8" rx="3.5" />
      {/* Neck — narrow horizontal segment extending left from body */}
      <path d="M7 10.5H4.5" strokeWidth={strokeWidth} />
      <path d="M7 13.5H4.5" strokeWidth={strokeWidth} />
      {/* Cork stopper — small rect plugging the neck tip */}
      <rect x="2.5" y="10" width="2" height="4" rx="0.75" />
      {/* Rolled note inside body — small tilted rounded rect */}
      <rect
        x="11.5"
        y="10"
        width="4"
        height="4"
        rx="1"
        transform="rotate(-8 13.5 12)"
        opacity="0.55"
      />
    </svg>
  );
}
