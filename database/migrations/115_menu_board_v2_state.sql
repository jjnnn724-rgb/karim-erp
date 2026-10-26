CREATE TABLE IF NOT EXISTS menu_board_v2_state (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    payload JSONB,
    version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
    updated_at TIMESTAMPTZ,
    updated_by BIGINT
);

INSERT INTO menu_board_v2_state (id, payload, version)
VALUES (1, NULL, 0)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE menu_board_v2_state IS
    'Versioned central state for the authenticated v2 menu/signage application';
