/**
 * @karim/shared — عقود وبدائيات مشتركة بين v3 API والواجهة.
 *
 * كل عقد هنا مُشتق من الالتقاط الفعلي (packages/testing/fixtures/accounting),
 * لا من الورق. اختلافه عن القديم = خطأ تكافؤ، لا تحسين.
 */
export const WORKSPACE_PACKAGE = '@karim/shared' as const;

export type WorkspacePackage = typeof WORKSPACE_PACKAGE;

export * from './accounting.js';
export * from './date-only.js';
export * from './errors.js';
export * from './ids.js';
export * from './money.js';
export * from './pagination.js';
export * from './ports.js';
export * from './v3-read.js';
export * from './vat.js';
export * from './write.js';
