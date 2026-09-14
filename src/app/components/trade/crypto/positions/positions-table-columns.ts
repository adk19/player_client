export type PositionsTableKey = 'open' | 'pending' | 'history';

export interface PositionsColDef {
  id: string;
  label: string;
  defaultWidth: number;
  /** S/L, T/P, Close — cannot be hidden */
  protected?: boolean;
  align?: 'left' | 'right';
}

/** Protected column ids (same keys across tables where they exist). */
export const PROTECTED_COLUMN_IDS = new Set(['sl', 'tp', 'close']);

export const POSITIONS_TABLE_COLUMNS: Record<PositionsTableKey, PositionsColDef[]> = {
  open: [
    { id: 'symbol', label: 'Symbol', defaultWidth: 110 },
    { id: 'ticket', label: 'Ticket', defaultWidth: 70 },
    { id: 'time', label: 'Time', defaultWidth: 130 },
    { id: 'type', label: 'Type', defaultWidth: 80 },
    { id: 'volume', label: 'Volume', defaultWidth: 90, align: 'right' },
    { id: 'leverage', label: 'Leverage', defaultWidth: 95, align: 'right' },
    { id: 'usedMargin', label: 'Used margin', defaultWidth: 110, align: 'right' },
    { id: 'openPrice', label: 'Open Price', defaultWidth: 110, align: 'right' },
    { id: 'sl', label: 'S / L', defaultWidth: 110, align: 'right', protected: true },
    { id: 'tp', label: 'T / P', defaultWidth: 110, align: 'right', protected: true },
    { id: 'currentPrice', label: 'Current Price', defaultWidth: 120, align: 'right' },
    { id: 'profit', label: 'P / L', defaultWidth: 110, align: 'right' },
    { id: 'close', label: '', defaultWidth: 110, align: 'right', protected: true }
  ],
  pending: [
    { id: 'symbol', label: 'Symbol', defaultWidth: 110 },
    { id: 'ticket', label: 'ID', defaultWidth: 70 },
    { id: 'time', label: 'Time', defaultWidth: 130 },
    { id: 'type', label: 'Type', defaultWidth: 90 },
    { id: 'volume', label: 'Volume', defaultWidth: 90, align: 'right' },
    { id: 'usedMargin', label: 'Used margin', defaultWidth: 110, align: 'right' },
    { id: 'stopPrice', label: 'Stop Price', defaultWidth: 110, align: 'right' },
    { id: 'limitPrice', label: 'Limit Price', defaultWidth: 110, align: 'right' },
    { id: 'sl', label: 'S / L', defaultWidth: 100, align: 'right', protected: true },
    { id: 'tp', label: 'T / P', defaultWidth: 100, align: 'right', protected: true },
    { id: 'currentPrice', label: 'Current Price', defaultWidth: 120, align: 'right' },
    { id: 'distance', label: 'Distance', defaultWidth: 120, align: 'right' },
    { id: 'expiration', label: 'Expiration', defaultWidth: 160, align: 'right' },
    { id: 'remaining', label: 'Remaining', defaultWidth: 120, align: 'right' },
    { id: 'close', label: '', defaultWidth: 90, align: 'right', protected: true }
  ],
  history: [
    { id: 'symbol', label: 'Symbol', defaultWidth: 110 },
    { id: 'ticket', label: 'Ticket', defaultWidth: 80 },
    { id: 'type', label: 'Type', defaultWidth: 80 },
    { id: 'volume', label: 'Volume', defaultWidth: 90, align: 'right' },
    { id: 'openPrice', label: 'Open Price', defaultWidth: 110, align: 'right' },
    { id: 'close', label: 'Close Price', defaultWidth: 110, align: 'right', protected: true },
    { id: 'opened', label: 'Opened', defaultWidth: 150, align: 'right' },
    { id: 'closed', label: 'Closed', defaultWidth: 150, align: 'right' },
    { id: 'reason', label: 'Reason', defaultWidth: 160, align: 'right' },
    { id: 'profit', label: 'P / L', defaultWidth: 110, align: 'right' }
  ]
};
