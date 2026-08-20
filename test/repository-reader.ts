export type JsonObject = Readonly<Record<string, unknown>>;

export type PackageJson = {
  readonly name: string;
  readonly productName: string | undefined;
  readonly version: string;
  readonly license: string;
  readonly private: boolean;
  readonly type: string;
  readonly main: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly build: JsonObject;
};

export type PackageLock = {
  readonly name: string;
  readonly version: string;
  readonly lockfileVersion: number;
  readonly packages: Readonly<Record<string, { readonly version?: string }>>;
};

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(record: JsonObject, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new TypeError(`expected ${key} to be a string`);
  return value;
}

export function readOptionalString(record: JsonObject, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || typeof value === "string") return value;
  throw new TypeError(`expected ${key} to be a string`);
}

export function readBoolean(record: JsonObject, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new TypeError(`expected ${key} to be a boolean`);
  return value;
}

export function readRecord(record: JsonObject, key: string): JsonObject {
  const value = record[key];
  if (!isRecord(value)) throw new TypeError(`expected ${key} to be an object`);
  return value;
}

export function readRecordArray(record: JsonObject, key: string): readonly JsonObject[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new TypeError(`expected ${key} to be an array`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new TypeError(`expected ${key}[${index}] to be an object`);
    return entry;
  });
}

export function readStringArray(record: JsonObject, key: string): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new TypeError(`expected ${key} to be an array`);
  return value.map((entry, index) => {
    if (typeof entry !== "string") throw new TypeError(`expected ${key}[${index}] to be a string`);
    return entry;
  });
}

function readStringMap(record: JsonObject): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string") throw new TypeError(`expected ${key} to be a string`);
    result[key] = value;
  }
  return result;
}

export function parsePackageJson(raw: string): PackageJson {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new TypeError("package.json root is not an object");
  return {
    name: readString(parsed, "name"),
    productName: readOptionalString(parsed, "productName"),
    version: readString(parsed, "version"),
    license: readString(parsed, "license"),
    private: readBoolean(parsed, "private"),
    type: readString(parsed, "type"),
    main: readString(parsed, "main"),
    dependencies: readStringMap(readRecord(parsed, "dependencies")),
    devDependencies: readStringMap(readRecord(parsed, "devDependencies")),
    scripts: readStringMap(readRecord(parsed, "scripts")),
    build: readRecord(parsed, "build"),
  };
}

export function parsePackageLock(raw: string): PackageLock {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new TypeError("package-lock.json root is not an object");
  const lockfileVersion = parsed["lockfileVersion"];
  if (typeof lockfileVersion !== "number") throw new TypeError("expected lockfileVersion to be a number");
  const packages: Record<string, { readonly version?: string }> = {};
  for (const [key, value] of Object.entries(readRecord(parsed, "packages"))) {
    if (!isRecord(value)) throw new TypeError(`expected packages.${key} to be an object`);
    const version = value["version"];
    if (version !== undefined && typeof version !== "string") {
      throw new TypeError(`expected packages.${key}.version to be a string`);
    }
    packages[key] = version === undefined ? {} : { version };
  }
  return { name: readString(parsed, "name"), version: readString(parsed, "version"), lockfileVersion, packages };
}

export function requiredString(record: Readonly<Record<string, string>>, key: string): string {
  const value = record[key];
  if (value === undefined) throw new TypeError(`missing required entry "${key}"`);
  return value;
}

export function lockEntryVersion(lock: PackageLock, key: string): string {
  const version = lock.packages[key]?.version;
  if (version === undefined) throw new TypeError(`missing version for lock entry "${key}"`);
  return version;
}
