/** Small, deliberately bounded schema vocabulary for this offline milestone.
 * Each builder creates runtime validation + JSON Schema; types are inferred from it.
 * Not a general JSON Schema interpreter. No external API or framework dependency.
 */
export type JsonSchema = Readonly<Record<string, unknown>>;
export class ContractError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`); this.name = 'ContractError'; this.path = path;
  }
}
export interface Schema<T> {
  readonly jsonSchema: JsonSchema;
  readonly optional: boolean;
  parse(value: unknown, path?: string): T;
}
export type Infer<S> = S extends Schema<infer T> ? T : never;
type Shape = Record<string, Schema<unknown>>;
type OptionalKeys<S extends Shape> = { [K in keyof S]: undefined extends Infer<S[K]> ? K : never }[keyof S];
type ObjectValue<S extends Shape> = { [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]> }
  & { [K in OptionalKeys<S>]?: Exclude<Infer<S[K]>, undefined> };
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
function make<T>(jsonSchema: JsonSchema, parse: (value: unknown, path: string) => T, optional = false): Schema<T> {
  return Object.freeze({ jsonSchema: freeze(jsonSchema), optional,
    parse(value: unknown, path = '$'): T { return parse(value, path); } });
}
function fail(path: string, message: string): never { throw new ContractError(path, message); }
export const v = {
  json(): Schema<unknown> {
    return make({}, (value, path) => {
      let nodes = 0;
      const visit = (item: unknown, at: string, depth: number): unknown => {
        if (++nodes > 20000 || depth > 40) return fail(at, 'JSON value is too complex.');
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
        if (typeof item === 'number' && Number.isFinite(item)) return item;
        if (Array.isArray(item)) return item.map((child, i) => visit(child, `${at}[${i}]`, depth + 1));
        if (item && typeof item === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(item))) {
          return Object.fromEntries(Object.entries(item).map(([key, child]) => {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) return fail(at, 'Unsafe JSON property.');
            return [key, visit(child, `${at}.${key}`, depth + 1)];
          }));
        }
        return fail(at, 'Expected a JSON value.');
      };
      return visit(value, path, 0);
    });
  },
  record<T>(schema: Schema<T>, max = 10000): Schema<Record<string, T>> {
    return make({ type: 'object', additionalProperties: schema.jsonSchema, maxProperties: max,
      propertyNames: { minLength: 1, maxLength: 200, not: { enum: ['__proto__', 'constructor', 'prototype'] } } }, (value, path) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        return fail(path, 'Expected a plain record.');
      const keys = Reflect.ownKeys(value);
      if (keys.length > max) return fail(path, 'Too many record entries.');
      return Object.fromEntries(keys.map(key => {
        if (typeof key !== 'string' || key.length < 1 || key.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(key))
          return fail(path, 'Unsafe record key.');
        return [key, schema.parse((value as Record<string, unknown>)[key], `${path}.${key}`)];
      }));
    });
  },
  extend<T extends object, const S extends Shape>(base: Schema<T>, shape: S): Schema<T & ObjectValue<S>> {
    const baseProperties = base.jsonSchema.properties as Record<string, JsonSchema> | undefined;
    if (!baseProperties || base.jsonSchema.type !== 'object') throw new Error('Only object schemas can be extended.');
    const extra = v.object(shape);
    if (Object.keys(shape).some(key => key in baseProperties)) throw new Error('Cannot redefine canonical fields.');
    const baseKeys = Object.keys(baseProperties), extraKeys = Object.keys(shape);
    return make({ type: 'object', properties: { ...baseProperties, ...(extra.jsonSchema.properties as object) },
      required: [...(base.jsonSchema.required as string[]), ...(extra.jsonSchema.required as string[])], additionalProperties: false }, (value, path) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        return fail(path, 'Expected a plain object.');
      if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || ![...baseKeys, ...extraKeys].includes(key)))
        return fail(path, 'Unexpected object property.');
      const fields = Object.entries(value);
      return { ...base.parse(Object.fromEntries(fields.filter(([key]) => baseKeys.includes(key))), path),
        ...extra.parse(Object.fromEntries(fields.filter(([key]) => extraKeys.includes(key))), path) };
    });
  },
  string(options: { min?: number; max?: number; pattern?: string; format?: string; check?: (s: string) => boolean } = {}): Schema<string> {
    const { min = 0, max = 500, pattern, format, check } = options;
    return make({ type: 'string', minLength: min, maxLength: max,
      ...(pattern ? { pattern } : {}), ...(format ? { format } : {}) }, (value, path) => {
      if (typeof value !== 'string') return fail(path, 'Expected a string.');
      const length = Array.from(value).length;
      if (length < min || length > max || (pattern && !new RegExp(pattern).test(value)) || (check && !check(value)))
        return fail(path, 'Invalid string value.');
      return value;
    });
  },
  int(min = 0, max = Number.MAX_SAFE_INTEGER): Schema<number> {
    return make({ type: 'integer', minimum: min, maximum: max }, (value, path) => {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
        return fail(path, 'Expected an integer in range.');
      return value;
    });
  },
  boolean(): Schema<boolean> {
    return make({ type: 'boolean' }, (value, path) => typeof value === 'boolean' ? value : fail(path, 'Expected boolean.'));
  },
  enum<const V extends readonly [string, ...string[]]>(values: V): Schema<V[number]> {
    return make({ type: 'string', enum: [...values] }, (value, path) =>
      typeof value === 'string' && values.includes(value) ? value as V[number] : fail(path, 'Unknown enum value.'));
  },
  literal<const T extends string | number | boolean>(value: T): Schema<T> {
    return make({ const: value, type: typeof value }, (input, path) => input === value ? value : fail(path, 'Unexpected literal.'));
  },
  nullable<T>(schema: Schema<T>): Schema<T | null> {
    return make({ anyOf: [schema.jsonSchema, { type: 'null' }] }, (value, path) => value === null ? null : schema.parse(value, path));
  },
  optional<T>(schema: Schema<T>): Schema<T | undefined> {
    return make(schema.jsonSchema, (value, path) => value === undefined ? undefined : schema.parse(value, path), true);
  },
  array<T>(schema: Schema<T>, options: { min?: number; max?: number; unique?: boolean } = {}): Schema<T[]> {
    const { min = 0, max = 100, unique = false } = options;
    return make({ type: 'array', items: schema.jsonSchema, minItems: min, maxItems: max,
      ...(unique ? { uniqueItems: true } : {}) }, (value, path) => {
      if (!Array.isArray(value) || value.length < min || value.length > max) return fail(path, 'Invalid array length.');
      const parsed = Array.from(value, (item, i) => schema.parse(item, `${path}[${i}]`));
      if (unique && new Set(parsed.map(item => JSON.stringify(item))).size !== parsed.length)
        return fail(path, 'Duplicate array values.');
      return parsed;
    });
  },
  union<const S extends readonly [Schema<unknown>, Schema<unknown>, ...Schema<unknown>[]]>(schemas: S): Schema<Infer<S[number]>> {
    return make({ anyOf: schemas.map(schema => schema.jsonSchema) }, (value, path) => {
      for (const schema of schemas) {
        try { return schema.parse(value, path) as Infer<S[number]>; } catch (error) { if (!(error instanceof ContractError)) throw error; }
      }
      return fail(path, 'No union member matched.');
    });
  },
  object<const S extends Shape>(shape: S): Schema<ObjectValue<S>> {
    const keys = Object.keys(shape);
    if (keys.some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) throw new Error('Unsafe schema property.');
    return make({ type: 'object', properties: Object.fromEntries(keys.map(key => [key, shape[key]!.jsonSchema])),
      required: keys.filter(key => !shape[key]!.optional), additionalProperties: false }, (value, path) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path, 'Expected a plain object.');
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return fail(path, 'Expected a plain object.');
      if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !keys.includes(key)))
        return fail(path, 'Unexpected object property.');
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        const present = Object.hasOwn(value, key);
        const field = shape[key]!;
        if (!present && field.optional) continue;
        const item = field.parse(present ? (value as Record<string, unknown>)[key] : undefined, `${path}.${key}`);
        if (item !== undefined) result[key] = item;
      }
      return result as ObjectValue<S>;
    });
  },
};
