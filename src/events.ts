import { EventHandler } from '@create-figma-plugin/utilities';

// パネルに映す状態。main が組んで UI へ渡す唯一の型。
export interface RowView {
  id: string;
  name: string;
  color: string;
  count: number;
}

export interface BoardView {
  id: string;
  name: string;
  label: string;
  rowCount: number;
}

export interface ColorPreset {
  key: string;
  label: string;
  hex: string;
}

export interface PanelState {
  boards: BoardView[];
  activeBoardId: string | null;
  rows: RowView[];
  presets: ColorPreset[];
  autoArrange: boolean;
  subscriptions: string[];
}

// UI → main
export interface RequestStateHandler extends EventHandler {
  name: 'REQUEST_STATE';
  handler: () => void;
}
export interface CreateBoardHandler extends EventHandler {
  name: 'CREATE_BOARD';
  handler: () => void;
}
export interface AddRowHandler extends EventHandler {
  name: 'ADD_ROW';
  handler: () => void;
}
export interface DeleteRowHandler extends EventHandler {
  name: 'DELETE_ROW';
  handler: (rowId: string) => void;
}
export interface RenameRowHandler extends EventHandler {
  name: 'RENAME_ROW';
  handler: (rowId: string, name: string) => void;
}
export interface SetRowColorHandler extends EventHandler {
  name: 'SET_ROW_COLOR';
  handler: (rowId: string, colorKey: string) => void;
}
export interface MoveRowHandler extends EventHandler {
  name: 'MOVE_ROW';
  handler: (rowId: string, direction: 'up' | 'down') => void;
}
export interface ReorderRowsHandler extends EventHandler {
  name: 'REORDER_ROWS';
  handler: (rowIds: string[]) => void;
}
export interface SelectBoardHandler extends EventHandler {
  name: 'SELECT_BOARD';
  handler: (boardId: string) => void;
}
export interface SetBoardNameHandler extends EventHandler {
  name: 'SET_BOARD_NAME';
  handler: (boardId: string, name: string) => void;
}
export interface ArrangeNowHandler extends EventHandler {
  name: 'ARRANGE_NOW';
  handler: () => void;
}
export interface SetAutoArrangeHandler extends EventHandler {
  name: 'SET_AUTO_ARRANGE';
  handler: (enabled: boolean) => void;
}

// main → UI
export interface StateHandler extends EventHandler {
  name: 'STATE';
  handler: (state: PanelState) => void;
}
