CREATE TABLE portal_users (
  id text PRIMARY KEY NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('administrator','anton','customer')),
  can_operate integer NOT NULL DEFAULT 0,
  active integer NOT NULL DEFAULT 1,
  gardens text NOT NULL DEFAULT '[]',
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE portal_state (
  id text PRIMARY KEY NOT NULL,
  data text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  migrated_from text,
  updated_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE portal_invitations (
  id text PRIMARY KEY NOT NULL,
  token_hash text UNIQUE NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('administrator','anton','customer')),
  can_operate integer NOT NULL DEFAULT 0,
  gardens text NOT NULL,
  expires_at integer NOT NULL,
  consumed_by text,
  revoked integer NOT NULL DEFAULT 0,
  created_by text NOT NULL,
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE portal_sessions (
  token_hash text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES portal_users(id),
  csrf text NOT NULL,
  created_at integer NOT NULL,
  last_seen integer NOT NULL,
  expires_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE portal_audit (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  created_at integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE portal_limits (
  id text PRIMARY KEY NOT NULL,
  count integer NOT NULL,
  expires_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX portal_sessions_user ON portal_sessions(user_id);
--> statement-breakpoint
CREATE INDEX portal_audit_time ON portal_audit(created_at);
