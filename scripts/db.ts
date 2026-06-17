import { execute, query, queryOne } from "../lib/db/server";

type QueryData = any[] & { [key: string]: any };
type Result = { data: QueryData; error: Error | null; count?: number | null };

type SelectOptions = { count?: "exact"; head?: boolean };
type OrderOptions = { ascending?: boolean };

export type ScriptDbClient = {
  from(table: string): Builder;
};

function sqlIdent(name: string) {
  if (name.includes("->>")) return name;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return name;
}

class Builder implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private columns = "*";
  private options: SelectOptions = {};
  private values: Record<string, unknown> | null = null;
  private wheres: string[] = [];
  private params: unknown[] = [];
  private orders: string[] = [];
  private limitCount: number | null = null;
  private singleMode: "single" | "maybeSingle" | null = null;

  constructor(private table: string) {}

  select(columns = "*", options: SelectOptions = {}) {
    this.op = this.op === "insert" || this.op === "update" ? this.op : "select";
    this.columns = columns;
    this.options = options;
    return this;
  }

  insert(values: Record<string, unknown>) {
    this.op = "insert";
    this.values = values;
    return this;
  }

  update(values: Record<string, unknown>) {
    this.op = "update";
    this.values = values;
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.wheres.push(`${sqlIdent(column)} = $${this.addParam(value)}`);
    return this;
  }

  neq(column: string, value: unknown) {
    this.wheres.push(`${sqlIdent(column)} <> $${this.addParam(value)}`);
    return this;
  }

  is(column: string, value: null) {
    this.wheres.push(`${sqlIdent(column)} is ${value === null ? "null" : "not null"}`);
    return this;
  }

  in(column: string, values: unknown[]) {
    const cast = column === "id" || column.endsWith("_id") ? "::uuid[]" : "";
    this.wheres.push(`${sqlIdent(column)} = any($${this.addParam(values)}${cast})`);
    return this;
  }

  like(column: string, pattern: string) {
    this.wheres.push(`${sqlIdent(column)} like $${this.addParam(pattern)}`);
    return this;
  }

  ilike(column: string, pattern: string) {
    this.wheres.push(`${sqlIdent(column)} ilike $${this.addParam(pattern)}`);
    return this;
  }

  order(column: string, options: OrderOptions = {}) {
    this.orders.push(`${sqlIdent(column)} ${options.ascending === false ? "desc" : "asc"}`);
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.singleMode = "single";
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this;
  }

  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private addParam(value: unknown) {
    this.params.push(value);
    return this.params.length;
  }

  private whereSql() {
    return this.wheres.length > 0 ? ` where ${this.wheres.join(" and ")}` : "";
  }

  private orderSql() {
    return this.orders.length > 0 ? ` order by ${this.orders.join(", ")}` : "";
  }

  private limitSql() {
    return this.limitCount === null ? "" : ` limit ${this.limitCount}`;
  }

  private selectSql() {
    if (this.table === "note_tags" && this.columns.trim() === "tags(name)") {
      return "json_build_object('name', tags.name) as tags from note_tags join tags on tags.id = note_tags.tag_id";
    }
    return `${this.columns} from ${sqlIdent(this.table)}`;
  }

  private async run(): Promise<Result> {
    try {
      if (this.op === "delete") {
        await execute(`delete from ${sqlIdent(this.table)}${this.whereSql()}`, this.params);
        return { data: null as any, error: null };
      }

      if (this.op === "insert") {
        const values = this.values ?? {};
        const keys = Object.keys(values);
        const params = keys.map((key) => values[key]);
        const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
        const returning = this.columns === "*" ? "*" : this.columns;
        const rows = await query(
          `insert into ${sqlIdent(this.table)} (${keys.map(sqlIdent).join(", ")}) values (${placeholders}) returning ${returning}`,
          params,
        );
        return this.result(rows);
      }

      if (this.op === "update") {
        const values = this.values ?? {};
        const keys = Object.keys(values);
        const setParams = keys.map((key) => values[key]);
        const sets = keys.map((key, i) => `${sqlIdent(key)} = $${i + 1}`).join(", ");
        const offsetWheres = this.wheres.map((where) =>
          where.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + setParams.length}`),
        );
        const whereSql = offsetWheres.length > 0 ? ` where ${offsetWheres.join(" and ")}` : "";
        const returning = this.columns === "*" ? "*" : this.columns;
        const rows = await query(
          `update ${sqlIdent(this.table)} set ${sets}${whereSql} returning ${returning}`,
          [...setParams, ...this.params],
        );
        return this.result(rows);
      }

      if (this.options.count === "exact" && this.options.head) {
        const row = await queryOne<{ count: string }>(
          `select count(*)::text as count from ${sqlIdent(this.table)}${this.whereSql()}`,
          this.params,
        );
        return { data: null as any, error: null, count: Number(row?.count ?? 0) };
      }

      const rows = await query(
        `select ${this.selectSql()}${this.whereSql()}${this.orderSql()}${this.limitSql()}`,
        this.params,
      );
      return this.result(rows);
    } catch (e) {
      return { data: null as any, error: e instanceof Error ? e : new Error(String(e)), count: null };
    }
  }

  private result(rows: Record<string, unknown>[]): Result {
    if (this.singleMode) return { data: (rows[0] ?? null) as any, error: null };
    return { data: rows as any, error: null };
  }
}

export function createClient(..._args: unknown[]): ScriptDbClient {
  if (!process.env.DATABASE_URL) {
    throw new Error("Missing DATABASE_URL (set it in .env.local).");
  }
  return {
    from(table: string) {
      return new Builder(table);
    },
  };
}
