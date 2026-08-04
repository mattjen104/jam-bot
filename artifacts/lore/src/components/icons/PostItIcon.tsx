import type { SVGProps } from "react";

interface PostItIconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  strokeWidth?: number;
}

/**
 * Post-it note with dog-ear fold and three scribble lines.
 * 24px Lucide grid, thin stroke, currentColor.
 */
export function PostItIcon({
  size = 24,
  strokeWidth = 1.5,
  ...props
}: PostItIconProps) {
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
      {/* Note body — rounded rect with dog-ear cutout on top-right */}
      <path d="M5 4h10l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      {/* Dog-ear fold triangle */}
      <path d="M15 4v4h4" />
      {/* Scribble lines across the note body */}
      <path d="M7 10h8" />
      <path d="M7 13h6" />
      <path d="M7 16h7" />
    </svg>
  );
}
