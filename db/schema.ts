import { table, text, integer, real, index, uniqueIndex, timestamp } from './table'

export const users = table(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),
    accountType: text('account_type').notNull().default('personal'),
    status: text('status').notNull().default('active'),
    emailVerifiedAt: timestamp('email_verified_at'),
    preferredAiProvider: text('preferred_ai_provider').notNull().default('groq'),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
)

export const organizations = table(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    plan: text('plan').notNull().default('free'),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [uniqueIndex('orgs_slug_idx').on(t.slug)],
)

export const organizationMembers = table(
  'organization_members',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    userId: text('user_id').references(() => users.id),
    role: text('role').notNull().default('member'),
    status: text('status').notNull().default('active'),
    invitedEmail: text('invited_email'),
    inviteToken: text('invite_token'),
    invitedAt: timestamp('invited_at'),
    joinedAt: timestamp('joined_at'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('org_members_org_user_idx').on(t.orgId, t.userId),
    index('org_members_user_idx').on(t.userId),
  ],
)

export const projects = table(
  'projects',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').references(() => organizations.id),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    index('projects_owner_idx').on(t.ownerId),
    index('projects_org_idx').on(t.orgId),
  ],
)

export const datasets = table(
  'datasets',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    orgId: text('org_id').references(() => organizations.id),
    name: text('name').notNull(),
    fileName: text('file_name').notNull(),
    sizeBytes: integer('size_bytes').notNull().default(0),
    compressedSizeBytes: integer('compressed_size_bytes').default(0),
    mimeType: text('mime_type'),
    storageProvider: text('storage_provider').notNull().default('cloudinary'),
    storageKey: text('storage_key').notNull(),
    storageUrl: text('storage_url').notNull(),
    rowCount: integer('row_count').default(0),
    columnCount: integer('column_count').default(0),
    schemaJson: text('schema_json'),
    sha256: text('sha256').notNull(),
    version: integer('version').notNull().default(1),
    processingStatus: text('processing_status').notNull().default('stored'),
    analysisStatus: text('analysis_status').notNull().default('none'),
    lastAccessedAt: timestamp('last_accessed_at'),
    rawDeletedAt: timestamp('raw_deleted_at'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    index('datasets_owner_idx').on(t.ownerId),
    index('datasets_project_idx').on(t.projectId),
    uniqueIndex('datasets_owner_sha_idx').on(t.ownerId, t.sha256),
  ],
)

export const analyses = table(
  'analyses',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => projects.id),
    datasetId: text('dataset_id').references(() => datasets.id),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    orgId: text('org_id').references(() => organizations.id),
    name: text('name').notNull(),
    status: text('status').notNull().default('saved'),
    storageProvider: text('storage_provider').notNull().default('cloudinary'),
    storageKey: text('storage_key').notNull(),
    storageUrl: text('storage_url').notNull(),
    schemaJson: text('schema_json'),
    summary: text('summary'),
    providerUsed: text('provider_used'),
    modelType: text('model_type'),
    rowCount: integer('row_count'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    index('analyses_owner_idx').on(t.ownerId),
    index('analyses_project_idx').on(t.projectId),
    index('analyses_dataset_idx').on(t.datasetId),
  ],
)

export const sessions = table(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    ip: text('ip'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at').notNull(),
    lastSeenAt: timestamp('last_seen_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export const userAiKeys = table(
  'user_ai_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    provider: text('provider').notNull(),
    keyEncrypted: text('key_encrypted').notNull(),
    keyHint: text('key_hint').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [uniqueIndex('user_ai_keys_user_provider_idx').on(t.userId, t.provider)],
)

export const orgAiKeys = table(
  'org_ai_keys',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id),
    provider: text('provider').notNull(),
    keyEncrypted: text('key_encrypted').notNull(),
    keyHint: text('key_hint').notNull(),
    createdBy: text('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [uniqueIndex('org_ai_keys_org_provider_idx').on(t.orgId, t.provider)],
)

export const auditLogs = table(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').references(() => organizations.id),
    userId: text('user_id').references(() => users.id),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    meta: text('meta'),
    ip: text('ip'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [index('audit_logs_org_idx').on(t.orgId)],
)

/**
 * Chunked upload sessions. Each chunk is stored in object storage under
 * `chunks/{uploadId}/{index}`; the row tracks which chunks arrived so uploads
 * can pause / resume / retry only the failed ones.
 */
export const uploads = table(
  'uploads',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    orgId: text('org_id').references(() => organizations.id),
    fileName: text('file_name').notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    fileSha256: text('file_sha256').notNull(),
    fileType: text('file_type'),
    chunkSize: integer('chunk_size').notNull(),
    totalChunks: integer('total_chunks').notNull(),
    receivedChunks: text('received_chunks').notNull().default('[]'),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
    completedAt: timestamp('completed_at'),
  },
  (t) => [index('uploads_owner_idx').on(t.ownerId)],
)

/**
 * The knowledge base (Part 2 of the spec). Structured AI findings live here,
 * independent of the raw dataset file, and are retrieved before any future
 * answer is generated.
 */
export const knowledgeFindings = table(
  'knowledge_findings',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    orgId: text('org_id').references(() => organizations.id),
    datasetId: text('dataset_id').references(() => datasets.id),
    analysisId: text('analysis_id').references(() => analyses.id),
    category: text('category').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    confidence: real('confidence').notNull().default(0.5),
    severity: text('severity').notNull().default('low'),
    evidence: text('evidence'),
    impact: text('impact'),
    financialImpact: text('financial_impact'),
    kpiKey: text('kpi_key'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    index('findings_owner_idx').on(t.ownerId),
    index('findings_org_idx').on(t.orgId),
    index('findings_analysis_idx').on(t.analysisId),
  ],
)

export const knowledgeGlossary = table(
  'knowledge_glossary',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    orgId: text('org_id').references(() => organizations.id),
    datasetId: text('dataset_id').references(() => datasets.id),
    term: text('term').notNull(),
    definition: text('definition').notNull(),
    confidence: real('confidence').notNull().default(0.5),
    source: text('source').notNull().default('auto'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    index('glossary_owner_idx').on(t.ownerId),
    index('glossary_org_idx').on(t.orgId),
  ],
)

export const knowledgeKpis = table(
  'knowledge_kpis',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    orgId: text('org_id').references(() => organizations.id),
    datasetId: text('dataset_id').references(() => datasets.id),
    name: text('name').notNull(),
    metricKey: text('metric_key').notNull(),
    valueText: text('value_text').notNull(),
    valueNumber: real('value_number'),
    unit: text('unit'),
    periodKey: text('period_key'),
    displayLabel: text('display_label'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    index('kpis_owner_idx').on(t.ownerId),
    index('kpis_org_idx').on(t.orgId),
    index('kpis_period_idx').on(t.periodKey),
  ],
)

/** Embeddings for RAG semantic search over findings/glossary/KPIs/reports. */
export const knowledgeEmbeddings = table(
  'knowledge_embeddings',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    orgId: text('org_id').references(() => organizations.id),
    contentType: text('content_type').notNull(),
    contentId: text('content_id').notNull(),
    text: text('text').notNull(),
    model: text('model').notNull(),
    dimensions: integer('dimensions').notNull(),
    vector: text('vector').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    index('embeddings_owner_idx').on(t.ownerId),
    index('embeddings_org_idx').on(t.orgId),
    index('embeddings_content_idx').on(t.contentType, t.contentId),
  ],
)

/** Per-workspace user preferences (chart style, report format, favorite KPIs…). */
export const userPreferences = table(
  'user_preferences',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    orgId: text('org_id').references(() => organizations.id),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [index('prefs_user_idx').on(t.userId)],
)

export const schema = {
  users,
  organizations,
  organizationMembers,
  projects,
  datasets,
  analyses,
  sessions,
  userAiKeys,
  orgAiKeys,
  auditLogs,
  uploads,
  knowledgeFindings,
  knowledgeGlossary,
  knowledgeKpis,
  knowledgeEmbeddings,
  userPreferences,
}

export type Schema = typeof schema
