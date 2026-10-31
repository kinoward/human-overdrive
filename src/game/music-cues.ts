const directory = `${import.meta.env.BASE_URL}assets/music/`;

export const MUSIC_CUES = {
  menu: { src: `${directory}freedom-full.m4a`, volume: 0.32, loop: true },
  drive: { src: `${directory}freedom-drive.m4a`, volume: 0.36, loop: true },
  pursuit: { src: `${directory}freedom-pursuit.m4a`, volume: 0.43, loop: true },
  escaped: { src: `${directory}freedom-escaped.m4a`, volume: 0.38, loop: false },
  failed: { src: `${directory}freedom-failed.m4a`, volume: 0.28, loop: false },
} as const;
