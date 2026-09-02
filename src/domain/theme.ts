// 盤面の配色。Figma のノードには触らない。
//
// キャンバス上のノードの塗りはドキュメントのデータなので、見る人ごとには
// 変えられない。ダークで見ている人とライトで見ている人に同じ色が見える。
// Figma 自身も同じ制約の中にいて、テーマは「新規ファイルの既定の背景色」を
// 決めるだけ（既存ファイルの背景は変わらない）。
//
// なのでこれは「見る人のテーマへの自動追従」ではなく、盤面ごとに1つ選ぶ設定。
// 初期値は、そのページのキャンバス背景の明暗から決める。エディタのテーマ設定
// より、実際に画面に映っている背景に合わせるほうが外さない。

import { Rgb } from './color';

export type BoardTheme = 'light' | 'dark';

export interface BoardPalette {
  /** 行の中身の面 */
  content: string;
  /** 行の境界線 */
  border: string;
  /** 見出しの文字 */
  title: string;
}

export const BOARD_PALETTES: Record<BoardTheme, BoardPalette> = {
  // ダークは tiermaker と同じ、暗い面に色セルが浮く見た目
  dark: { content: '#1B1B1B', border: '#3D3D3D', title: '#F2F2F2' },
  // ライトは面をキャンバスより明るくして、カードとして浮かせる。キャンバスと
  // 同じ明るさにすると境界線しか見えなくなる。
  light: { content: '#FFFFFF', border: '#D5D5D5', title: '#1E1E1E' },
};

export const DEFAULT_BOARD_THEME: BoardTheme = 'dark';

export function paletteFor(theme: BoardTheme): BoardPalette {
  return BOARD_PALETTES[theme];
}

export function parseTheme(value: string, fallback: BoardTheme): BoardTheme {
  return value === 'light' || value === 'dark' ? value : fallback;
}

// sRGB の相対輝度。単純な平均だと緑を過小に、青を過大に評価する。
export function relativeLuminance(color: Rgb): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

// キャンバス背景の明暗から配色を決める。背景が読めなければ既定のまま。
export function themeForBackground(background: Rgb | null, fallback: BoardTheme): BoardTheme {
  if (background === null) {
    return fallback;
  }
  return relativeLuminance(background) < 0.5 ? 'dark' : 'light';
}
