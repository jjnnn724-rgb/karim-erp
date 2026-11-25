import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isElectronRenderer, offlineReceiptLines } from './pos-offline';
import { setUiFlag } from './ui-flags';

describe('B1 Electron + fiscal receipt', () => {
  beforeEach(() => { localStorage.clear(); setUiFlag('posOfflineQueue', false); });
  afterEach(() => { localStorage.clear(); setUiFlag('posOfflineQueue', false); });

  it('يكتشف Electron renderer عبر الجسر الآمن فقط', () => {
    expect(isElectronRenderer()).toBe(false);
    (window as unknown as { electronAPI?: unknown }).electronAPI = {};
    expect(isElectronRenderer()).toBe(true);
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('إيصال offline يحمل PENDING FISCAL + المعرّف المحلي', () => {
    const lines = offlineReceiptLines('tx-123');
    expect(lines[0]).toBe('PENDING FISCAL');
    expect(lines[1]).toContain('tx-123');
    expect(lines.join('\n')).not.toMatch(/\d{15}/); // لا رقم ضريبي
  });
});
