/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface LyricLine {
  id: string;
  text: string;
  startTime: number; // in seconds
  endTime?: number;
}

export interface TeleprompterSettings {
  bpm: number;
  fontSize: number;
  lineHeight: number;
  scrollSpeed: number;
  isAutoScroll: boolean;
  highlightActive: boolean;
}
