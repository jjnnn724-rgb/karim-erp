import { expect, test } from 'vitest';
import { WORKSPACE_PACKAGE, type WorkspacePackage } from './index.js';

test('الحزمة تُصدِّر اسمها بعقدٍ ثابت', () => {
    const name: WorkspacePackage = WORKSPACE_PACKAGE;
    expect(name).toBe('@karim/shared');
});
