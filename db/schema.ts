// The custom Worker uses prepared D1 statements in worker/access.js.
// Schema-only migration: drizzle/0000_portal_access.sql. Data import is performed
// separately, with an immutable R2 backup, by the configured owner's first load.
import {sql} from 'drizzle-orm';
import {sqliteTable,text,integer,index,unique,check} from 'drizzle-orm/sqlite-core';
export const portalUsers=sqliteTable('portal_users',{
 id:text('id').primaryKey().notNull(),email:text('email').notNull(),name:text('name').notNull(),role:text('role').notNull(),canOperate:integer('can_operate').notNull().default(0),active:integer('active').notNull().default(1),gardens:text('gardens').notNull().default('[]'),createdAt:integer('created_at').notNull(),updatedAt:integer('updated_at').notNull()
},t=>[check('portal_users_role',sql`${t.role} IN ('administrator','anton','customer')`)]);
export const portalState=sqliteTable('portal_state',{id:text('id').primaryKey().notNull(),data:text('data').notNull(),version:integer('version').notNull().default(1),migratedFrom:text('migrated_from'),updatedAt:integer('updated_at').notNull()});
export const portalInvitations=sqliteTable('portal_invitations',{
 id:text('id').primaryKey().notNull(),tokenHash:text('token_hash').notNull(),email:text('email').notNull(),name:text('name').notNull(),role:text('role').notNull(),canOperate:integer('can_operate').notNull().default(0),gardens:text('gardens').notNull(),expiresAt:integer('expires_at').notNull(),consumedBy:text('consumed_by'),revoked:integer('revoked').notNull().default(0),createdBy:text('created_by').notNull(),createdAt:integer('created_at').notNull()
},t=>[unique('portal_invitations_token_hash_unique').on(t.tokenHash),check('portal_invitations_role',sql`${t.role} IN ('administrator','anton','customer')`)]);
export const portalSessions=sqliteTable('portal_sessions',{tokenHash:text('token_hash').primaryKey().notNull(),userId:text('user_id').notNull().references(()=>portalUsers.id),csrf:text('csrf').notNull(),createdAt:integer('created_at').notNull(),lastSeen:integer('last_seen').notNull(),expiresAt:integer('expires_at').notNull()},t=>[index('portal_sessions_user').on(t.userId)]);
export const portalAudit=sqliteTable('portal_audit',{id:text('id').primaryKey().notNull(),userId:text('user_id').notNull(),action:text('action').notNull(),target:text('target').notNull(),createdAt:integer('created_at').notNull()},t=>[index('portal_audit_time').on(t.createdAt)]);
export const portalLimits=sqliteTable('portal_limits',{id:text('id').primaryKey().notNull(),count:integer('count').notNull(),expiresAt:integer('expires_at').notNull()});
