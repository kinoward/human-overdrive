import { assetUrl } from '../asset-url';

export const MUSIC_CUES = {
  menu: { src: assetUrl('assets/music/freedom-full.m4a'), volume: 0.32, loop: true },
  drive: { src: assetUrl('assets/music/freedom-drive.m4a'), volume: 0.36, loop: true },
  pursuit: { src: assetUrl('assets/music/freedom-pursuit.m4a'), volume: 0.43, loop: true },
  escaped: { src: assetUrl('assets/music/freedom-escaped.m4a'), volume: 0.38, loop: false },
  failed: { src: assetUrl('assets/music/freedom-failed.m4a'), volume: 0.28, loop: false },
} as const;
