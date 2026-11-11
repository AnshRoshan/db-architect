// Shared view-model types for the workspace views.
export type ScanRow = { id: string; engine: string; source: string; status: string; progress: number; currentStage?: string; stats?: Record<string, number>; createdAt?: string; error?: string | null };
export type FindingRow = Record<string, unknown>;
export type FieldT = { name: string; type: string; nullable: boolean; defaultValue?: string | null; isPrimaryKey?: boolean; isUnique?: boolean; presence?: number; bsonTypes?: string[]; isArray?: boolean; arrayOf?: string | null; nested?: FieldT[]; comment?: string | null };
export type IdxT = { name: string; columns: string[]; method?: string; unique: boolean; partial?: boolean; predicate?: string | null; definition?: string | null };
export type ConT = { name: string; kind: string; columns: string[]; referencedEntity?: string | null; referencedColumns?: string[]; onDelete?: string | null; definition?: string | null };
export type RelT = { id: string; name: string; fromEntity: string; fromColumns: string[]; toEntity: string; toColumns: string[]; cardinality: string; provenance: string; confidence?: number };
export type EntityT = { id: string; name: string; shortName: string; namespace: string; kind: string; fields: FieldT[]; indexes: IdxT[]; constraints: ConT[]; comment?: string | null; rowEstimate?: number | null };
export type ModelT = { database: string; engine: string; version?: string | null; namespaces: string[]; entities: EntityT[]; relationships: RelT[]; warnings: string[]; sourceMetadata: { limitations: string[]; sampleSize?: number | null } };

export function normFinding(f: FindingRow) {
  return {
    id: String(f.id ?? ""),
    ruleId: String(f.ruleId ?? f.rule_id ?? "?"),
    category: String(f.category ?? "?"),
    severity: String(f.severity ?? "info"),
    title: String(f.title ?? ""),
    object: String(f.object ?? f.objectName ?? f.object_name ?? ""),
    evidence: (f.evidence as Record<string, unknown>) ?? {},
    explanation: String(f.explanation ?? ""),
    recommendation: String(f.recommendation ?? ""),
    confidence: Number(f.confidence ?? 50),
    requiresWorkload: Boolean(f.requiresWorkload ?? f.requires_workload ?? false),
    limitations: ((f.limitations as string[]) ?? []) as string[],
    evidenceLevel: String(f.evidenceLevel ?? f.evidence_level ?? "schema"),
    status: String(f.status ?? "open"),
  };
}
export type Finding = ReturnType<typeof normFinding>;
