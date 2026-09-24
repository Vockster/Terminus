const MIGRATION_JOURNAL_SCHEMA_VERSION = 1;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index])
  );
}

function documentsEqual(left, right) {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => documentsEqual(entry, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && documentsEqual(left[key], right[key])
    )
  );
}

function parseSchemaVersion(value) {
  return isRecord(value) && Number.isInteger(value.schemaVersion)
    ? value.schemaVersion
    : undefined;
}

export class StorageMigrationCoordinator {
  #storage;
  #targetVersion;
  #parseTarget;
  #migrationBySourceVersion;
  #createInvalidError;
  #createStorageError;
  #isDomainError;

  constructor({
    storage,
    sourceVersion,
    targetVersion,
    parseSource,
    parseTarget,
    migrateSource,
    migrations,
    createInvalidError,
    createStorageError,
    isDomainError
  }) {
    this.#storage = storage;
    this.#targetVersion = targetVersion;
    this.#parseTarget = parseTarget;
    const migrationDefinitions = migrations ?? [
      {
        sourceVersion,
        targetVersion,
        parseSource,
        parseTarget,
        migrateSource
      }
    ];
    this.#migrationBySourceVersion = new Map(
      migrationDefinitions.map((migration) => [migration.sourceVersion, migration])
    );
    this.#createInvalidError = createInvalidError;
    this.#createStorageError = createStorageError;
    this.#isDomainError = isDomainError;
  }

  async load() {
    const rawJournal = await this.#callStorage(() => this.#storage.readMigration());
    if (rawJournal !== undefined) {
      const journal = this.#parseJournal(rawJournal);
      const liveDocument = await this.#callStorage(() => this.#storage.read());
      const resumedDocument = await this.#resume(liveDocument, journal);
      return this.#migrateToTarget(resumedDocument);
    }

    const liveDocument = await this.#callStorage(() => this.#storage.read());
    if (liveDocument === undefined) {
      return undefined;
    }

    return this.#migrateToTarget(liveDocument);
  }

  async #migrateToTarget(initialDocument) {
    let document = initialDocument;
    for (let step = 0; step <= this.#migrationBySourceVersion.size; step += 1) {
      const version = parseSchemaVersion(document);
      if (version === this.#targetVersion) {
        return this.#parseTarget(document);
      }
      const migration = this.#migrationBySourceVersion.get(version);
      if (!migration) {
        return this.#parseTarget(document);
      }

      const source = migration.parseSource(document);
      const candidate = migration.parseTarget(migration.migrateSource(source));
      const journal = {
        schemaVersion: MIGRATION_JOURNAL_SCHEMA_VERSION,
        sourceVersion: migration.sourceVersion,
        targetVersion: migration.targetVersion,
        source,
        candidate
      };
      await this.#callStorage(() => this.#storage.writeMigration(journal));
      document = await this.#writeVerifyAndClear(candidate, migration.parseTarget);
    }
    throw this.#invalid("The migration path did not reach the current schema version.");
  }

  #parseJournal(value) {
    const migration = isRecord(value)
      ? this.#migrationBySourceVersion.get(value.sourceVersion)
      : undefined;
    if (
      !isRecord(value) ||
      !hasExactKeys(value, [
        "schemaVersion",
        "sourceVersion",
        "targetVersion",
        "source",
        "candidate"
      ]) ||
      value.schemaVersion !== MIGRATION_JOURNAL_SCHEMA_VERSION ||
      !migration ||
      value.targetVersion !== migration.targetVersion
    ) {
      throw this.#invalid("The migration journal is malformed.");
    }

    try {
      return {
        schemaVersion: MIGRATION_JOURNAL_SCHEMA_VERSION,
        sourceVersion: migration.sourceVersion,
        targetVersion: migration.targetVersion,
        source: migration.parseSource(value.source),
        candidate: migration.parseTarget(value.candidate),
        migration
      };
    } catch {
      throw this.#invalid("The migration journal is malformed.");
    }
  }

  async #resume(liveDocument, journal) {
    if (this.#matches(liveDocument, journal.migration.parseSource, journal.source)) {
      return this.#writeVerifyAndClear(journal.candidate, journal.migration.parseTarget);
    }
    if (this.#matches(liveDocument, journal.migration.parseTarget, journal.candidate)) {
      await this.#callStorage(() => this.#storage.removeMigration());
      return journal.migration.parseTarget(journal.candidate);
    }
    throw this.#invalid("Live data conflicts with the recoverable migration journal.");
  }

  #matches(value, parser, expected) {
    try {
      return documentsEqual(parser(value), expected);
    } catch {
      return false;
    }
  }

  async #writeVerifyAndClear(candidate, parseCandidate) {
    await this.#callStorage(() => this.#storage.write(candidate));
    const persisted = await this.#callStorage(() => this.#storage.read());
    let parsedPersisted;
    try {
      parsedPersisted = parseCandidate(persisted);
    } catch {
      throw this.#invalid("The migrated document could not be verified.");
    }
    if (!documentsEqual(parsedPersisted, candidate)) {
      throw this.#invalid("The migrated document did not match its journal candidate.");
    }
    await this.#callStorage(() => this.#storage.removeMigration());
    return parseCandidate(parsedPersisted);
  }

  #invalid(reason) {
    return this.#createInvalidError(reason);
  }

  async #callStorage(operation) {
    try {
      return await operation();
    } catch (error) {
      if (this.#isDomainError(error)) {
        throw error;
      }
      throw this.#createStorageError(error);
    }
  }
}
