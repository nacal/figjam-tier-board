import {
  Button,
  Checkbox,
  Container,
  Divider,
  Dropdown,
  IconButton,
  Muted,
  render,
  Text,
  Textbox,
  VerticalSpace,
} from '@create-figma-plugin/ui';
import { emit, on } from '@create-figma-plugin/utilities';
import { h, JSX } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';

import {
  AddRowHandler,
  ArrangeNowHandler,
  BoardView,
  CreateBoardHandler,
  DeleteRowHandler,
  MoveRowHandler,
  PanelState,
  RenameRowHandler,
  ReorderRowsHandler,
  RequestStateHandler,
  RowView,
  SelectBoardHandler,
  SetAutoArrangeHandler,
  SetBoardNameHandler,
  SetRowColorHandler,
  StateHandler,
} from './events';
import styles from './ui.css';

const EMPTY: PanelState = {
  boards: [],
  activeBoardId: null,
  rows: [],
  presets: [],
  autoArrange: true,
  subscriptions: [],
};

function Plugin(): JSX.Element {
  const [state, setState] = useState<PanelState>(EMPTY);
  const [openPalette, setOpenPalette] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  // 並べ替え中はキャンバス側からの状態で上書きしない（掴んでいる行が消える）
  const [localRows, setLocalRows] = useState<RowView[] | null>(null);
  // 入力中の名前。キャンバス側からの状態でカーソルが飛ばないように下書きを持つ。
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    const off = on<StateHandler>('STATE', (next) => {
      setState(next);
      setLocalRows(null);
    });
    emit<RequestStateHandler>('REQUEST_STATE');
    return off;
  }, []);

  const rows = localRows ?? state.rows;
  const activeBoard = state.boards.find((board) => board.id === state.activeBoardId) ?? null;

  const hexOf = useCallback(
    (key: string): string => state.presets.find((preset) => preset.key === key)?.hex ?? '#d9d9d9',
    [state.presets],
  );

  function handleDrop(target: RowView, after: boolean): void {
    if (dragId === null || dragId === target.id) {
      return;
    }
    const from = rows.findIndex((row) => row.id === dragId);
    if (from < 0) {
      return;
    }
    const next = rows.slice();
    const [moved] = next.splice(from, 1);
    next.splice(next.findIndex((row) => row.id === target.id) + (after ? 1 : 0), 0, moved);
    setLocalRows(next);
    setDragId(null);
    setDropTarget(null);
    emit<ReorderRowsHandler>('REORDER_ROWS', next.map((row) => row.id));
  }

  return (
    <Container space="small">
      <VerticalSpace space="small" />

      <div style={{ display: 'flex', gap: '8px' }}>
        <Button onClick={() => emit<CreateBoardHandler>('CREATE_BOARD')}>盤面を作成</Button>
        <Button secondary onClick={() => emit<AddRowHandler>('ADD_ROW')}>
          行を追加
        </Button>
        <Button
          secondary
          disabled={state.boards.length === 0}
          onClick={() => emit<ArrangeNowHandler>('ARRANGE_NOW')}
        >
          今すぐ整列
        </Button>
      </div>

      {state.boards.length > 0 ? (
        <BoardBar boards={state.boards} active={activeBoard} />
      ) : null}

      <VerticalSpace space="small" />
      <Checkbox
        value={state.autoArrange}
        onValueChange={(value) => emit<SetAutoArrangeHandler>('SET_AUTO_ARRANGE', value)}
      >
        <Text>ドラッグしたら左寄せで自動整列</Text>
      </Checkbox>
      <VerticalSpace space="small" />
      <Divider />
      <VerticalSpace space="small" />

      {rows.length === 0 ? (
        <div class={styles.empty}>
          <Muted>このページにはまだ Tier 表がありません。</Muted>
        </div>
      ) : (
        <ul class={styles.rows}>
          {rows.map((row, index) => (
            <li key={row.id}>
              <div
                class={[
                  styles.row,
                  dragId === row.id ? styles.dragging : '',
                  dropTarget?.id === row.id && !dropTarget.after ? styles.dropBefore : '',
                  dropTarget?.id === row.id && dropTarget.after ? styles.dropAfter : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                draggable={dragId === row.id}
                onDragStart={() => setDragId(row.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setDropTarget(null);
                }}
                onDragOver={(event: DragEvent) => {
                  if (dragId === null || dragId === row.id) {
                    return;
                  }
                  event.preventDefault();
                  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
                  setDropTarget({ id: row.id, after: event.clientY > box.top + box.height / 2 });
                }}
                onDrop={(event: DragEvent) => {
                  event.preventDefault();
                  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
                  handleDrop(row, event.clientY > box.top + box.height / 2);
                }}
              >
                {/* ハンドルを押している間だけ draggable にする。行全体を掴めると
                    名前の入力欄でテキストを選べなくなる。 */}
                <span
                  class={styles.handle}
                  title="ドラッグして行の順序を入れ替え"
                  onMouseDown={() => setDragId(row.id)}
                  onMouseUp={() => setDragId(null)}
                >
                  ⠿
                </span>

                <button
                  class={styles.swatch}
                  style={{ background: hexOf(row.color) }}
                  title="色を変更"
                  onClick={() => setOpenPalette(openPalette === row.id ? null : row.id)}
                />

                <div class={styles.name}>
                  <Textbox
                    value={drafts[row.id] ?? row.name}
                    onValueInput={(value: string) => {
                      setDrafts({ ...drafts, [row.id]: value });
                    }}
                    onBlur={() => {
                      const draft = drafts[row.id];
                      const next = { ...drafts };
                      delete next[row.id];
                      setDrafts(next);
                      if (draft !== undefined && draft.trim() !== '' && draft !== row.name) {
                        emit<RenameRowHandler>('RENAME_ROW', row.id, draft);
                      }
                    }}
                  />
                </div>

                <span class={styles.count} title="この行のアイテム数">
                  {row.count > 0 ? row.count : ''}
                </span>

                <IconButton
                  disabled={index === 0}
                  onClick={() => emit<MoveRowHandler>('MOVE_ROW', row.id, 'up')}
                >
                  <Text>↑</Text>
                </IconButton>
                <IconButton
                  disabled={index === rows.length - 1}
                  onClick={() => emit<MoveRowHandler>('MOVE_ROW', row.id, 'down')}
                >
                  <Text>↓</Text>
                </IconButton>
                <IconButton onClick={() => emit<DeleteRowHandler>('DELETE_ROW', row.id)}>
                  <Text>✕</Text>
                </IconButton>
              </div>

              {openPalette === row.id ? (
                <div class={styles.palette}>
                  {state.presets.map((preset) => (
                    <button
                      key={preset.key}
                      class={preset.key === row.color ? styles.selected : undefined}
                      style={{ background: preset.hex }}
                      title={preset.label}
                      onClick={() => {
                        setOpenPalette(null);
                        emit<SetRowColorHandler>('SET_ROW_COLOR', row.id, preset.key);
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <VerticalSpace space="small" />
      <Divider />
      <VerticalSpace space="small" />
      <Status subscriptions={state.subscriptions} />
      <VerticalSpace space="small" />
      <Muted>
        付箋は FigJam の素の機能で作り、行にドラッグして並べてください。行の順序は、キャンバス上で
        行を上下にドラッグするか、このパネルの ↑↓ / ⠿ で入れ替えます。どれか1行の右端を引っ張ると、
        その盤面の幅が変わります。盤面はいくつでも作れます。
      </Muted>
      <VerticalSpace space="small" />
    </Container>
  );
}

function BoardBar(props: { boards: BoardView[]; active: BoardView | null }): JSX.Element {
  const { boards, active } = props;
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div>
      <VerticalSpace space="small" />
      {boards.length > 1 ? (
        <Dropdown
          options={boards.map((board) => ({
            value: board.id,
            text: `${board.label}（${board.rowCount}行）`,
          }))}
          value={active?.id ?? null}
          onValueChange={(value) => emit<SelectBoardHandler>('SELECT_BOARD', value)}
        />
      ) : null}
      <VerticalSpace space="extraSmall" />
      <Textbox
        placeholder="盤面の名前（キャンバスに見出しが出ます）"
        value={draft ?? active?.name ?? ''}
        onValueInput={(value: string) => {
          setDraft(value);
        }}
        onBlur={() => {
          if (active !== null && draft !== null && draft !== active.name) {
            emit<SetBoardNameHandler>('SET_BOARD_NAME', active.id, draft);
          }
          setDraft(null);
        }}
      />
    </div>
  );
}

function Status(props: { subscriptions: string[] }): JSX.Element {
  const ok = props.subscriptions.filter((name) => name.indexOf('失敗') < 0);
  return (
    <div class={[styles.status, ok.length === 0 ? styles.statusBad : ''].filter(Boolean).join(' ')}>
      <Muted>
        {ok.length > 0
          ? `キャンバスの変更を購読中: ${props.subscriptions.join(' / ')}`
          : `キャンバスの変更を購読できていません: ${props.subscriptions.join(' / ') || '(なし)'}`}
      </Muted>
    </div>
  );
}

export default render(Plugin);
