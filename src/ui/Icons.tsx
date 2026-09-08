type P = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IcWalk = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <circle cx="13" cy="4" r="1.8" fill="currentColor" stroke="none" />
    <path d="M11 21l1.6-5.2L10 13l.8-4.4L8 10l-.9 2.6" />
    <path d="M12.6 15.8L15.4 21" />
    <path d="M10.8 8.6l3.1 1.4 1.8 2.6" />
  </svg>
);

export const IcBus = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <rect x="4" y="3.5" width="16" height="13.5" rx="2.6" />
    <path d="M4 10.5h16" />
    <path d="M7.5 13.8h.01M16.5 13.8h.01" strokeWidth="2.6" />
    <path d="M6.5 17v2.4M17.5 17v2.4" />
  </svg>
);

export const IcCar = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M3 12.5l1.7-4.6A2.4 2.4 0 017 6.3h10a2.4 2.4 0 012.3 1.6L21 12.5" />
    <rect x="2.5" y="12.3" width="19" height="5.4" rx="1.8" />
    <path d="M6 17.7v1.6M18 17.7v1.6" />
    <path d="M6.2 15h.01M17.8 15h.01" strokeWidth="2.4" />
  </svg>
);

export const IcBike = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <circle cx="5.6" cy="17" r="3.4" />
    <circle cx="18.4" cy="17" r="3.4" />
    <path d="M5.6 17l4-8.4h4.2" />
    <path d="M9.6 8.6l5 8.4" />
    <path d="M14.6 8.6h2.6" />
    <circle cx="11.6" cy="17" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

export const IcTarget = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="7.2" />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
    <path d="M12 1.6v3M12 19.4v3M1.6 12h3M19.4 12h3" />
  </svg>
);

export const IcSearch = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="6.6" />
    <path d="M15.8 15.8L21 21" />
  </svg>
);

export const IcPin = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M12 21.5s7-6.1 7-11a7 7 0 10-14 0c0 4.9 7 11 7 11z" />
    <circle cx="12" cy="10.4" r="2.5" />
  </svg>
);

export const IcClock = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.2V12l3.1 1.9" />
  </svg>
);

export const IcArrow = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M4.5 12h14.4" />
    <path d="M13.4 6.6L19 12l-5.6 5.4" />
  </svg>
);

export const IcSwap = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M7.5 4.5v14M7.5 18.5l-3-3M7.5 18.5l3-3" />
    <path d="M16.5 19.5v-14M16.5 5.5l-3 3M16.5 5.5l3 3" />
  </svg>
);

export const IcHistory = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M3.6 12a8.4 8.4 0 103-6.4" />
    <path d="M3.4 4.4v3.9h3.9" />
    <path d="M12 7.6V12l3 1.8" />
  </svg>
);

export const IcLayers = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M12 3.2L2.8 8 12 12.8 21.2 8 12 3.2z" />
    <path d="M2.8 13.2L12 18l9.2-4.8" />
  </svg>
);

export const IcClose = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />
  </svg>
);

export const IcCheck = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
);

export const IcFlag = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M5.5 21V4" />
    <path d="M5.5 5.2h11l-2 3.4 2 3.4h-11" />
  </svg>
);

export const IcPlay = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M7 4.8l11 7.2-11 7.2V4.8z" fill="currentColor" />
  </svg>
);

export const IcStop = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
  </svg>
);

export const IcCube = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M12 2.8l8 4.4v9.6l-8 4.4-8-4.4V7.2l8-4.4z" />
    <path d="M4 7.2l8 4.4 8-4.4M12 11.6V21.2" />
  </svg>
);

export const IcTrain = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <rect x="5" y="3" width="14" height="13" rx="3" />
    <path d="M5 10.5h14" />
    <path d="M8.5 13.4h.01M15.5 13.4h.01" strokeWidth="2.6" />
    <path d="M8 16l-2 4M16 16l2 4" />
    <path d="M9 6.6h6" />
  </svg>
);

export const IcMapPin = ({ size = 18 }: P) => (
  <svg {...base(size)}>
    <path d="M4 7.4l5-2.2 6 2.6 5-2.2v11l-5 2.2-6-2.6-5 2.2v-11z" />
    <path d="M9 5.2v13.6M15 7.8v13" />
  </svg>
);
