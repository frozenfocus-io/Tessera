import type { JSX } from 'preact';

type IconProps = { size?: number; class?: string; title?: string };

function Svg(props: IconProps & { children: JSX.Element | JSX.Element[] }) {
  const s = props.size ?? 16;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class}
      aria-hidden={props.title ? undefined : 'true'}
      role={props.title ? 'img' : undefined}
    >
      {props.title ? <title>{props.title}</title> : null}
      {props.children}
    </svg>
  );
}

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
);
export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);
export const IconUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10l4-4 4 4" />
  </Svg>
);
export const IconDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6l4 4 4-4" />
  </Svg>
);
export const IconFrame = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3" />
    <path d="M8 5l3 1.6v3.3L8 11.5 5 9.9V6.6z" />
  </Svg>
);
export const IconTop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="10" height="10" rx="1" />
    <path d="M3 8h10M8 3v10" />
  </Svg>
);
export const IconCamera = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 5.5h2.5l1.2-1.8h3.6L11 5.5h2.5v7h-11z" />
    <circle cx="8" cy="9" r="2.2" />
  </Svg>
);
export const IconGauge = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.8 11.5a5.5 5.5 0 1 1 10.4 0" />
    <path d="M8 9.5l2.5-3" />
  </Svg>
);
export const IconPackage = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 5L8 2.5 13.5 5v6L8 13.5 2.5 11z" />
    <path d="M2.5 5L8 7.5 13.5 5M8 7.5v6" />
  </Svg>
);
export const IconHelp = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M6.4 6.3a1.7 1.7 0 1 1 2.3 1.6c-.5.2-.7.6-.7 1.1v.3" />
    <path d="M8 11.3v.1" />
  </Svg>
);
export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Svg>
);
export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
    <path d="M10.5 3.5v-1h-8v8h1" />
  </Svg>
);
export const IconLayers = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2.5l5.5 2.8L8 8.1 2.5 5.3z" />
    <path d="M2.5 8l5.5 2.8L13.5 8M2.5 10.7l5.5 2.8 5.5-2.8" />
  </Svg>
);
export const IconOpen = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12.5v-9h4l1.5 1.5h5.5v7.5z" />
    <path d="M8 7.5v3.5M6.3 9.2L8 7.5l1.7 1.7" />
  </Svg>
);
export const IconStripes = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
    <path d="M2.5 9.5l7-7M6.5 13.5l7-7" />
  </Svg>
);

/** The Tessera mark: four mosaic tiles. */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1" y="1" width="8.4" height="8.4" rx="1.2" fill="#48c4b0" />
      <rect x="10.6" y="1" width="8.4" height="8.4" rx="1.2" fill="#e9e4d9" />
      <rect x="1" y="10.6" width="8.4" height="8.4" rx="1.2" fill="#7b786f" />
      <rect x="10.6" y="10.6" width="8.4" height="8.4" rx="1.2" fill="#ffd23f" />
    </svg>
  );
}
