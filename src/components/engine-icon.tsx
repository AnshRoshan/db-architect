import { BarChart3, Database, Eye, Feather, Fish, Layers, Leaf, Search, Server, Table2, type LucideIcon } from "lucide-react";
import { engineColor } from "@/lib/engines";

// One glyph per engine so stores are recognisable at a glance everywhere
// (topology, pickers, marquee) without shipping vendor logos.
const GLYPHS: Record<string, LucideIcon> = {
  postgres: Database, postgresql: Database,
  mysql: Fish,
  sqlite: Feather,
  mongodb: Leaf,
  redis: Layers,
  "sql server": Server, sqlserver: Server,
  dynamodb: Table2,
  clickhouse: BarChart3,
  elasticsearch: Search, opensearch: Search,
  cassandra: Eye,
};
const EXTRA_COLORS: Record<string, string> = { "sql server": "#a4262c", dynamodb: "#4053d6", clickhouse: "#f5b400", elasticsearch: "#00a9a5", cassandra: "#1287b1" };

export function engineGlyph(engine: string): LucideIcon {
  return GLYPHS[engine.toLowerCase()] ?? Database;
}
export function engineTint(engine: string): string {
  return EXTRA_COLORS[engine.toLowerCase()] ?? engineColor(engine.toLowerCase() === "postgresql" ? "postgres" : engine.toLowerCase());
}

export function EngineIcon({ engine, size = 16, className = "" }: { engine: string; size?: number; className?: string }) {
  const Icon = engineGlyph(engine);
  return <Icon size={size} className={className} style={{ color: engineTint(engine) }} aria-hidden />;
}

/** Tinted rounded tile with the engine glyph. */
export function EngineBadge({ engine, size = 36, className = "" }: { engine: string; size?: number; className?: string }) {
  const Icon = engineGlyph(engine);
  const color = engineTint(engine);
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl ${className}`} style={{ width: size, height: size, background: `${color}22`, color, boxShadow: `inset 0 0 0 1px ${color}44` }} aria-hidden>
      <Icon size={Math.round(size * 0.5)} />
    </span>
  );
}
