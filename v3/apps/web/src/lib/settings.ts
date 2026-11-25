import { z } from 'zod';

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

const flag = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === 'boolean') {
        return value;
    }
    if (value === null || value === undefined) {
        return fallback;
    }
    return value === 1 || value === '1' || value === 'true' || value === 'on';
};

const int = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

export const MAIN_SETTINGS_ID = 'main_settings';
export type PosLegacyMode = 'off' | 'banner' | 'redirect';

export interface MainSettings {
    id: string;
    name: string;
    logo: string;
    logoB64: string;
    currency: string;
    workStartHour: number;
    hidden_nav_pages: string;
    opening_balance_visible: boolean;
    pos_legacy_mode: PosLegacyMode;
    pos_official_path: string;
}

function pickMainRow(body: unknown): Record<string, unknown> {
    if (Array.isArray(body)) {
        const main = body.find((row) => String((row as Record<string, unknown> | null)?.id ?? '') === MAIN_SETTINGS_ID);
        return (main ?? body[0] ?? {}) as Record<string, unknown>;
    }
    if (body && typeof body === 'object' && 'data' in body) {
        const data = (body as { data: unknown }).data;
        if (Array.isArray(data)) {
            const main = data.find((row) => String((row as Record<string, unknown> | null)?.id ?? '') === MAIN_SETTINGS_ID);
            return (main ?? data[0] ?? {}) as Record<string, unknown>;
        }
        if (data && typeof data === 'object') {
            return data as Record<string, unknown>;
        }
    }
    return (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
}

export const mainSettingsSchema = z.unknown().transform((body): MainSettings => {
    const row = pickMainRow(body);
    const mode = text(row.pos_legacy_mode);
    return {
        id: text(row.id) || MAIN_SETTINGS_ID,
        name: text(row.name),
        logo: text(row.logo),
        logoB64: text(row.logoB64),
        currency: text(row.currency) || 'SAR',
        workStartHour: int(row.workStartHour, 9),
        hidden_nav_pages: text(row.hidden_nav_pages),
        opening_balance_visible: flag(row.opening_balance_visible, true),
        pos_legacy_mode: mode === 'banner' || mode === 'redirect' ? mode : 'off',
        pos_official_path: text(row.pos_official_path),
    };
});

export function hiddenNavKeys(hidden: string): string[] {
    return hidden
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
}

export function joinHiddenNav(keys: readonly string[]): string {
    return [...new Set(keys.map((key) => key.trim()).filter(Boolean))].join(',');
}

export interface ZatcaEnvironment {
    value: string;
    label: string;
    api_base: string;
}

export interface ZatcaConfig {
    enabled: boolean;
    environment: string;
    environment_label: string;
    default_api_base: string;
    api_base: string;
    seller_name: string;
    vat_number: string;
    crn: string;
    address: string;
    branch_name: string;
    eid_masked: string;
    solution_name: string;
    csid_masked: string;
    has_csid: boolean;
    has_csr: boolean;
    has_private_key: boolean;
    csid_obtained_at: string;
    poll_in_server: boolean;
    max_attempts: number;
    updated_at: string;
    environments: ZatcaEnvironment[];
}

export interface ZatcaQueueStats {
    queued: number;
    processing: number;
    reported: number;
    failed: number;
    dead_letter: number;
    skipped_cancelled: number;
    skipped_disabled: number;
}

export interface ZatcaEngine {
    mode: string;
    poller_in_server: boolean;
    poll_interval_ms: number;
}

export interface ZatcaSettingsResponse {
    config: ZatcaConfig;
    queue: ZatcaQueueStats;
    engine: ZatcaEngine;
}

export const ZATCA_ENVIRONMENTS: readonly ZatcaEnvironment[] = [
    { value: 'developer_portal', label: 'بوابة المطوّر (Developer Portal)', api_base: '' },
    { value: 'simulation', label: 'المحاكاة (Simulation)', api_base: '' },
    { value: 'production', label: 'الإنتاج (Production)', api_base: '' },
];

function queueStats(value: unknown): ZatcaQueueStats {
    const row = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    return {
        queued: int(row.queued, 0),
        processing: int(row.processing, 0),
        reported: int(row.reported, 0),
        failed: int(row.failed, 0),
        dead_letter: int(row.dead_letter, 0),
        skipped_cancelled: int(row.skipped_cancelled, 0),
        skipped_disabled: int(row.skipped_disabled, 0),
    };
}

function zatcaConfig(value: unknown): ZatcaConfig {
    const cfg = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    const environments = Array.isArray(cfg.environments)
        ? cfg.environments
              .map((entry) => {
                  const env = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
                  return { value: text(env.value), label: text(env.label), api_base: text(env.api_base) };
              })
              .filter((env) => env.value)
        : [];
    return {
        enabled: cfg.enabled === true,
        environment: text(cfg.environment) || 'simulation',
        environment_label: text(cfg.environment_label),
        default_api_base: text(cfg.default_api_base),
        api_base: text(cfg.api_base),
        seller_name: text(cfg.seller_name),
        vat_number: text(cfg.vat_number),
        crn: text(cfg.crn),
        address: text(cfg.address),
        branch_name: text(cfg.branch_name),
        eid_masked: text(cfg.eid),
        solution_name: text(cfg.solution_name),
        csid_masked: text(cfg.csid_masked),
        has_csid: cfg.has_csid === true,
        has_csr: cfg.has_csr === true,
        has_private_key: cfg.has_private_key === true,
        csid_obtained_at: text(cfg.csid_obtained_at),
        poll_in_server: cfg.poll_in_server !== false,
        max_attempts: int(cfg.max_attempts, 10),
        updated_at: text(cfg.updated_at),
        environments: environments.length ? environments : [...ZATCA_ENVIRONMENTS],
    };
}

export const zatcaSettingsSchema = z.unknown().transform((body): ZatcaSettingsResponse => {
    const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const config = 'config' in root ? root.config : root;
    const engine = (root.engine && typeof root.engine === 'object' ? root.engine : {}) as Record<string, unknown>;
    return {
        config: zatcaConfig(config),
        queue: queueStats(root.queue),
        engine: {
            mode: text(engine.mode) || 'sql_poller',
            poller_in_server: engine.poller_in_server === true,
            poll_interval_ms: int(engine.poll_interval_ms, 0),
        },
    };
});

export interface ZatcaQueueRow {
    id: string;
    status: string;
    attempts: number;
    max_attempts: number;
    next_retry_at: string;
    last_error: string;
    queued_at: string;
    reported_at: string;
    invoice_number: string;
    total_amount: number;
    order_date: string;
    department_name: string;
}

export const zatcaQueueSchema = z.unknown().transform((body) => {
    const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const rows = Array.isArray(root.data) ? root.data : [];
    const engine = (root.engine && typeof root.engine === 'object' ? root.engine : {}) as Record<string, unknown>;
    return {
        stats: queueStats(root.stats),
        engine: {
            mode: text(engine.mode) || 'sql_poller',
            poller_in_server: engine.poller_in_server === true,
            poll_interval_ms: int(engine.poll_interval_ms, 0),
        },
        rows: rows.map((entry): ZatcaQueueRow => {
            const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
            return {
                id: text(row.id),
                status: text(row.status),
                attempts: int(row.attempts, 0),
                max_attempts: int(row.max_attempts, 0),
                next_retry_at: text(row.next_retry_at),
                last_error: text(row.last_error),
                queued_at: text(row.queued_at),
                reported_at: text(row.reported_at),
                invoice_number: text(row.invoice_number),
                total_amount: Number(row.total_amount) || 0,
                order_date: text(row.order_date),
                department_name: text(row.department_name),
            };
        }),
    };
});

export interface ZatcaTestResult {
    ok: boolean;
    endpoint: string;
    http_status: number;
    latency_ms: number;
    note: string;
    message: string;
}

export const zatcaTestSchema = z.unknown().transform((body): ZatcaTestResult => {
    const row = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    return {
        ok: row.ok === true,
        endpoint: text(row.endpoint),
        http_status: int(row.http_status, 0),
        latency_ms: int(row.latency_ms, 0),
        note: text(row.note),
        message: text(row.message),
    };
});

export interface ZatcaCsrResult {
    ok: boolean;
    csr_pem: string;
    subject: string;
}

export const zatcaCsrSchema = z.unknown().transform((body): ZatcaCsrResult => {
    const row = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    return { ok: row.ok === true, csr_pem: text(row.csr_pem), subject: text(row.subject) };
});

export interface ZatcaApplyVatResult {
    ok: boolean;
    vat_number: string;
    updated: number;
}

export const zatcaApplyVatSchema = z.unknown().transform((body): ZatcaApplyVatResult => {
    const row = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    return { ok: row.ok === true, vat_number: text(row.vat_number), updated: int(row.updated, 0) };
});

export interface ZatcaRetryResult {
    ok: boolean;
    requeued: number;
}

export const zatcaRetrySchema = z.unknown().transform((body): ZatcaRetryResult => {
    const row = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    return { ok: row.ok === true, requeued: int(row.requeued, 0) };
});

export interface KotSettings {
    enabled: boolean;
    copies: number;
    include_notes: boolean;
    updated_at: string;
    updated_by: string;
}

export const kotSettingsSchema = z.unknown().transform((body): KotSettings => {
    const row = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    return {
        enabled: flag(row.kot_enabled, true),
        copies: Math.min(3, Math.max(1, int(row.kot_copies, 1))),
        include_notes: flag(row.kot_include_notes, true),
        updated_at: text(row.updated_at),
        updated_by: text(row.updated_by),
    };
});

export interface HrCardSettings {
    verifyBase: string;
    emergencyPhone: string;
}

export const hrCardSettingsSchema = z.unknown().transform((body): HrCardSettings => {
    const row = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    return { verifyBase: text(row.verifyBase), emergencyPhone: text(row.emergencyPhone) };
});

export interface PunchSettingRow {
    key: string;
    value: string;
    updated_at: string;
    updated_by: string;
}

export interface PunchSettings {
    values: Record<string, string>;
    rows: PunchSettingRow[];
}

export const punchSettingsSchema = z.unknown().transform((body): PunchSettings => {
    const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const rows = Array.isArray(root.settings) ? root.settings : [];
    const values: Record<string, string> = {};
    const mapped = rows.map((entry): PunchSettingRow => {
        const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
        const item = {
            key: text(row.key),
            value: text(row.value),
            updated_at: text(row.updated_at),
            updated_by: text(row.updated_by),
        };
        if (item.key) {
            values[item.key] = item.value;
        }
        return item;
    });
    return { values, rows: mapped };
});

export function punchBool(values: Record<string, string>, key: string, fallback: boolean): boolean {
    if (!(key in values)) {
        return fallback;
    }
    return ['true', '1', 'on'].includes(String(values[key] ?? '').toLowerCase());
}

export function punchText(values: Record<string, string>, key: string, fallback: string): string {
    const value = values[key];
    return value === undefined || value === '' ? fallback : value;
}

export interface PunchAttempt {
    id: string;
    username: string;
    attempted_at: string;
    remote_ip: string;
    decision: string;
    reject_code: string;
    distance_m: number | null;
    accuracy_m: number | null;
    trust_score: number | null;
    trust_signals: string;
    teleport_kmh: number | null;
}

export interface PunchAttempts {
    attempts: PunchAttempt[];
    summary: {
        accepted_24h: number;
        rejected_24h: number;
        out_of_range_7d: number;
        device_mismatch_7d: number;
    };
}

const optionalNumber = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

export const punchAttemptsSchema = z.unknown().transform((body): PunchAttempts => {
    const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const rows = Array.isArray(root.attempts) ? root.attempts : [];
    const summary = (root.summary && typeof root.summary === 'object' ? root.summary : {}) as Record<string, unknown>;
    return {
        attempts: rows.map((entry): PunchAttempt => {
            const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
            return {
                id: text(row.id),
                username: text(row.username),
                attempted_at: text(row.attempted_at),
                remote_ip: text(row.remote_ip),
                decision: text(row.decision),
                reject_code: text(row.reject_code),
                distance_m: optionalNumber(row.distance_m),
                accuracy_m: optionalNumber(row.accuracy_m),
                trust_score: optionalNumber(row.trust_score),
                trust_signals: text(row.trust_signals),
                teleport_kmh: optionalNumber(row.teleport_kmh),
            };
        }),
        summary: {
            accepted_24h: int(summary.accepted_24h, 0),
            rejected_24h: int(summary.rejected_24h, 0),
            out_of_range_7d: int(summary.out_of_range_7d, 0),
            device_mismatch_7d: int(summary.device_mismatch_7d, 0),
        },
    };
});

export interface PunchDevice {
    user_id: string;
    username: string;
    name: string;
    device_id: string;
    bound_ip: string;
    bound_at: string;
    last_seen_at: string;
}

export const punchDevicesSchema = z.unknown().transform((body): PunchDevice[] => {
    const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const rows = Array.isArray(root.devices) ? root.devices : [];
    return rows.map((entry): PunchDevice => {
        const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
        return {
            user_id: text(row.user_id),
            username: text(row.username),
            name: text(row.name),
            device_id: text(row.device_id),
            bound_ip: text(row.bound_ip),
            bound_at: text(row.bound_at),
            last_seen_at: text(row.last_seen_at),
        };
    });
});

export interface PunchFace {
    user_id: string;
    username: string;
    name: string;
    engine: string;
    enrolled_at: string;
    enrolled_by: string;
}

export const punchFacesSchema = z.unknown().transform((body): PunchFace[] => {
    const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const rows = Array.isArray(root.faces) ? root.faces : [];
    return rows.map((entry): PunchFace => {
        const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
        return {
            user_id: text(row.user_id),
            username: text(row.username),
            name: text(row.name),
            engine: text(row.engine),
            enrolled_at: text(row.enrolled_at),
            enrolled_by: text(row.enrolled_by),
        };
    });
});

export interface BackupManifest {
    createdAt: string;
    by: string;
    db: string;
    includes: string[];
    uploaded: string;
}

export interface BackupFile {
    file: string;
    bytes: number;
    mtime: string;
    shaOk: boolean | null;
    hasSha: boolean;
    manifest: BackupManifest | null;
}

export interface BackupList {
    dir: string;
    files: BackupFile[];
}

export const backupListSchema = z.unknown().transform((body): BackupList => {
    const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const rows = Array.isArray(root.files) ? root.files : [];
    return {
        dir: text(root.dir),
        files: rows
            .map((entry): BackupFile => {
                const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
                const manifestRow = (row.manifest && typeof row.manifest === 'object' ? row.manifest : null) as Record<
                    string,
                    unknown
                > | null;
                return {
                    file: text(row.file),
                    bytes: int(row.bytes, 0),
                    mtime: text(row.mtime),
                    shaOk: typeof row.shaOk === 'boolean' ? row.shaOk : null,
                    hasSha: row.hasSha === true,
                    manifest: manifestRow
                        ? {
                              createdAt: text(manifestRow.createdAt),
                              by: text(manifestRow.by),
                              db: text(manifestRow.db),
                              includes: Array.isArray(manifestRow.includes) ? manifestRow.includes.map((item) => text(item)) : [],
                              uploaded: text(manifestRow.uploaded),
                          }
                        : null,
                };
            })
            .filter((file) => file.file),
    };
});

export interface RestoreResult {
    ok: boolean;
    file: string;
    ms: number;
    envRestored: boolean;
    restartNeeded: boolean;
    message: string;
}

export const restoreResultSchema = z.unknown().transform((body): RestoreResult => {
    const row = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    return {
        ok: row.ok === true,
        file: text(row.file),
        ms: int(row.ms, 0),
        envRestored: row.envRestored === true,
        restartNeeded: row.restartNeeded === true,
        message: text(row.message),
    };
});

export interface ResetResult {
    ok: boolean;
    resetNumber: string;
    message: string;
}

export const resetResultSchema = z.unknown().transform((body): ResetResult => {
    const row = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const reset = (row.reset && typeof row.reset === 'object' ? row.reset : {}) as Record<string, unknown>;
    return {
        ok: row.ok !== false,
        resetNumber: text(reset.reset_number),
        message: text(row.message),
    };
});

export const entityPageSchema = z.unknown().transform((body) => {
    const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const pagination = (root.pagination && typeof root.pagination === 'object' ? root.pagination : {}) as Record<string, unknown>;
    return {
        data: Array.isArray(root.data) ? root.data : [],
        totalPages: int(pagination.totalPages, 1),
        hasNextPage: pagination.hasNextPage === true,
    };
});

export const appStateSchema = z.unknown().transform((body) => {
    const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    return (root.state_data ?? root.data ?? root) as unknown;
});

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 بايت';
    }
    const units = ['بايت', 'ك.ب', 'م.ب', 'ج.ب', 'ت.ب'];
    const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / 1024 ** exponent;
    return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
