CREATE TABLE portal_auth_tokens (
 token_hash text PRIMARY KEY NOT NULL,
 kind text NOT NULL,
 user_id text,
 payload text NOT NULL DEFAULT '{}',
 expires_at integer NOT NULL,
 used_at integer
);
--> statement-breakpoint
CREATE TABLE portal_login_sessions (
 token_hash text PRIMARY KEY NOT NULL,
 user_id text NOT NULL REFERENCES portal_users(id),
 created_at integer NOT NULL,
 last_seen integer NOT NULL,
 expires_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX portal_login_sessions_user ON portal_login_sessions(user_id);
--> statement-breakpoint
CREATE INDEX portal_auth_tokens_expiry ON portal_auth_tokens(expires_at);
